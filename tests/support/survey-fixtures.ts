import type { Page, BrowserContext } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminClient,
  assertTestIdentity,
  authUserIdByEmail,
  issueEmailOtp,
  RUN_ID,
} from "./supabase-admin";

/**
 * Test-fixture rounds live entirely above this threshold so
 * sweepStaleTestData() (and this file's own guards) can never confuse one
 * with a real round — Round 1 is round_number 1.
 */
export const E2E_ROUND_NUMBER_MIN = 900000;

/** ISO string with 6 fractional digits (never a Date object) — the format
 * is_round_open_at/round_status_at are designed for (microsecond-precision
 * timestamptz boundaries), even though JS Date itself only carries
 * millisecond precision. */
function iso6(date: Date): string {
  return date.toISOString().replace(/\.(\d{3})Z$/, (_m, ms) => `.${ms}000Z`);
}

/**
 * Derives a unique, always-in-the-past one-minute window for a closed
 * fixture round, from its round_number alone — two closed fixtures can
 * never overlap each other or Round 1 (RND-05's one-open-round rule).
 * opens_at = 2001-01-01T00:00:00Z + (round_number − 900000) × 2 minutes;
 * closes_at = opens_at + 1 minute.
 */
export function pastWindowFor(roundNumber: number): {
  opensAt: string;
  closesAt: string;
} {
  if (roundNumber < E2E_ROUND_NUMBER_MIN) {
    throw new Error(
      `pastWindowFor: roundNumber ${roundNumber} is below E2E_ROUND_NUMBER_MIN (${E2E_ROUND_NUMBER_MIN})`
    );
  }

  const base = Date.UTC(2001, 0, 1, 0, 0, 0, 0);
  // Each fixture gets a unique 2-minute step (1-minute window + 1-minute
  // gap) so two closed fixtures can never collide with each other.
  const offsetMs = (roundNumber - E2E_ROUND_NUMBER_MIN) * 2 * 60 * 1000;
  const opensAt = new Date(base + offsetMs);
  const closesAt = new Date(opensAt.getTime() + 60 * 1000);

  return { opensAt: iso6(opensAt), closesAt: iso6(closesAt) };
}

export type TestRound = {
  roundId: string;
  roundNumber: number;
  sectionId: string;
  statementIds: string[];
  statementKeys: string[];
  pastWindow: { opensAt: string; closesAt: string } | null;
};

type SectionSpec = { scaleKey: string; statementCount: number };

async function allocateRoundNumber(
  client: ReturnType<typeof adminClient>,
  highest: boolean
): Promise<number> {
  let roundNumber =
    E2E_ROUND_NUMBER_MIN + Math.floor(Math.random() * 99999);

  if (highest) {
    const { data: maxRow, error } = await client
      .from("rounds")
      .select("round_number")
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    const currentMax = (maxRow?.round_number as number | undefined) ?? 0;
    roundNumber = Math.max(roundNumber, currentMax + 1);
  }

  return roundNumber;
}

/**
 * Creates a fully isolated e2e round (never Round 1, never a real round),
 * inserted as a draft with its content, and only then — for
 * `window: "closed"` — given a dated window derived from pastWindowFor so
 * it can never be open now or overlap Round 1 or another fixture
 * (RND-05 prohibition).
 */
