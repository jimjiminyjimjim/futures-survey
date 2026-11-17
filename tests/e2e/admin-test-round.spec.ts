import { test, expect, type Page } from "@playwright/test";
import {
  testEmail,
  adminClient,
  grantTestAdmin,
  revokeTestAdmin,
  deleteAuthUserByEmail,
  authUserIdByEmail,
  sweepStaleTestData,
  signInAsTestUser,
} from "../support/supabase-admin";
import {
  createTestRound,
  createTestRoundCopiedFrom,
  createTestParticipantUser,
  closeTestRound,
  deleteTestRound,
  signInViaCodePage,
  type CopiedTestRound,
  type TestRound,
} from "../support/survey-fixtures";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";
import { PRESENTATION_MESSAGES } from "@/lib/presentation/messages";

/**
 * Admin test mode for an unopened round (quick task 261117-it4), end to
 * end, on isolated e2e rounds only:
 *   R  = a fresh copy of the real Session 2 content (an unopened draft)
 *   R2 = a small fixture draft
 * The real Session 1 and Session 2 rounds are only ever read: afterAll
 * proves their rows, content, responses, answers and per-session consent
 * are exactly as before.
 *
 * Covers D-01..D-07: the admin answers the draft through the participant
 * screens (no consent question), sample answers (every kind, idempotent),
 * labels (round page, dashboard, every deck step), participants can't
 * write to or read a draft, test answers never block a draft statement
 * delete, Start again / Clear, setting a date clears test answers, and
 * Open now confirms with the count, clears them and can't be undone into a
 * draft once real answers exist.
 *
 * Tagged @admin-test-round so a parallel run can exclude it.
 */

const SESSION_1_ROUND_ID = "6bf90e9e-c628-4592-8e39-cc9c16440ea3";
const SESSION_2_ROUND_ID = "dc9e20b9-ce48-4046-9100-b6b7c5dca6a0";

// The app keeps the previous screen mounted but hidden after a client-side
// navigation (cacheComponents), and getByText also matches hidden text, so
// every text lookup here is limited to what is actually on screen.
function visibleText(
  page: Page,
  text: Parameters<Page["getByText"]>[0],
  options?: Parameters<Page["getByText"]>[1]
) {
  return page.getByText(text, options).filter({ visible: true });
}

/** Read-only fingerprint of a real round: its row, content, responses,
 * answers and per-session consent rows. */
async function snapshotRealRound(roundId: string): Promise<string> {
  const client = adminClient();

  const { data: round, error } = await client
    .from("rounds")
    .select("id, round_number, title, intro, opens_at, closes_at, survey_id, session_number")
    .eq("id", roundId)
    .single();
  if (error || !round) {
    throw error ?? new Error(`snapshotRealRound: round ${roundId} not found`);
  }

  const count = async (table: string) => {
    const { count: n, error: countError } = await client
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("round_id", roundId);
    if (countError) {
      throw countError;
    }
    return n ?? 0;
  };

  const { data: sections, error: sectionsError } = await client
    .from("sections")
    .select("id, sort_order, label, title, prompt, scale_key, grouped, show_overview")
    .eq("round_id", roundId)
    .order("sort_order");
  if (sectionsError) {
    throw sectionsError;
  }

  const { data: statements, error: statementsError } = await client
    .from("statements")
    .select("id, key, kind, text, options, sort_order")
    .eq("round_id", roundId)
    .order("key");
  if (statementsError) {
    throw statementsError;
  }

  return JSON.stringify({
    round,
    sections: sections ?? [],
    statements: statements ?? [],
    responses: await count("responses"),
    answers: await count("answers"),
    consentRounds: await count("results_consent_rounds"),
  });
}

/** Every round whose window contains "now" (service role, read-only). */
async function roundsOpenNow(): Promise<
  Array<{ id: string; title: string; round_number: number }>
