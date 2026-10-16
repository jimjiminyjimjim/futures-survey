import { createClient } from "@supabase/supabase-js";
import { existsSync } from "fs";

/**
 * Demo data for the live Supabase project (dev == live, project
 * yxjfpdzbqcaczvsbuiws). Creates 20 `demo.NN@example.com` participants with
 * fully-submitted (18) or partial (2) Round 1 responses, and a clean
 * removal path. Never touches any other user, admin_emails, or
 * allowed_domains beyond the temporary example.com add/remove this script
 * performs around user creation.
 *
 * Usage:
 *   yarn demo:seed
 *   yarn demo:remove
 *
 * Reruns of `seed` are idempotent: users and responses that already exist
 * are skipped rather than duplicated.
 */

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function adminClient() {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type AdminClient = ReturnType<typeof adminClient>;

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const DEMO_DOMAIN = "example.com";
const DEMO_USER_COUNT = 20;
const DEMO_EMAIL_PATTERN = /^demo\.(\d{2})@example\.com$/;
// Deterministic across reruns — never derived from Date.now() or Math.random().
const SEED = 20261015;

function demoEmails(): string[] {
  return Array.from({ length: DEMO_USER_COUNT }, (_, i) =>
    `demo.${String(i + 1).padStart(2, "0")}@example.com`
  );
}

// The last two demo participants are left started-but-not-submitted so the
// admin responses page shows both states.
const PARTIAL_EMAILS = new Set(["demo.19@example.com", "demo.20@example.com"]);

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) seeded from SEED + a string key, so every
// statement/user/purpose gets its own independent, reproducible stream.
// ---------------------------------------------------------------------------

function hashStringToSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rngFor(key: string): () => number {
  let a = hashStringToSeed(`${SEED}:${key}`) >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function seededSampleWithoutReplacement<T>(
  items: T[],
  count: number,
  rng: () => number
): T[] {
  const pool = [...items];
  const result: T[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    result.push(pool.splice(idx, 1)[0]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Answer realism model
// ---------------------------------------------------------------------------

interface ScaleRange {
  min: number;
  max: number;
}

interface StatementRow {
  id: string;
  key: string;
  sectionId: string;
  scaleKey: string;
}

type ProfileType = "skew_agree" | "skew_disagree" | "polarised" | "neutral";

interface StatementProfile {
  type: ProfileType;
  centre: number;
  polarised: boolean;
}

/**
 * Each statement gets a deterministic "centre" (and, for the agreement
 * scale, a type) derived only from its key + the fixed SEED — so reruns
 * always produce the same group shape:
 *  - familiarity scale: centres spread across the whole range, giving
 *    some terms that read as well-known and others as obscure.
 *  - agreement scale: a mix of skew-agree, skew-disagree, polarised and
 *    neutral statements, so presentation mode shows varied distributions.
 */
function profileFor(
  statementKey: string,
  scaleKey: string,
  range: ScaleRange
): StatementProfile {
  const rng = rngFor(`profile:${statementKey}`);
  const roll = rng();
  const mid = (range.min + range.max) / 2;

  if (scaleKey === "familiarity") {
    const centre = range.min + roll * (range.max - range.min);
    return { type: "neutral", centre, polarised: false };
  }

  if (roll < 0.3) {
    return { type: "skew_agree", centre: range.max - 0.6, polarised: false };
  }
  if (roll < 0.55) {
    return {
      type: "skew_disagree",
      centre: range.min + 0.6,
      polarised: false,
    };
  }
  if (roll < 0.7) {
    return { type: "polarised", centre: mid, polarised: true };
  }
  return { type: "neutral", centre: mid, polarised: false };
}

function userBias(userIndex: number): number {
  const rng = rngFor(`user-bias:${userIndex}`);
  return (rng() - 0.5) * 1.2;
}

function userLean(userIndex: number): 1 | -1 {
  const rng = rngFor(`user-lean:${userIndex}`);
  return rng() < 0.5 ? -1 : 1;
}

function sampleValue(
  profile: StatementProfile,
  range: ScaleRange,
  userIndex: number,
  statementKey: string
): number {
  const rng = rngFor(`answer:${statementKey}:${userIndex}`);
  const noise = gaussian(rng) * 0.9;

  if (profile.polarised) {
    const lean = userLean(userIndex);
    const anchor = lean > 0 ? range.max - 0.4 : range.min + 0.4;
    return clampInt(anchor + noise * 0.6, range.min, range.max);
  }

  const bias = userBias(userIndex) * 0.6;
  return clampInt(profile.centre + bias + noise, range.min, range.max);
}

/** Varies each response's started time across the last ~4 days. */
function startedAtFor(userIndex: number): string {
  const rng = rngFor(`started-at:${userIndex}`);
  const daysAgo = rng() * 4;
  const ms = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

async function findAllDemoUsers(
  client: AdminClient
): Promise<Array<{ id: string; email: string }>> {
  const perPage = 200;
  let page = 1;
  const result: Array<{ id: string; email: string }> = [];

  while (true) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      throw error;
    }

    for (const u of data.users) {
      const email = u.email?.toLowerCase() ?? "";
      const isDemoMetadata =
        (u.user_metadata as Record<string, unknown> | null | undefined)
          ?.demo === true;
      if (DEMO_EMAIL_PATTERN.test(email) || isDemoMetadata) {
        result.push({ id: u.id, email });
      }
    }

    if (data.users.length < perPage) {
      break;
    }
    page += 1;
  }

  return result;
}

async function fetchScaleRanges(
  client: AdminClient
): Promise<Map<string, ScaleRange>> {
  const { data, error } = await client
    .from("scale_options")
    .select("scale_key, value");
  if (error) {
    throw error;
  }

  const ranges = new Map<string, ScaleRange>();
  for (const row of data ?? []) {
    const key = row.scale_key as string;
    const value = row.value as number;
    const existing = ranges.get(key);
    if (!existing) {
      ranges.set(key, { min: value, max: value });
    } else {
      existing.min = Math.min(existing.min, value);
      existing.max = Math.max(existing.max, value);
    }
  }
  return ranges;
}

async function fetchRoundStatements(
  client: AdminClient,
  roundId: string
): Promise<StatementRow[]> {
  const { data: sections, error: sectionsError } = await client
    .from("sections")
    .select("id, scale_key")
    .eq("round_id", roundId);
  if (sectionsError) {
    throw sectionsError;
  }
  const scaleKeyBySection = new Map(
    (sections ?? []).map((s) => [s.id as string, s.scale_key as string])
  );

  const { data: statements, error: statementsError } = await client
    .from("statements")
    .select("id, key, section_id")
    .eq("round_id", roundId)
    .order("key");
  if (statementsError) {
    throw statementsError;
  }

  return (statements ?? []).map((s) => ({
    id: s.id as string,
    key: s.key as string,
    sectionId: s.section_id as string,
    scaleKey: scaleKeyBySection.get(s.section_id as string) ?? "agreement",
  }));
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed(): Promise<void> {
  const client = adminClient();
  const emails = demoEmails();

  const { data: existingDomainRows, error: domainCheckError } = await client
    .from("allowed_domains")
    .select("domain")
    .eq("domain", DEMO_DOMAIN);
  if (domainCheckError) {
    throw domainCheckError;
  }
  const domainAlreadyAllowed = (existingDomainRows ?? []).length > 0;

  if (!domainAlreadyAllowed) {
    const { error: insertDomainError } = await client
      .from("allowed_domains")
      .insert({ domain: DEMO_DOMAIN });
    if (insertDomainError) {
      throw insertDomainError;
    }
    console.log(
      `Temporarily allowed domain ${DEMO_DOMAIN} for demo user creation.`
    );
  } else {
    console.log(
      `Domain ${DEMO_DOMAIN} was already allowed — leaving it in place.`
    );
  }

  try {
    const existing = await findAllDemoUsers(client);
    const existingEmails = new Set(existing.map((u) => u.email));
    const userIdByEmail = new Map<string, string>();
    for (const u of existing) {
      userIdByEmail.set(u.email, u.id);
    }

    for (const email of emails) {
      if (existingEmails.has(email)) {
        console.log(`Skip (user exists): ${email}`);
        continue;
      }
      const { data, error } = await client.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { demo: true },
      });
      if (error || !data.user) {
        throw error ?? new Error(`createUser returned no user for ${email}`);
      }
      userIdByEmail.set(email, data.user.id);
      console.log(`Created user: ${email}`);
    }

    const { data: openRoundId, error: roundIdError } = await client.rpc(
      "current_open_round_id"
    );
    if (roundIdError) {
      throw roundIdError;
    }
    if (!openRoundId) {
      throw new Error("No round is currently open — cannot seed responses.");
    }

    const scaleRanges = await fetchScaleRanges(client);
    const statements = await fetchRoundStatements(
      client,
      openRoundId as string
    );
    if (statements.length === 0) {
      throw new Error(`Open round ${openRoundId} has no statements.`);
    }

    const profiles = new Map<string, StatementProfile>(
      statements.map((s) => [
        s.key,
        profileFor(
          s.key,
          s.scaleKey,
          scaleRanges.get(s.scaleKey) ?? { min: 1, max: 5 }
        ),
      ])
    );

    const { data: existingResponses, error: existingResponsesError } =
      await client
        .from("responses")
        .select("id, user_id")
        .eq("round_id", openRoundId);
    if (existingResponsesError) {
      throw existingResponsesError;
    }
    const userIdsWithResponse = new Set(
      (existingResponses ?? []).map((r) => r.user_id as string)
    );

    let submittedCount = 0;
    let partialCount = 0;

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      const userId = userIdByEmail.get(email);
      if (!userId) {
        throw new Error(`No auth user id resolved for ${email}`);
      }
      if (userIdsWithResponse.has(userId)) {
        console.log(`Skip (response exists): ${email}`);
        continue;
      }

      const userIndex = i + 1;
      const isPartial = PARTIAL_EMAILS.has(email);
      const startedAt = startedAtFor(userIndex);

      const { data: responseRow, error: responseError } = await client
        .from("responses")
        .insert({ round_id: openRoundId, user_id: userId, created_at: startedAt })
        .select("id")
        .single();
      if (responseError || !responseRow) {
        throw responseError ?? new Error(`Failed to create response for ${email}`);
      }
      const responseId = responseRow.id as string;

      let statementsToAnswer = statements;
      if (isPartial) {
        const countRng = rngFor(`partial-count:${userIndex}`);
        const answerCount = Math.max(
          1,
          Math.round(statements.length * (0.3 + countRng() * 0.3))
        );
        statementsToAnswer = seededSampleWithoutReplacement(
          statements,
          answerCount,
          rngFor(`partial-pick:${userIndex}`)
        );
      }

      const answerRows = statementsToAnswer.map((s) => {
        const profile = profiles.get(s.key);
        if (!profile) {
          throw new Error(`No profile computed for statement ${s.key}`);
        }
        const range = scaleRanges.get(s.scaleKey) ?? { min: 1, max: 5 };
        const value = sampleValue(profile, range, userIndex, s.key);
        return {
          response_id: responseId,
          round_id: openRoundId,
          statement_id: s.id,
          value,
        };
      });

      const { error: answersError } = await client
        .from("answers")
        .insert(answerRows);
      if (answersError) {
        throw answersError;
      }

      if (!isPartial) {
        const { error: submitError } = await client
          .from("responses")
          .update({ submitted_at: startedAt })
          .eq("id", responseId);
        if (submitError) {
          throw submitError;
        }
        submittedCount += 1;
      } else {
        partialCount += 1;
      }

      console.log(
        `${isPartial ? "Started (not submitted)" : "Submitted"}: ${email} (${
          answerRows.length
        }/${statements.length} answers)`
      );
    }

    console.log(
      `Seed complete: ${submittedCount} submitted, ${partialCount} started.`
    );
  } finally {
    if (!domainAlreadyAllowed) {
      const { error: deleteDomainError } = await client
        .from("allowed_domains")
        .delete()
        .eq("domain", DEMO_DOMAIN);
      if (deleteDomainError) {
        console.error(
          `WARNING: failed to remove temporary allowed domain ${DEMO_DOMAIN}: ${deleteDomainError.message}`
        );
      } else {
        console.log(`Restored allowed_domains (removed temporary ${DEMO_DOMAIN}).`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

async function remove(): Promise<void> {
  const client = adminClient();
  const demoUsers = await findAllDemoUsers(client);

  if (demoUsers.length === 0) {
    console.log("No demo users found — nothing to remove.");
    return;
  }

  const userIds = demoUsers.map((u) => u.id);

  const { data: responses, error: responsesError } = await client
    .from("responses")
    .select("id")
    .in("user_id", userIds);
  if (responsesError) {
    throw responsesError;
  }
  const responseIds = (responses ?? []).map((r) => r.id as string);

  if (responseIds.length > 0) {
    const { error: deleteAnswersError } = await client
      .from("answers")
      .delete()
      .in("response_id", responseIds);
    if (deleteAnswersError) {
      throw deleteAnswersError;
    }

    const { error: deleteResponsesError } = await client
      .from("responses")
      .delete()
      .in("id", responseIds);
    if (deleteResponsesError) {
      throw deleteResponsesError;
    }
    console.log(
      `Deleted ${responseIds.length} response(s) and their answers.`
    );
  }

  for (const user of demoUsers) {
    const { error } = await client.auth.admin.deleteUser(user.id);
    if (error) {
      throw error;
    }
    console.log(`Removed user: ${user.email}`);
  }

  console.log(`Remove complete: ${demoUsers.length} demo user(s) deleted.`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "seed") {
    await seed();
  } else if (mode === "remove") {
    await remove();
  } else {
    console.error("Usage: node scripts/demo-data.ts <seed|remove>");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