export async function createTestRound(
  input: {
    window?: "draft" | "closed";
    statementCount?: number;
    scaleKey?: string;
    sections?: SectionSpec[];
    titleSuffix?: string;
    highest?: boolean;
  } = {}
): Promise<TestRound> {
  const {
    window = "draft",
    statementCount = 2,
    scaleKey = "agreement",
    sections,
    titleSuffix = "",
    highest = false,
  } = input;

  const client = adminClient();

  const sectionsSpec: SectionSpec[] =
    sections ?? [{ scaleKey, statementCount }];

  let roundId: string | null = null;
  let roundNumber = 0;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    roundNumber = await allocateRoundNumber(client, highest);
    const title = `e2e-${RUN_ID}-${roundNumber}${titleSuffix}`;
    const { data, error } = await client
      .from("rounds")
      .insert({ round_number: roundNumber, title })
      .select("id")
      .single();

    if (!error && data) {
      roundId = data.id as string;
      break;
    }
    // Only a unique-violation on round_number is worth one retry with a
    // freshly re-rolled number; any other error is a real failure.
    if (error?.code !== "23505") {
      throw error;
    }
  }

  if (!roundId) {
    throw new Error(
      "createTestRound: failed to allocate a unique round_number after retry"
    );
  }

  const sectionIds: string[] = [];
  const statementIds: string[] = [];
  const statementKeys: string[] = [];

  for (let i = 0; i < sectionsSpec.length; i += 1) {
    const position = i + 1;
    const spec = sectionsSpec[i];
    const { data: section, error: sectionError } = await client
      .from("sections")
      .insert({
        round_id: roundId,
        sort_order: position,
        title:
          sectionsSpec.length > 1 || sections
            ? `e2e section ${position}`
            : "e2e section",
        prompt:
          sectionsSpec.length > 1 || sections
            ? `e2e prompt ${position}`
            : "e2e prompt",
        scale_key: spec.scaleKey,
      })
      .select("id")
      .single();
    if (sectionError || !section) {
      throw sectionError ?? new Error("createTestRound: section insert failed");
    }
    const sectionId = section.id as string;
    sectionIds.push(sectionId);

    const keyPrefix = sections ? `e2e_s${position}_` : "e2e_";
    const statementRows = Array.from(
      { length: spec.statementCount },
      (_, j) => ({
        round_id: roundId,
        section_id: sectionId,
        sort_order: j + 1,
        key: `${keyPrefix}${String(j + 1).padStart(2, "0")}`,
        text: sections
          ? `e2e statement ${position}-${j + 1}`
          : `e2e statement ${j + 1}`,
      })
    );

    if (statementRows.length > 0) {
      const { data: statements, error: statementsError } = await client
        .from("statements")
        .insert(statementRows)
        .select("id, key, sort_order")
        .order("sort_order");
      if (statementsError || !statements) {
        throw (
          statementsError ??
          new Error("createTestRound: statement insert failed")
        );
      }
      statementIds.push(...statements.map((s) => s.id as string));
      statementKeys.push(...statements.map((s) => s.key as string));
    }
  }

  let pastWindow: { opensAt: string; closesAt: string } | null = null;
  if (window === "closed") {
    pastWindow = pastWindowFor(roundNumber);
    const { error: windowError } = await client
      .from("rounds")
      .update({ opens_at: pastWindow.opensAt, closes_at: pastWindow.closesAt })
      .eq("id", roundId);
    if (windowError) {
      throw windowError;
    }
  }

  return {
    roundId,
    roundNumber,
    sectionId: sectionIds[0] ?? "",
    statementIds,
    statementKeys,
    pastWindow,
  };
}

/**
 * Refuses to touch anything that isn't an e2e test round (title prefix
 * AND round_number range both required), then deletes its answers,
 * responses, and finally the round itself (sections/statements cascade).
 */
export async function deleteTestRound(roundId: string): Promise<void> {
  const client = adminClient();

  const { data: round, error: roundLookupError } = await client
    .from("rounds")
    .select("title, round_number")
    .eq("id", roundId)
    .maybeSingle();
  if (roundLookupError) {
    throw roundLookupError;
  }
  if (
    !round ||
    !String(round.title).startsWith("e2e-") ||
    (round.round_number as number) < E2E_ROUND_NUMBER_MIN
  ) {
    throw new Error(`Refusing to delete non-test round ${roundId}`);
  }

  const { error: answersError } = await client
    .from("answers")
    .delete()
    .eq("round_id", roundId);
  if (answersError) {
    throw answersError;
  }

  const { error: responsesError } = await client
    .from("responses")
    .delete()
    .eq("round_id", roundId);
  if (responsesError) {
    throw responsesError;
  }

  const { error: deleteRoundError } = await client
    .from("rounds")
    .delete()
    .eq("id", roundId);
  if (deleteRoundError) {
    throw deleteRoundError;
  }
}

/**
 * Throws unless roundId is a test-created round (round_number >= 900000).
 * Call this before any mutating admin RPC or UI action on a round in
 * later plans, so a bug can never point a destructive action at a real
 * round.
 */