> {
  const nowIso = new Date().toISOString();
  const { data, error } = await adminClient()
    .from("rounds")
    .select("id, title, round_number")
    .not("opens_at", "is", null)
    .lte("opens_at", nowIso)
    .or(`closes_at.is.null,closes_at.gt.${nowIso}`);
  if (error) {
    throw error;
  }
  return (data ?? []) as Array<{ id: string; title: string; round_number: number }>;
}

type StatementSpec = {
  id: string;
  key: string;
  kind: string;
  options: Array<{ value: number; label: string; exclusive?: boolean }> | null;
  choiceCount: number | null;
  optional: boolean;
  scaleKey: string;
};

/** A round's statements in round order, with each section's scale key. */
async function loadStatementSpecs(roundId: string): Promise<StatementSpec[]> {
  const { data, error } = await adminClient()
    .from("sections")
    .select(
      "sort_order, scale_key, statements(id, key, kind, options, choice_count, optional, sort_order)"
    )
    .eq("round_id", roundId)
    .order("sort_order");
  if (error) {
    throw error;
  }
  const specs: StatementSpec[] = [];
  for (const section of (data ?? []) as Array<{
    scale_key: string;
    statements: Array<{
      id: string;
      key: string;
      kind: string;
      options: StatementSpec["options"];
      choice_count: number | null;
      optional: boolean;
      sort_order: number;
    }>;
  }>) {
    const statements = [...section.statements].sort(
      (a, b) => a.sort_order - b.sort_order
    );
    for (const s of statements) {
      specs.push({
        id: s.id,
        key: s.key,
        kind: s.kind,
        options: s.options,
        choiceCount: s.choice_count,
        optional: s.optional,
        scaleKey: section.scale_key,
      });
    }
  }
  return specs;
}

/** scale_key -> option values in value order. */
async function loadScaleValues(): Promise<Map<string, number[]>> {
  const { data, error } = await adminClient()
    .from("scale_options")
    .select("scale_key, value")
    .order("value");
  if (error) {
    throw error;
  }
  const map = new Map<string, number[]>();
  for (const row of (data ?? []) as Array<{ scale_key: string; value: number }>) {
    const list = map.get(row.scale_key) ?? [];
    list.push(row.value);
    map.set(row.scale_key, list);
  }
  return map;
}

/** One valid answer payload per kind (never an identity). */
function validAnswer(
  spec: StatementSpec,
  scales: Map<string, number[]>
): { value: number | null; choice_values: number[] | null } {
  const all = (spec.options ?? []).map((o) => o.value);
  const plain = (spec.options ?? [])
    .filter((o) => !o.exclusive)
    .map((o) => o.value);
  switch (spec.kind) {
    case "scale":
      return { value: (scales.get(spec.scaleKey) ?? [])[0], choice_values: null };
    case "choice_one":
      return { value: plain[0], choice_values: null };
    case "choice_multi":
    case "choice_up_to":
      return { value: null, choice_values: [plain[0]] };
    case "choice_exact":
      return { value: null, choice_values: plain.slice(0, spec.choiceCount ?? 1) };
    case "ranking":
      return { value: null, choice_values: all };
    case "prediction":
      return { value: 50, choice_values: null };
    case "rating":
      return { value: 5, choice_values: null };
    case "two_ended":
      return { value: 50, choice_values: null };
    default:
      throw new Error(`validAnswer: unknown kind ${spec.kind}`);
  }
}

async function countOn(table: string, roundId: string): Promise<number> {
  const { count, error } = await adminClient()
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("round_id", roundId);
  if (error) {
    throw error;
  }
  return count ?? 0;
}

