import { createClient } from "@supabase/supabase-js";
import { existsSync } from "fs";

/**
 * Demo data for the live Supabase project (dev == live, project
 * yxjfpdzbqcaczvsbuiws). Creates 20 `demo.NN@example.com` participants with
 * responses for EVERY session (round) of the survey: session 1 gets 18
 * fully-submitted + 2 partial responses, sessions 2 and 3 get 20 submitted.
 * Answers cover every question kind (scale, choice_one, choice_multi,
 * choice_exact, prediction — ~70% guess, the rest skip — rating, two_ended,
 * choice_up_to). Writes go through the service role, which bypasses RLS
 * (participant writes are limited to the open round); the answers/responses
 * guard triggers still validate every value and the submit completeness
 * rule. After every round is seeded, a deterministic ~40% of demo users get
 * a `results_consent` row (consented: true) — the trigger stamps the
 * timestamps. Also a clean removal path: `remove()` deletes demo users'
 * responses/answers explicitly, then deletes the auth users themselves —
 * `results_consent` rows cascade automatically (`on delete cascade` on
 * `user_id`), so there's nothing extra to clean up there. Never touches any
 * other user, admin_emails, or allowed_domains beyond the temporary
 * example.com add/remove this script performs around user creation.
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
// Matches src/lib/survey/messages.ts RESULTS_CONSENT_VERSION.
const RESULTS_CONSENT_VERSION = "2026-10-18";

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

type QuestionKind =
  | "scale"
  | "choice_one"
  | "choice_multi"
  | "choice_exact"
  | "prediction"
  | "rating"
  | "two_ended"
  | "choice_up_to";

interface ChoiceOption {
  value: number;
  label: string;
  exclusive?: boolean;
}

interface StatementRow {
  id: string;
  key: string;
  sectionId: string;
  scaleKey: string;
  kind: QuestionKind;
  options: ChoiceOption[];
  choiceCount: number | null;
  optional: boolean;
}

interface RoundRow {
  id: string;
  roundNumber: number;
  sessionNumber: number;
  title: string;
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

/** Deterministic per-option popularity weights for a choice question. */
function optionWeights(statementKey: string, options: ChoiceOption[]): number[] {
  const rng = rngFor(`option-weights:${statementKey}`);
  return options.map((o) => (o.exclusive ? 0.25 : 0.2 + rng() * 1.6));
}

function weightedPick(weights: number[], rng: () => number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      return i;
    }
  }
  return weights.length - 1;
}

function sampleChoiceOne(s: StatementRow, userIndex: number): number {
  const rng = rngFor(`choice-one:${s.key}:${userIndex}`);
  return s.options[weightedPick(optionWeights(s.key, s.options), rng)].value;
}

/** choice_exact: weighted sample of exactly choiceCount distinct options. */
function sampleChoiceExact(s: StatementRow, userIndex: number): number[] {
  const rng = rngFor(`choice-exact:${s.key}:${userIndex}`);
  const count = s.choiceCount ?? 1;
  const pool = s.options.map((o, i) => ({
    value: o.value,
    weight: optionWeights(s.key, s.options)[i],
  }));
  const picked: number[] = [];
  while (picked.length < count && pool.length > 0) {
    const idx = weightedPick(
      pool.map((p) => p.weight),
      rng
    );
    picked.push(pool.splice(idx, 1)[0].value);
  }
  return picked.sort((a, b) => a - b);
}

/**
 * choice_multi: each non-exclusive option independently with a
 * per-option probability; nobody who picked something also picks the
 * exclusive option ("None of these"), and anyone who picked nothing gets
 * it (or, if the question has no exclusive option, one weighted pick).
 */
function sampleChoiceMulti(s: StatementRow, userIndex: number): number[] {
  const rng = rngFor(`choice-multi:${s.key}:${userIndex}`);
  const weights = optionWeights(s.key, s.options);
  const picked = s.options
    .filter((o, i) => !o.exclusive && rng() < Math.min(0.85, weights[i] * 0.35))
    .map((o) => o.value);
  if (picked.length > 0) {
    return picked.sort((a, b) => a - b);
  }
  const exclusive = s.options.find((o) => o.exclusive);
  if (exclusive) {
    return [exclusive.value];
  }
  return [s.options[weightedPick(weights, rng)].value];
}