export async function assertTestRound(roundId: string): Promise<void> {
  const client = adminClient();
  const { data, error } = await client
    .from("rounds")
    .select("round_number")
    .eq("id", roundId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data || (data.round_number as number) < E2E_ROUND_NUMBER_MIN) {
    throw new Error(
      `assertTestRound: refusing to operate on non-test round ${roundId}`
    );
  }
}

/**
 * Deletes a round created by public.admin_create_round (later plans) —
 * distinct from deleteTestRound (which only ever deletes rounds this file
 * itself created). Refuses unless the round is a draft (round_number >=
 * 900000, both dates null) with zero responses, so a half-tested "open
 * now" action can never be cleaned up by accident while real answers
 * exist.
 */
export async function deleteTestCreatedRound(roundId: string): Promise<void> {
  const client = adminClient();

  const { data: round, error: roundError } = await client
    .from("rounds")
    .select("round_number, opens_at, closes_at")
    .eq("id", roundId)
    .maybeSingle();
  if (roundError) {
    throw roundError;
  }
  if (
    !round ||
    (round.round_number as number) < E2E_ROUND_NUMBER_MIN ||
    round.opens_at !== null ||
    round.closes_at !== null
  ) {
    throw new Error(
      `deleteTestCreatedRound: refusing to delete round ${roundId} (not a test-created draft round)`
    );
  }

  const { count: responsesCount, error: countError } = await client
    .from("responses")
    .select("id", { count: "exact", head: true })
    .eq("round_id", roundId);
  if (countError) {
    throw countError;
  }
  if ((responsesCount ?? 0) > 0) {
    throw new Error(
      `deleteTestCreatedRound: refusing to delete round ${roundId} (responses exist)`
    );
  }

  const { error: deleteError } = await client
    .from("rounds")
    .delete()
    .eq("id", roundId);
  if (deleteError) {
    throw deleteError;
  }
}

/**
 * A deterministic, order-stable snapshot of Round 1 (row + sections +
 * statements) as a JSON string, for before/after equality assertions
 * (RND-05 prohibition: tests must never actually change Round 1).
 */
export async function snapshotRound1(): Promise<string> {
  const client = adminClient();

  const { data: round, error: roundError } = await client
    .from("rounds")
    .select("id, title, opens_at, closes_at")
    .eq("round_number", 1)
    .single();
  if (roundError || !round) {
    throw roundError ?? new Error("snapshotRound1: Round 1 not found");
  }

  const { data: sections, error: sectionsError } = await client
    .from("sections")
    .select("sort_order, title, prompt, scale_key")
    .eq("round_id", round.id)
    .order("sort_order");
  if (sectionsError) {
    throw sectionsError;
  }

  const { data: statements, error: statementsError } = await client
    .from("statements")
    .select("key, text, sort_order")
    .eq("round_id", round.id)
    .order("key");
  if (statementsError) {
    throw statementsError;
  }

  return JSON.stringify({
    round: {
      id: round.id,
      title: round.title,
      opensAt: round.opens_at,
      closesAt: round.closes_at,
    },
    sections: sections ?? [],
    statements: statements ?? [],
  });
}

export async function currentOpenRoundId(
  client: SupabaseClient
): Promise<string | null> {
  const { data, error } = await client.rpc("current_open_round_id");
  if (error) {
    throw error;
  }
  return (data as string | null) ?? null;
}

/**
 * Seeds answers for every statement in the open round (except exceptKeys)
 * under the given client's OWN RLS — never via service role — so the
 * seeded data is indistinguishable from a real participant's own writes.
 */