test.describe.serial("admin test mode for an unopened round @admin-test-round", () => {
  const adminEmail = testEmail("admin", "tra");
  const participantEmail = testEmail("participant", "trp");

  let R: CopiedTestRound | null = null;
  let R2: TestRound | null = null;
  let adminId = "";

  let session1Before: string | null = null;
  let session2Before: string | null = null;

  async function signInAdmin(page: Page, context: Parameters<typeof signInViaCodePage>[1]) {
    await signInViaCodePage(page, context, adminEmail);
  }

  test.beforeAll(async () => {
    test.setTimeout(300_000);

    // Read-only baselines of the real rounds, taken before anything else.
    session1Before = await snapshotRealRound(SESSION_1_ROUND_ID);
    session2Before = await snapshotRealRound(SESSION_2_ROUND_ID);

    await sweepStaleTestData();
    await grantTestAdmin(adminEmail);
    await createTestParticipantUser(participantEmail);

    R = await createTestRoundCopiedFrom(SESSION_2_ROUND_ID);
    expect(R.roundId).not.toBe(SESSION_2_ROUND_ID);
    expect(R.roundNumber).toBeGreaterThanOrEqual(900000);
    R2 = await createTestRound({ window: "draft" });

    // Both are unopened drafts.
    for (const id of [R.roundId, R2.roundId]) {
      const { data, error } = await adminClient()
        .from("rounds")
        .select("opens_at, closes_at")
        .eq("id", id)
        .single();
      expect(error).toBeNull();
      expect(data?.opens_at).toBeNull();
      expect(data?.closes_at).toBeNull();
    }
  });

  test.afterAll(async () => {
    test.setTimeout(300_000);

    for (const round of [R?.roundId, R2?.roundId]) {
      if (round) {
        await closeTestRound(round);
        await deleteTestRound(round);
      }
    }
    await revokeTestAdmin(adminEmail);
    await deleteAuthUserByEmail(adminEmail);
    await deleteAuthUserByEmail(participantEmail);

    expect(await snapshotRealRound(SESSION_1_ROUND_ID)).toBe(session1Before);
    expect(await snapshotRealRound(SESSION_2_ROUND_ID)).toBe(session2Before);
  });

  test("1. the admin tests the draft through the participant screens", async ({
    page,
    context,
  }) => {
    test.setTimeout(300_000);
    const round = R!;
    const base = `/admin/rounds/${round.roundId}`;

    await signInAdmin(page, context);
    adminId = (await authUserIdByEmail(adminEmail)) ?? "";
    expect(adminId).not.toBe("");

    await page.goto(base);
    await expect(
      page.getByRole("heading", { level: 2, name: ADMIN_MESSAGES.testHeading, exact: true })
    ).toBeVisible();
    await page.getByRole("link", { name: ADMIN_MESSAGES.testTakeCta, exact: true }).click();
    await expect(page).toHaveURL(`${base}/test`);
    await expect(visibleText(page, ADMIN_MESSAGES.testBanner)).toBeVisible();

    await page.getByRole("button", { name: SURVEY_MESSAGES.beginCta, exact: true }).click();
    await expect(page).toHaveURL(`${base}/test/survey/section/1`);
    await page.getByRole("button", { name: SURVEY_MESSAGES.continueCta, exact: true }).click();

    // The first question is a ranking: rank every option in option order.
    const first = round.statements[0];
    expect(first.kind).toBe("ranking");
    await expect(page).toHaveURL(`${base}/test/survey/${first.key}`);
    const firstOptions = first.options ?? [];
    for (const [i, option] of firstOptions.entries()) {
      await page
        .getByRole("button", {
          name: SURVEY_MESSAGES.rankingItemUnranked(option.label),
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("listitem", {
          name: SURVEY_MESSAGES.rankingItemRanked(option.label, i + 1, firstOptions.length),
          exact: true,
        })
      ).toBeVisible();
    }
    await expect(
      page
        .getByText(
          SURVEY_MESSAGES.rankingProgress(firstOptions.length, firstOptions.length),
          { exact: true }
        )
        .filter({ visible: true })
    ).toBeVisible();
    const continueAfterRanking = page.getByRole("button", {
      name: SURVEY_MESSAGES.continueCta,
      exact: true,
    });
    await expect(continueAfterRanking).toBeEnabled();
    await continueAfterRanking.click();
    await expect(page).not.toHaveURL(`${base}/test/survey/${first.key}`);

    // Every other required statement through the admin's OWN JWT client:
    // this exercises the admin-only draft policies directly.
    const adminJwt = await signInAsTestUser(adminEmail);
    const { error: ensureError } = await adminJwt
      .from("responses")
      .upsert({ round_id: round.roundId }, { onConflict: "round_id,user_id", ignoreDuplicates: true });
    expect(ensureError).toBeNull();
    const { data: own, error: ownError } = await adminJwt
      .from("responses")
      .select("id, submitted_at")
      .eq("round_id", round.roundId)
      .eq("user_id", adminId)
      .single();
    expect(ownError).toBeNull();
    expect(own?.submitted_at).toBeNull();

    const specs = await loadStatementSpecs(round.roundId);
    const scales = await loadScaleValues();
    for (const spec of specs) {
      if (spec.id === first.id || spec.optional) {
        continue;
      }
      const payload = validAnswer(spec, scales);
      const { error } = await adminJwt.from("answers").upsert(
        {
          response_id: own!.id,
          round_id: round.roundId,
          statement_id: spec.id,
          ...payload,
        },
        { onConflict: "response_id,statement_id" }
      );
      expect(error, spec.key).toBeNull();
    }

    // The test home now redirects to review: no consent question.
    await page.goto(`${base}/test`);
    await expect(page).toHaveURL(`${base}/test/survey/review`);
    await expect(visibleText(page, SURVEY_MESSAGES.resultsOptInLabel)).toHaveCount(0);
    await page.getByRole("button", { name: SURVEY_MESSAGES.submitCta, exact: true }).click();
    await expect(
      visibleText(page, ADMIN_MESSAGES.testSubmittedHeading, { exact: true })
    ).toBeVisible();

    const admin = adminClient();
    const { data: responses } = await admin
      .from("responses")
      .select("user_id, submitted_at")
      .eq("round_id", round.roundId);
    expect(responses).toHaveLength(1);
    expect(responses?.[0].user_id).toBe(adminId);
    expect(responses?.[0].submitted_at).not.toBeNull();
    const { data: dates } = await admin
      .from("rounds")
      .select("opens_at, closes_at")
      .eq("id", round.roundId)
      .single();
    expect(dates?.opens_at).toBeNull();
    expect(dates?.closes_at).toBeNull();
    expect(await countOn("results_consent_rounds", round.roundId)).toBe(0);
  });

  test("2. sample answers, labels and the deck", async ({ page, context }) => {
    test.setTimeout(600_000);
    const round = R!;
    const base = `/admin/rounds/${round.roundId}`;
    const admin = adminClient();

    await signInAdmin(page, context);
    await page.goto(base);
    await page.getByRole("button", { name: ADMIN_MESSAGES.testAddSamplesCta, exact: true }).click();
    await expect(visibleText(page, ADMIN_MESSAGES.testAnswersCounts(21, 21), { exact: true })).toBeVisible();
    await expect(visibleText(page, ADMIN_MESSAGES.testAnswersNotice, { exact: true })).toBeVisible();
    await expect(visibleText(page, ADMIN_MESSAGES.testSamplesNotListed(20), { exact: true })).toBeVisible();

    // 20 submitted rows with no participant.
    const { data: samples } = await admin
      .from("responses")
      .select("id, submitted_at")
      .eq("round_id", round.roundId)
      .is("user_id", null);
    expect(samples).toHaveLength(20);
    for (const s of samples ?? []) {
      expect(s.submitted_at).not.toBeNull();
    }

    // Every answer is valid for its kind; every kind is covered.
    const specs = await loadStatementSpecs(round.roundId);
    const scales = await loadScaleValues();
    const sampleIds = (samples ?? []).map((s) => s.id as string);
    const { data: answers } = await admin
      .from("answers")
      .select("statement_id, value, choice_values")
      .in("response_id", sampleIds);
    const byStatement = new Map<string, Array<{ value: number | null; choice_values: number[] | null }>>();
    for (const a of (answers ?? []) as Array<{
      statement_id: string;
      value: number | null;
      choice_values: number[] | null;
    }>) {
      const list = byStatement.get(a.statement_id) ?? [];
      list.push(a);
      byStatement.set(a.statement_id, list);
    }
    const kindsAnswered = new Set<string>();
    for (const spec of specs) {
      const list = byStatement.get(spec.id) ?? [];
      if (list.length > 0) {
        kindsAnswered.add(spec.kind);
      }
      if (!spec.optional) {
        expect(list, spec.key).toHaveLength(20);
      }
      for (const a of list) {
        if (spec.kind === "ranking") {
          const options = (spec.options ?? []).map((o) => o.value);
          expect([...(a.choice_values ?? [])].sort((x, y) => x - y)).toEqual(
            [...options].sort((x, y) => x - y)
          );
        }
        if (spec.kind === "scale") {
          expect(scales.get(spec.scaleKey) ?? []).toContain(a.value);
        }
      }
    }
    expect(scales.get("importance_change")?.length).toBeGreaterThan(0);
    expect(specs.some((s) => s.scaleKey === "importance_change")).toBe(true);
    for (const kind of new Set(specs.map((s) => s.kind))) {
      expect(kindsAnswered.has(kind), kind).toBe(true);
    }

    // Pressing it again gives the same set (no accumulation).
    await page.getByRole("button", { name: ADMIN_MESSAGES.testAddSamplesCta, exact: true }).click();
    await expect(visibleText(page, ADMIN_MESSAGES.testAnswersCounts(21, 21), { exact: true })).toBeVisible();
    expect(await countOn("responses", round.roundId)).toBe(21);

    // Dashboard label.
    await page.goto("/admin");
    const row = page.getByRole("row").filter({ hasText: round.title });
    await expect(row).toContainText(ADMIN_MESSAGES.testAnswersSuffix.trim());

    // The CSV lists participants only: just the admin.
    const csv = await page.request.get(`${base}/export`);
    expect(csv.ok()).toBe(true);
    const lines = (await csv.text()).split("\r\n").filter((line) => line !== "");
    expect(lines.length - 1).toBe(1);

    // The deck: the label on every step.
    await page.goto(base);
    await page.getByRole("link", { name: ADMIN_MESSAGES.presentTestResults, exact: true }).click();
    await expect(page).toHaveURL(`${base}/present`);
    const notice = page.locator('[data-slot="deck-notice"]').filter({ visible: true });
    const progress = page.getByRole("progressbar", { name: "Slide progress" });
    await expect(
      page.getByRole("heading", { level: 1, name: round.title, exact: true })
    ).toBeVisible();
    for (let i = 0; i < 400; i += 1) {
      await expect(notice).toHaveCount(1);
      await expect(notice).toHaveText(PRESENTATION_MESSAGES.testAnswersLabel);
      // Every result slide has respondents, so no empty state appears.
      await expect(visibleText(page, PRESENTATION_MESSAGES.emptyHeading, { exact: true })).toHaveCount(0);
      if ((await progress.getAttribute("aria-valuenow")) === "100") {
        break;
      }
      await page.keyboard.press("ArrowRight");
    }
    await expect(progress).toHaveAttribute("aria-valuenow", "100");
  });

  test("3. participants can neither write to nor read the draft", async () => {
    const round = R!;
    const participant = await signInAsTestUser(participantEmail);

    const insert = await participant.from("responses").insert({ round_id: round.roundId });
    expect(insert.error).not.toBeNull();
    const insertNull = await participant
      .from("responses")
      .insert({ round_id: round.roundId, user_id: null });
    expect(insertNull.error).not.toBeNull();

    for (const table of ["sections", "statements", "responses", "answers"]) {
      const { data, error } = await participant
        .from(table)
        .select("*")
        .eq("round_id", round.roundId);
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }

    for (const rpc of ["admin_test_add_samples", "admin_test_clear", "admin_test_reset", "admin_statement_answer_counts"]) {
      const { error } = await participant.rpc(rpc, { p_round_id: round.roundId });
      expect(error?.code, rpc).toBe("42501");
    }

    expect(await countOn("responses", round.roundId)).toBe(21);
  });

  test("4. test answers never block editing the draft", async () => {
    const round = R!;
    const admin = adminClient();
    const specs = await loadStatementSpecs(round.roundId);

    const edited = specs.find((s) => s.kind === "scale")!;
    const { error: updateError } = await admin
      .from("statements")
      .update({ text: "e2e edited statement text" })
      .eq("id", edited.id);
    expect(updateError).toBeNull();

    // A scale statement with test answers that no prediction points at.
    const { data: predictionTargets } = await admin
      .from("statements")
      .select("prediction_of")
      .eq("round_id", round.roundId)
      .not("prediction_of", "is", null);
    const targets = new Set((predictionTargets ?? []).map((p) => p.prediction_of as string));
    const victim = [...specs]
      .reverse()
      .find((s) => s.kind === "scale" && !targets.has(s.id) && s.id !== edited.id)!;
    const { count: before } = await admin
      .from("answers")
      .select("*", { count: "exact", head: true })
      .eq("statement_id", victim.id);
    expect(before ?? 0).toBeGreaterThan(0);

    const { error: deleteError } = await admin.from("statements").delete().eq("id", victim.id);
    expect(deleteError).toBeNull();
    const { count: after } = await admin
      .from("answers")
      .select("*", { count: "exact", head: true })
      .eq("statement_id", victim.id);
    expect(after ?? 0).toBe(0);
  });

  test("5. Start again and Clear test answers", async ({ page, context }) => {
    const round = R!;
    const base = `/admin/rounds/${round.roundId}`;
    const admin = adminClient();

    await signInAdmin(page, context);
    await page.goto(`${base}/test`);
    await page.getByRole("button", { name: ADMIN_MESSAGES.testStartAgainCta, exact: true }).click();
    await expect(
      page.getByRole("button", { name: SURVEY_MESSAGES.beginCta, exact: true })
    ).toBeVisible();

    const { count: own } = await admin
      .from("responses")
      .select("*", { count: "exact", head: true })
      .eq("round_id", round.roundId)
      .eq("user_id", adminId);
    expect(own ?? 0).toBe(0);
    const { count: samples } = await admin
      .from("responses")
      .select("*", { count: "exact", head: true })
      .eq("round_id", round.roundId)
      .is("user_id", null);
    expect(samples ?? 0).toBe(20);

    await page.goto(base);
    await page.getByRole("button", { name: ADMIN_MESSAGES.testClearCta, exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: ADMIN_MESSAGES.testClearConfirm, exact: true })
      .click();
    await expect(visibleText(page, ADMIN_MESSAGES.testAnswersCounts(0, 0), { exact: true })).toBeVisible();
    expect(await countOn("responses", round.roundId)).toBe(0);
    expect(await countOn("answers", round.roundId)).toBe(0);
  });

  test("6. setting a date clears test answers", async ({ page, context }) => {
    const round2 = R2!;
    const admin = adminClient();
    const adminJwt = await signInAsTestUser(adminEmail);

    const added = await adminJwt.rpc("admin_test_add_samples", { p_round_id: round2.roundId });
    expect(added.error).toBeNull();
    expect(await countOn("responses", round2.roundId)).toBe(20);

    const { data: row } = await admin
      .from("rounds")
      .select("title")
      .eq("id", round2.roundId)
      .single();
    const updated = await adminJwt.rpc("admin_update_round", {
      p_round_id: round2.roundId,
      p_title: row?.title as string,
      p_opens_at: null,
      p_closes_at: "2099-01-01T00:00:00Z",
    });
    expect(updated.error).toBeNull();
    expect(await countOn("responses", round2.roundId)).toBe(0);
    expect(await countOn("answers", round2.roundId)).toBe(0);

    const again = await adminJwt.rpc("admin_test_add_samples", { p_round_id: round2.roundId });
    expect(again.error).not.toBeNull();
    expect(again.error?.hint).toBe("round_not_draft");

    await signInAdmin(page, context);
    await page.goto(`/admin/rounds/${round2.roundId}`);
    await expect(
      page.getByRole("heading", { level: 2, name: ADMIN_MESSAGES.testHeading, exact: true })
    ).toHaveCount(0);
  });

  test("7. Open now confirms, clears test answers; an opened round can't return to draft", async ({
    page,
    context,
  }) => {
    test.setTimeout(300_000);
    const openNow = await roundsOpenNow();
    if (openNow.length > 0) {
      test.info().annotations.push({
        type: "skip-reason",
        description: `another round is open (${openNow.map((r) => r.id).join(", ")})`,
      });
      test.skip(true, "Another round is open right now; Open now can't be exercised.");
      return;
    }

    const round = R!;
    const base = `/admin/rounds/${round.roundId}`;
    const admin = adminClient();

    await signInAdmin(page, context);
    await page.goto(base);
    await page.getByRole("button", { name: ADMIN_MESSAGES.testAddSamplesCta, exact: true }).click();
    await expect(visibleText(page, ADMIN_MESSAGES.testAnswersCounts(20, 20), { exact: true })).toBeVisible();

    await page.getByRole("button", { name: ADMIN_MESSAGES.openNow, exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(ADMIN_MESSAGES.openNowClearsTestAnswers(20));
    await dialog
      .getByRole("button", { name: ADMIN_MESSAGES.openNowTestConfirm, exact: true })
      .click();

    await expect(visibleText(page, ADMIN_MESSAGES.responsesCounts(0, 0), { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: ADMIN_MESSAGES.testHeading, exact: true })
    ).toHaveCount(0);

    const { data: opened } = await admin
      .from("rounds")
      .select("opens_at")
      .eq("id", round.roundId)
      .single();
    expect(opened?.opens_at).not.toBeNull();
    expect(await countOn("responses", round.roundId)).toBe(0);
    expect(await countOn("answers", round.roundId)).toBe(0);
    expect(await countOn("results_consent_rounds", round.roundId)).toBe(0);

    // A real participant answer on the now-open round.
    const participant = await signInAsTestUser(participantEmail);
    const { error: ensureError } = await participant
      .from("responses")
      .upsert({ round_id: round.roundId }, { onConflict: "round_id,user_id", ignoreDuplicates: true });
    expect(ensureError).toBeNull();
    const { data: real } = await participant
      .from("responses")
      .select("id")
      .eq("round_id", round.roundId)
      .single();
    const specs = await loadStatementSpecs(round.roundId);
    const scales = await loadScaleValues();
    const { error: answerError } = await participant.from("answers").insert({
      response_id: real!.id,
      round_id: round.roundId,
      statement_id: specs[0].id,
      ...validAnswer(specs[0], scales),
    });
    expect(answerError).toBeNull();

    const adminJwt = await signInAsTestUser(adminEmail);
    for (const rpc of ["admin_test_add_samples", "admin_test_clear"]) {
      const { error } = await adminJwt.rpc(rpc, { p_round_id: round.roundId });
      expect(error?.hint, rpc).toBe("round_not_draft");
    }
    expect(await countOn("responses", round.roundId)).toBe(1);

    const backToDraft = await admin
      .from("rounds")
      .update({ opens_at: null, closes_at: null })
      .eq("id", round.roundId);
    expect(backToDraft.error?.code).toBe("23514");
    expect(backToDraft.error?.hint).toBe("round_has_responses");
    expect(await countOn("responses", round.roundId)).toBe(1);

    await closeTestRound(round.roundId);
  });
});
