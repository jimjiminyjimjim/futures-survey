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
    // Rounds belong to a survey (survey_id and session_number are required,
    // and (survey_id, session_number) is unique), so each fixture round gets
    // its own "e2e-" survey; deleteTestRound removes it with the round.
    const { data: survey, error: surveyError } = await client
      .from("surveys")
      .insert({ title })
      .select("id")
      .single();
    if (surveyError || !survey) {
      throw surveyError ?? new Error("createTestRound: survey insert failed");
    }
    const { data, error } = await client
      .from("rounds")
      .insert({
        round_number: roundNumber,
        title,
        survey_id: survey.id as string,
        session_number: 1,
      })
      .select("id")
      .single();

    if (!error && data) {
      roundId = data.id as string;
      break;
    }
    await deleteEmptyTestSurvey(survey.id as string);
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
    .select("title, round_number, survey_id")
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

  // Per-session results consent references rounds(id) with no ON DELETE
  // CASCADE, so a fixture round a participant opted in on can only be
  // deleted once its consent rows are gone.
  const { error: consentError } = await client
    .from("results_consent_rounds")
    .delete()
    .eq("round_id", roundId);
  if (consentError) {
    throw consentError;
  }

  const { error: deleteRoundError } = await client
    .from("rounds")
    .delete()
    .eq("id", roundId);
  if (deleteRoundError) {
    throw deleteRoundError;
  }

  // A fixture round created by createTestRoundCopiedFrom owns its own
  // "e2e-" survey; drop it once no round references it. A real survey is
  // never matched (title prefix required).
  const surveyId = (round.survey_id as string | null) ?? null;
  if (surveyId) {
    await deleteEmptyTestSurvey(surveyId);
  }
}

/**
 * Deletes a survey only if its title starts with "e2e-" and no round
 * references it any more. Anything else is left exactly as it is.
 */