export async function seedOwnAnswers(
  client: SupabaseClient,
  options?: { exceptKeys?: string[]; value?: number }
): Promise<{ responseId: string; answeredCount: number }> {
  const exceptKeys = new Set(options?.exceptKeys ?? []);
  const value = options?.value ?? 1;

  const openRoundId = await currentOpenRoundId(client);
  if (!openRoundId) {
    throw new Error("seedOwnAnswers: no open round");
  }

  const { error: ensureResponseError } = await client
    .from("responses")
    .upsert(
      { round_id: openRoundId },
      { onConflict: "round_id,user_id", ignoreDuplicates: true }
    );
  if (ensureResponseError) {
    throw ensureResponseError;
  }

  const { data: response, error: responseError } = await client
    .from("responses")
    .select("id")
    .eq("round_id", openRoundId)
    .single();
  if (responseError || !response) {
    throw responseError ?? new Error("seedOwnAnswers: could not resolve own response");
  }

  const { data: statements, error: statementsError } = await client
    .from("statements")
    .select("id, key")
    .eq("round_id", openRoundId);
  if (statementsError) {
    throw statementsError;
  }

  const toAnswer = (statements ?? []).filter(
    (s) => !exceptKeys.has(s.key as string)
  );

  if (toAnswer.length > 0) {
    const { error: answersError } = await client.from("answers").upsert(
      toAnswer.map((s) => ({
        response_id: response.id,
        round_id: openRoundId,
        statement_id: s.id,
        value,
      })),
      { onConflict: "response_id,statement_id" }
    );
    if (answersError) {
      throw answersError;
    }
  }

  return {
    responseId: response.id as string,
    answeredCount: toAnswer.length,
  };
}

const PENDING_EMAIL_COOKIE = "dfs_pending_email";

/**
 * The Phase 1 cookie + /login/code sign-in pattern, packaged for reuse.
 * Resolves once the URL no longer contains /login.
 */
export async function signInViaCodePage(
  page: Page,
  context: BrowserContext,
  email: string
): Promise<void> {
  const code = await issueEmailOtp(email);

  await context.addCookies([
    {
      name: PENDING_EMAIL_COOKIE,
      value: encodeURIComponent(email),
      domain: "localhost",
      path: "/login",
    },
  ]);

  await page.goto("/login/code");
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"));
}

/**
 * Seeds responses + answers for a test round (ADM-02/03 fixtures),
 * entirely via the service-role client (never through RLS) since a
 * participant's own `responses_insert_own_open_round` policy only allows
 * the currently open round, and these fixtures are deliberately closed.
 * Refuses unless assertTestRound(roundId) passes. For each participant,
 * issues an OTP first to ensure the auth user exists (creating one is a
 * side effect of generateLink), inserts an unsubmitted response row, maps
 * each answer's key to its statement_id, and — only if `submit` — updates
 * submitted_at (the responses_before_write trigger stamps the DB's own
 * now(), requiring every statement in the round to already be answered).
 * Returns email -> responseId.
 */
export async function seedRoundResponses(
  roundId: string,
  participants: Array<{
    email: string;
    answers: Record<string, number>;
    submit: boolean;
  }>
): Promise<Record<string, string>> {
  await assertTestRound(roundId);
  const client = adminClient();

  const { data: statementRows, error: statementsError } = await client
    .from("statements")
    .select("id, key")
    .eq("round_id", roundId);
  if (statementsError) {
    throw statementsError;
  }
  const statementIdByKey = new Map(
    (statementRows ?? []).map((s) => [s.key as string, s.id as string])
  );

  const result: Record<string, string> = {};

  for (const participant of participants) {
    assertTestIdentity(participant.email);

    await issueEmailOtp(participant.email);
    const userId = await authUserIdByEmail(participant.email);
    if (!userId) {
      throw new Error(
        `seedRoundResponses: could not resolve auth user id for ${participant.email}`
      );
    }

    const { data: response, error: responseError } = await client
      .from("responses")
      .insert({ round_id: roundId, user_id: userId })
      .select("id")
      .single();
    if (responseError || !response) {
      throw (
        responseError ??
        new Error("seedRoundResponses: response insert failed")
      );
    }
    const responseId = response.id as string;
    result[participant.email] = responseId;

    const answerEntries = Object.entries(participant.answers);
    if (answerEntries.length > 0) {
      const answerRows = answerEntries.map(([key, value]) => {
        const statementId = statementIdByKey.get(key);
        if (!statementId) {
          throw new Error(
            `seedRoundResponses: unknown statement key "${key}" for round ${roundId}`
          );
        }
        return {
          response_id: responseId,
          round_id: roundId,
          statement_id: statementId,
          value,
        };
      });
      const { error: answersError } = await client
        .from("answers")
        .insert(answerRows);
      if (answersError) {
        throw answersError;
      }
    }

    if (participant.submit) {
      const { error: submitError } = await client
        .from("responses")
        .update({ submitted_at: new Date().toISOString() })
        .eq("id", responseId);
      if (submitError) {
        throw submitError;
      }
    }
  }

  return result;
}