/** ~70% of people guess (0..100), the rest skip (null). */
function samplePrediction(s: StatementRow, userIndex: number): number | null {
  const rng = rngFor(`prediction:${s.key}:${userIndex}`);
  if (rng() >= 0.7) {
    return null;
  }
  return clampInt(48 + gaussian(rng) * 20, 0, 100);
}

/** rating (0..10): a per-key centre in ~1.5..8.5, plus user bias and noise. */
function sampleRating(s: StatementRow, userIndex: number): number {
  const centreRng = rngFor(`rating-centre:${s.key}`);
  const centre = 1.5 + centreRng() * 7;
  const rng = rngFor(`rating:${s.key}:${userIndex}`);
  const noise = gaussian(rng) * 1.1;
  const bias = userBias(userIndex) * 0.8;
  return clampInt(centre + bias + noise, 0, 10);
}

/** two_ended (0..100): centred around the midpoint, with noise. */
function sampleTwoEnded(s: StatementRow, userIndex: number): number {
  const rng = rngFor(`two-ended:${s.key}:${userIndex}`);
  const noise = gaussian(rng) * 16;
  const bias = userBias(userIndex) * 8;
  return clampInt(45 + bias + noise, 0, 100);
}

/**
 * choice_up_to: ~10% pick the exclusive option alone; everyone else gets a
 * weighted sample, without replacement, of 1..choiceCount non-exclusive
 * options, sorted ascending.
 */
function sampleChoiceUpTo(s: StatementRow, userIndex: number): number[] {
  const rng = rngFor(`choice-up-to:${s.key}:${userIndex}`);
  const exclusive = s.options.find((o) => o.exclusive);
  if (exclusive && rng() < 0.1) {
    return [exclusive.value];
  }
  const max = s.choiceCount ?? 1;
  const countRng = rngFor(`choice-up-to-count:${s.key}:${userIndex}`);
  const nonExclusive = s.options.filter((o) => !o.exclusive);
  const count = Math.max(1, Math.min(max, Math.ceil(countRng() * max)));
  const weights = optionWeights(s.key, nonExclusive);
  const pool = nonExclusive.map((o, i) => ({ value: o.value, weight: weights[i] }));
  const picked: number[] = [];
  const pickRng = rngFor(`choice-up-to-pick:${s.key}:${userIndex}`);
  while (picked.length < count && pool.length > 0) {
    const idx = weightedPick(
      pool.map((p) => p.weight),
      pickRng
    );
    picked.push(pool.splice(idx, 1)[0].value);
  }
  return picked.sort((a, b) => a - b);
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

async function fetchSurveyRounds(client: AdminClient): Promise<RoundRow[]> {
  const { data, error } = await client
    .from("rounds")
    .select("id, round_number, session_number, title")
    .order("session_number");
  if (error) {
    throw error;
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    roundNumber: r.round_number as number,
    sessionNumber: r.session_number as number,
    title: r.title as string,
  }));
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
    .select("id, key, section_id, kind, options, choice_count, optional")
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
    kind: s.kind as QuestionKind,
    options: (s.options as ChoiceOption[] | null) ?? [],
    choiceCount: (s.choice_count as number | null) ?? null,
    optional: s.optional as boolean,
  }));
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

function answerRowFor(
  s: StatementRow,
  userIndex: number,
  profiles: Map<string, StatementProfile>,
  scaleRanges: Map<string, ScaleRange>
): { value: number | null; choice_values: number[] | null } | null {
  switch (s.kind) {
    case "scale": {
      const profile = profiles.get(s.key);
      if (!profile) {
        throw new Error(`No profile computed for statement ${s.key}`);
      }
      const range = scaleRanges.get(s.scaleKey) ?? { min: 1, max: 5 };
      return { value: sampleValue(profile, range, userIndex, s.key), choice_values: null };
    }
    case "choice_one":
      return { value: sampleChoiceOne(s, userIndex), choice_values: null };
    case "choice_multi":
      return { value: null, choice_values: sampleChoiceMulti(s, userIndex) };
    case "choice_exact":
      return { value: null, choice_values: sampleChoiceExact(s, userIndex) };
    case "prediction": {
      const guess = samplePrediction(s, userIndex);
      return guess == null ? null : { value: guess, choice_values: null };
    }
    case "rating":
      return { value: sampleRating(s, userIndex), choice_values: null };
    case "two_ended":
      return { value: sampleTwoEnded(s, userIndex), choice_values: null };
    case "choice_up_to":
      return { value: null, choice_values: sampleChoiceUpTo(s, userIndex) };
  }
}