async function deleteEmptyTestSurvey(surveyId: string): Promise<void> {
  const client = adminClient();

  const { data: survey, error: surveyError } = await client
    .from("surveys")
    .select("id, title")
    .eq("id", surveyId)
    .maybeSingle();
  if (surveyError) {
    throw surveyError;
  }
  if (!survey || !String(survey.title).startsWith("e2e-")) {
    return;
  }

  const { count, error: countError } = await client
    .from("rounds")
    .select("id", { count: "exact", head: true })
    .eq("survey_id", surveyId);
  if (countError) {
    throw countError;
  }
  if ((count ?? 0) > 0) {
    return;
  }

  const { error: deleteError } = await client
    .from("surveys")
    .delete()
    .eq("id", surveyId);
  if (deleteError) {
    throw deleteError;
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
  // The code form submits itself once all 6 digits are in (no Sign in click).
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

export type CopiedSection = {
  id: string;
  sortOrder: number;
  label: string | null;
  title: string;
  prompt: string;
  scaleKey: string;
  grouped: boolean;
  showOverview: boolean;
};

export type CopiedStatement = {
  id: string;
  key: string;
  text: string;
  kind: string;
  sortOrder: number;
  sectionId: string;
  optional: boolean;
  options: Array<{ value: number; label: string }> | null;
};

export type CopiedTestRound = {
  roundId: string;
  roundNumber: number;
  surveyId: string;
  title: string;
  /** In section sort_order. */
  sections: CopiedSection[];
  /** In round order: section sort_order, then statement sort_order. */
  statements: CopiedStatement[];
};

const SECTION_COPY_COLUMNS =
  "id, sort_order, label, parent_title, title, prompt, scale_key, grouped, show_overview, discussion_prompt";
const STATEMENT_COPY_COLUMNS =
  "id, section_id, sort_order, key, text, kind, options, choice_count, is_key, optional, prediction_of, label, context, question, reveal_text, left_label, right_label";

/**
 * Builds an isolated e2e draft round whose sections and statements are a
 * verbatim copy of `sourceRoundId`'s (labels, kinds, options, scales, end
 * labels, flags). The source round is only ever SELECTed — never updated,
 * never given dates, never answered. The copy gets its own "e2e-" survey
 * (rounds need a survey_id, and (survey_id, session_number) is unique), a
 * round_number >= E2E_ROUND_NUMBER_MIN and an "e2e-" title, so
 * deleteTestRound / sweepStaleTestData can remove it. It is inserted as a
 * draft (dates null) so the content-lock triggers allow the inserts; open
 * it afterwards with openTestRound. Any failure part-way through removes
 * whatever was created.
 */
export async function createTestRoundCopiedFrom(
  sourceRoundId: string
): Promise<CopiedTestRound> {
  const client = adminClient();

  const { data: source, error: sourceError } = await client
    .from("rounds")
    .select("id, session_number, intro")
    .eq("id", sourceRoundId)
    .single();
  if (sourceError || !source) {
    throw sourceError ?? new Error(`createTestRoundCopiedFrom: source round ${sourceRoundId} not found`);
  }

  const { data: sourceSections, error: sectionsError } = await client
    .from("sections")
    .select(SECTION_COPY_COLUMNS)
    .eq("round_id", sourceRoundId)
    .order("sort_order");
  if (sectionsError) {
    throw sectionsError;
  }

  const { data: sourceStatements, error: statementsError } = await client
    .from("statements")
    .select(STATEMENT_COPY_COLUMNS)
    .eq("round_id", sourceRoundId)
    .order("sort_order");
  if (statementsError) {
    throw statementsError;
  }

  let surveyId: string | null = null;
  let roundId: string | null = null;
  let roundNumber = 0;
  let title = "";

  try {
    for (let attempt = 0; attempt < 2 && !roundId; attempt += 1) {
      roundNumber = await allocateRoundNumber(client, false);
      title = `e2e-${RUN_ID}-${roundNumber}`;

      const { data: survey, error: surveyError } = await client
        .from("surveys")
        .insert({ title })
        .select("id")
        .single();
      if (surveyError || !survey) {
        if (surveyError?.code === "23505") {
          continue;
        }
        throw surveyError ?? new Error("createTestRoundCopiedFrom: survey insert failed");
      }
      surveyId = survey.id as string;

      const { data: round, error: roundError } = await client
        .from("rounds")
        .insert({
          round_number: roundNumber,
          title,
          survey_id: surveyId,
          session_number: source.session_number,
          intro: source.intro,
        })
        .select("id")
        .single();
      if (roundError || !round) {
        await deleteEmptyTestSurvey(surveyId);
        surveyId = null;
        if (roundError?.code === "23505") {
          continue;
        }
        throw roundError ?? new Error("createTestRoundCopiedFrom: round insert failed");
      }
      roundId = round.id as string;
    }

    if (!roundId || !surveyId) {
      throw new Error(
        "createTestRoundCopiedFrom: failed to allocate a unique round_number after retry"
      );
    }
    const newRoundId = roundId;

    const sections: CopiedSection[] = [];
    const sectionIdMap = new Map<string, string>();
    for (const s of sourceSections ?? []) {
      const { data: inserted, error } = await client
        .from("sections")
        .insert({
          round_id: newRoundId,
          sort_order: s.sort_order,
          label: s.label,
          parent_title: s.parent_title,
          title: s.title,
          prompt: s.prompt,
          scale_key: s.scale_key,
          grouped: s.grouped,
          show_overview: s.show_overview,
          discussion_prompt: s.discussion_prompt,
        })
        .select("id")
        .single();
      if (error || !inserted) {
        throw error ?? new Error("createTestRoundCopiedFrom: section insert failed");
      }
      sectionIdMap.set(s.id as string, inserted.id as string);
      sections.push({
        id: inserted.id as string,
        sortOrder: s.sort_order as number,
        label: (s.label as string | null) ?? null,
        title: s.title as string,
        prompt: s.prompt as string,
        scaleKey: s.scale_key as string,
        grouped: s.grouped === true,
        showOverview: s.show_overview === true,
      });
    }

    // Statements a prediction points at go in first, so prediction_of can
    // be remapped to the copy's own statement id.
    const statementIdMap = new Map<string, string>();
    const ordered = [...(sourceStatements ?? [])].sort(
      (a, b) => Number(a.prediction_of !== null) - Number(b.prediction_of !== null)
    );
    for (const st of ordered) {
      const sectionId = sectionIdMap.get(st.section_id as string);
      if (!sectionId) {
        throw new Error(`createTestRoundCopiedFrom: statement ${st.key} has an unknown section`);
      }
      const predictionOf = st.prediction_of
        ? statementIdMap.get(st.prediction_of as string)
        : null;
      if (st.prediction_of && !predictionOf) {
        throw new Error(`createTestRoundCopiedFrom: statement ${st.key} predicts an uncopied statement`);
      }
      const { data: inserted, error } = await client
        .from("statements")
        .insert({
          round_id: newRoundId,
          section_id: sectionId,
          sort_order: st.sort_order,
          key: st.key,
          text: st.text,
          kind: st.kind,
          options: st.options,
          choice_count: st.choice_count,
          is_key: st.is_key,
          optional: st.optional,
          prediction_of: predictionOf ?? null,
          label: st.label,
          context: st.context,
          question: st.question,
          reveal_text: st.reveal_text,
          left_label: st.left_label,
          right_label: st.right_label,
        })
        .select("id")
        .single();
      if (error || !inserted) {
        throw error ?? new Error("createTestRoundCopiedFrom: statement insert failed");
      }
      statementIdMap.set(st.id as string, inserted.id as string);
    }

    const sectionOrder = new Map(sections.map((s) => [s.id, s.sortOrder]));
    const statements: CopiedStatement[] = (sourceStatements ?? [])
      .map((st) => ({
        id: statementIdMap.get(st.id as string)!,
        key: st.key as string,
        text: st.text as string,
        kind: st.kind as string,
        sortOrder: st.sort_order as number,
        sectionId: sectionIdMap.get(st.section_id as string)!,
        optional: st.optional === true,
        options:
          (st.options as Array<{ value: number; label: string }> | null) ?? null,
      }))
      .sort(
        (a, b) =>
          sectionOrder.get(a.sectionId)! - sectionOrder.get(b.sectionId)! ||
          a.sortOrder - b.sortOrder
      );

    return { roundId: newRoundId, roundNumber, surveyId, title, sections, statements };
  } catch (error) {
    if (roundId) {
      await deleteTestRound(roundId).catch(() => undefined);
    } else if (surveyId) {
      await deleteEmptyTestSurvey(surveyId).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Opens an e2e test round NOW: opens_at one minute in the past (so a small
 * client/DB clock skew can't leave it "scheduled"), closes_at `minutes`
 * from now. Refuses unless assertTestRound passes. The one-open-round
 * trigger/constraint still applies, so this throws 23P01 (hint
 * round_overlap) if any other round's window overlaps — callers should
 * check for an open round first and treat 23P01 as "skip".
 */
export async function openTestRound(
  roundId: string,
  minutes: number
): Promise<{ opensAt: string; closesAt: string }> {
  await assertTestRound(roundId);
  const now = Date.now();
  const opensAt = iso6(new Date(now - 60 * 1000));
  const closesAt = iso6(new Date(now + minutes * 60 * 1000));

  const { error } = await adminClient()
    .from("rounds")
    .update({ opens_at: opensAt, closes_at: closesAt })
    .eq("id", roundId);
  if (error) {
    throw error;
  }
  return { opensAt, closesAt };
}

/**
 * Closes an open e2e test round now (closes_at = now). A round that never
 * opened, or already closed, is left as it is. Refuses unless
 * assertTestRound passes.
 */
export async function closeTestRound(roundId: string): Promise<void> {
  await assertTestRound(roundId);
  const client = adminClient();

  const { data: round, error: roundError } = await client
    .from("rounds")
    .select("opens_at, closes_at")
    .eq("id", roundId)
    .maybeSingle();
  if (roundError) {
    throw roundError;
  }
  if (!round || !round.opens_at) {
    return;
  }

  const now = Date.now();
  const opensAt = new Date(round.opens_at as string).getTime();
  const closesAt = round.closes_at
    ? new Date(round.closes_at as string).getTime()
    : null;
  if (closesAt !== null && closesAt <= now) {
    return;
  }

  const { error } = await client
    .from("rounds")
    .update({ closes_at: iso6(new Date(Math.max(now, opensAt + 1000))) })
    .eq("id", roundId);
  if (error) {
    throw error;
  }
}

/**
 * Creates the auth user for a test PARTICIPANT (non-admin) and returns its
 * id. Since 20261018000200 the test identities' domain
 * (network.rca.ac.uk) is no longer on allowed_domains, so the
 * before_user_created hook would refuse a brand-new e2e participant. The
 * address is put on admin_emails only for the moment its user is created
 * (which is what makes it eligible), then removed again, so the account
 * signs in afterwards as an ordinary participant. No real domain is ever
 * added to allowed_domains.
 */
export async function createTestParticipantUser(email: string): Promise<string> {
  assertTestIdentity(email);

  // Test addresses are gmail plus-addresses (rhodes.james+e2e-…@gmail.com) on
  // an allowed domain, so issuing a code creates the auth user directly.
  await issueEmailOtp(email);

  const userId = await authUserIdByEmail(email);
  if (!userId) {
    throw new Error(`createTestParticipantUser: no auth user for ${email}`);
  }
  return userId;
}