async function seedRound(
  client: AdminClient,
  round: RoundRow,
  emails: string[],
  userIdByEmail: Map<string, string>,
  scaleRanges: Map<string, ScaleRange>,
  partialEmails: Set<string>
): Promise<void> {
  const statements = await fetchRoundStatements(client, round.id);
  if (statements.length === 0) {
    console.log(`Skip round ${round.roundNumber} (no statements).`);
    return;
  }

  const profiles = new Map<string, StatementProfile>(
    statements
      .filter((s) => s.kind === "scale")
      .map((s) => [
        s.key,
        profileFor(
          s.key,
          s.scaleKey,
          scaleRanges.get(s.scaleKey) ?? { min: 1, max: 5 }
        ),
      ])
  );

  const { data: existingResponses, error: existingResponsesError } =
    await client.from("responses").select("id, user_id").eq("round_id", round.id);
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
      console.log(`Skip (response exists): ${email} round ${round.roundNumber}`);
      continue;
    }

    const userIndex = i + 1;
    const isPartial = partialEmails.has(email);
    const startedAt = startedAtFor(userIndex + round.roundNumber * 100);

    const { data: responseRow, error: responseError } = await client
      .from("responses")
      .insert({ round_id: round.id, user_id: userId, created_at: startedAt })
      .select("id")
      .single();
    if (responseError || !responseRow) {
      throw responseError ?? new Error(`Failed to create response for ${email}`);
    }
    const responseId = responseRow.id as string;

    let statementsToAnswer = statements;
    if (isPartial) {
      const countRng = rngFor(`partial-count:${round.roundNumber}:${userIndex}`);
      const answerCount = Math.max(
        1,
        Math.round(statements.length * (0.3 + countRng() * 0.3))
      );
      statementsToAnswer = seededSampleWithoutReplacement(
        statements,
        answerCount,
        rngFor(`partial-pick:${round.roundNumber}:${userIndex}`)
      );
    }

    const answerRows = statementsToAnswer.flatMap((s) => {
      const payload = answerRowFor(s, userIndex, profiles, scaleRanges);
      return payload
        ? [
            {
              response_id: responseId,
              round_id: round.id,
              statement_id: s.id,
              ...payload,
            },
          ]
        : [];
    });

    const { error: answersError } = await client.from("answers").insert(answerRows);
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
      `Round ${round.roundNumber} ${isPartial ? "started" : "submitted"}: ${email} (${
        answerRows.length
      }/${statements.length} answers)`
    );
  }

  console.log(
    `Round ${round.roundNumber} (${round.title}): ${submittedCount} submitted, ${partialCount} started.`
  );
}

/**
 * Upserts a `results_consent` row (consented: true) for a deterministic
 * ~40% of demo users. The results_consent_before_write trigger stamps
 * consented_at/updated_at from the DB clock.
 */
async function seedResultsConsent(
  client: AdminClient,
  emails: string[],
  userIdByEmail: Map<string, string>
): Promise<void> {
  const rng = rngFor("results-consent");
  const rows = emails
    .filter(() => rng() < 0.4)
    .map((email) => {
      const userId = userIdByEmail.get(email);
      if (!userId) {
        throw new Error(`No auth user id resolved for ${email}`);
      }
      return {
        user_id: userId,
        consented: true,
        consent_text_version: RESULTS_CONSENT_VERSION,
      };
    });

  if (rows.length === 0) {
    console.log("No demo users selected for results_consent this run.");
    return;
  }

  const { error } = await client
    .from("results_consent")
    .upsert(rows, { onConflict: "user_id" });
  if (error) {
    throw error;
  }
  console.log(`Seeded results_consent for ${rows.length} demo user(s).`);
}

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

    const rounds = await fetchSurveyRounds(client);
    if (rounds.length === 0) {
      throw new Error("No rounds exist — cannot seed responses.");
    }
    const scaleRanges = await fetchScaleRanges(client);

    for (const round of rounds) {
      // Partial (started, not submitted) responses only in session 1 —
      // the open one; later sessions get every demo user submitted.
      const partialEmails =
        round.sessionNumber === 1 ? PARTIAL_EMAILS : new Set<string>();
      await seedRound(client, round, emails, userIdByEmail, scaleRanges, partialEmails);
    }

    await seedResultsConsent(client, emails, userIdByEmail);
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
