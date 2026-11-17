import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  testEmail,
  adminClient,
  grantTestAdmin,
  revokeTestAdmin,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
} from "../support/supabase-admin";
import {
  createTestRoundCopiedFrom,
  createTestParticipantUser,
  openTestRound,
  closeTestRound,
  deleteTestRound,
  signInViaCodePage,
  type CopiedStatement,
  type CopiedTestRound,
} from "../support/survey-fixtures";
import { SURVEY_MESSAGES, RESULTS_CONSENT_VERSION } from "@/lib/survey/messages";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";
import { PRESENTATION_MESSAGES } from "@/lib/presentation/messages";
import { formatMean } from "@/lib/presentation/chart-math";

/**
 * Session 2 ("Holding space for uncertainty") end to end, on an isolated
 * COPY of the real Session 2 content.
 *
 * The real Session 2 round (a draft with null dates) and Session 1 are only
 * ever read: the fixture round is a fresh e2e round (round_number >=
 * 900000, its own "e2e-" survey) whose 9 sections / 38 statements are
 * copied from the real round with the service-role client, then opened
 * for this spec's duration only. If any other round is open (or its
 * window would overlap), every test is skipped instead of interfering.
 * afterAll closes and deletes the fixture, the test users and the test
 * admin, and proves the real Session 1 and Session 2 rows, content,
 * responses and consent are exactly as before.
 *
 * Tagged @session-2 so a parallel run of the rest of the suite can exclude
 * it (`--grep-invert @session-2`).
 */

const SESSION_1_ROUND_ID = "6bf90e9e-c628-4592-8e39-cc9c16440ea3";
const SESSION_2_ROUND_ID = "dc9e20b9-ce48-4046-9100-b6b7c5dca6a0";

const EXPECTED_LABELS = ["A", "B1", "B2", "C", "D", "E", "F", "G", "H"];
/** B1 and B2 are two parts of one question, so 9 sections are 8 questions. */
const EXPECTED_QUESTION_NUMBERS = [1, 2, 2, 3, 4, 5, 6, 7, 8];
const TOTAL_QUESTIONS = 8;
const EXPECTED_STATEMENT_COUNT = 38;
const EXPECTED_RANKING_OPTION_COUNTS: Record<string, number> = {
  A: 8,
  B1: 6,
  C: 6,
  H: 6,
};

/** "B1" -> "B"; anything else unchanged. Deliberately re-derived here
 * rather than imported, so the spec checks the app's numbering. */
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

function shownLabel(label: string): string {
  return label.match(/^([A-Z])\d$/)?.[1] ?? label;
}

/** A deterministic, non-identity ranking for the n-th ranking question:
 * the options reversed, then rotated by n. */
function chosenRanking(optionValues: number[], n: number): number[] {
  const reversed = [...optionValues].reverse();
  const shift = n % reversed.length;
  return [...reversed.slice(shift), ...reversed.slice(0, shift)];
}

/** Matches `text` only when it is not glued to a preceding digit, so
 * "0%" never matches inside "100%". */
function standalone(text: string): RegExp {
  return new RegExp(`(?<!\\d)${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

type RealRoundSnapshot = string;

/** Read-only fingerprint of a real round: its row, content counts,
 * responses, answers and per-session consent rows. */
async function snapshotRealRound(roundId: string): Promise<RealRoundSnapshot> {
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

async function legacyConsentCount(): Promise<number> {
  const { count, error } = await adminClient()
    .from("results_consent")
    .select("*", { count: "exact", head: true });
  if (error) {
    throw error;
  }
  return count ?? 0;
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

/**
 * Drags an element by its handle onto a target with real mouse events: past
 * the 5px activation distance first, then to the target's centre in steps.
 */
async function dragByHandle(
  page: Page,
  handle: Locator,
  target: Locator
): Promise<void> {
  await handle.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) {
    throw new Error("dragByHandle: handle or target is not on screen");
  }
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 15,
  });
  await page.mouse.up();
  // dnd-kit swallows clicks for a moment after a pointer drag ends (so the
  // drop isn't also a click); a person can't click again that fast.
  await page.waitForTimeout(250);
}

/**
 * Ranks every option of the ranking question on screen in `desired` order
 * (one list: numbered items on top, unranked items below), asserting
 * Continue stays disabled until every item is ranked. With `exercise`, it
 * also taps a ranked item back out (later ranks close up) and tries
 * keyboard and pointer drag-and-drop.
 */
async function rankAll(
  page: Page,
  statement: CopiedStatement,
  desired: number[],
  exercise: boolean
): Promise<void> {
  const options = statement.options ?? [];
  const total = options.length;
  const labelOf = (value: number) => {
    const option = options.find((o) => o.value === value);
    if (!option) {
      throw new Error(`rankAll: no option ${value} on ${statement.key}`);
    }
    return option.label;
  };
  // An unranked row's tap button.
  const unranked = (value: number) =>
    page.getByRole("button", {
      name: SURVEY_MESSAGES.rankingItemUnranked(labelOf(value)),
      exact: true,
    });
  // A numbered row's tap button (tapping it un-numbers the item).
  const ranked = (value: number, rank: number) =>
    page.getByRole("button", {
      name: SURVEY_MESSAGES.rankingItemRanked(labelOf(value), rank, total),
      exact: true,
    });
  const handle = (value: number) =>
    page.getByRole("button", {
      name: SURVEY_MESSAGES.rankingDragHandle(labelOf(value)),
      exact: true,
    });
  const progress = (n: number) =>
    visibleText(page, SURVEY_MESSAGES.rankingProgress(n, total), { exact: true });
  const dragging = (state: "true" | "false") =>
    page.locator(`[data-ranking-dragging="${state}"]`);
  const continueButton = page.getByRole("button", {
    name: SURVEY_MESSAGES.continueCta,
    exact: true,
  });
  // dnd-kit's keyboard sensor starts listening for keys a moment after a
  // drag is picked up (a setTimeout), so keys pressed instantly after Space
  // are lost. A person can't press that fast; the test waits it out.
  const keyboardDragReady = () => page.waitForTimeout(250);

  // A first visit: nothing ranked, every option listed once, Continue
  // disabled.
  await expect(progress(0)).toBeVisible();
  for (const option of options) {
    await expect(unranked(option.value)).toBeVisible();
  }
  // No up/down/remove buttons any more.
  await expect(page.getByRole("button", { name: /^(Move|Remove) / })).toHaveCount(0);
  await expect(continueButton).toBeDisabled();

  let start = 0;
  if (exercise) {
    expect(desired.length).toBeGreaterThanOrEqual(4);
    const [d0, d1, d2, d3] = desired;
    // Every row on screen, so pointer drags need no scrolling.
    await page.setViewportSize({ width: 1280, height: 1800 });

    await unranked(d0).click();
    await unranked(d1).click();
    await unranked(d2).click();
    await expect(ranked(d0, 1)).toBeVisible();
    await expect(ranked(d1, 2)).toBeVisible();
    await expect(ranked(d2, 3)).toBeVisible();
    await expect(progress(3)).toBeVisible();

    // Tap a numbered item: it loses its number and later ranks close up.
    await ranked(d0, 1).click();
    await expect(unranked(d0)).toBeVisible();
    await expect(ranked(d1, 1)).toBeVisible();
    await expect(ranked(d2, 2)).toBeVisible();
    await expect(progress(2)).toBeVisible();
    await expect(continueButton).toBeDisabled();

    // Re-rank it: it takes the next place, #3.
    await unranked(d0).click();
    await expect(ranked(d0, 3)).toBeVisible();

    // Keyboard drag, cancelled: the arrows and Escape belong to the drag, so
    // the page does not navigate and nothing moves.
    const urlBefore = page.url();
    await handle(d0).focus();
    await page.keyboard.press("Space");
    await expect(dragging("true")).toBeVisible();
    await keyboardDragReady();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Escape");
    await expect(dragging("false")).toBeVisible();
    expect(page.url()).toBe(urlBefore);
    await expect(ranked(d1, 1)).toBeVisible();
    await expect(ranked(d2, 2)).toBeVisible();
    await expect(ranked(d0, 3)).toBeVisible();

    // Keyboard drag, dropped one place up: #3 swaps with #2.
    await handle(d0).focus();
    await page.keyboard.press("Space");
    await expect(dragging("true")).toBeVisible();
    await keyboardDragReady();
    await page.keyboard.press("ArrowUp");
    await expect(
      page.getByRole("status").filter({
        hasText: SURVEY_MESSAGES.rankingDragOverRank(labelOf(d0), 2),
      })
    ).toHaveCount(1);
    await page.keyboard.press("Space");
    await expect(dragging("false")).toBeVisible();
    await expect(ranked(d1, 1)).toBeVisible();
    await expect(ranked(d0, 2)).toBeVisible();
    await expect(ranked(d2, 3)).toBeVisible();
    expect(page.url()).toBe(urlBefore);

    // Pointer drag between ranked rows: #2 onto #1 puts it first.
    await dragByHandle(page, handle(d0), ranked(d1, 1));
    await expect(ranked(d0, 1)).toBeVisible();
    await expect(ranked(d1, 2)).toBeVisible();
    await expect(ranked(d2, 3)).toBeVisible();

    // Pointer drag (a): an unranked item onto #1 takes that place and the
    // others shift down.
    await dragByHandle(page, handle(d3), ranked(d0, 1));
    await expect(ranked(d3, 1)).toBeVisible();
    await expect(ranked(d0, 2)).toBeVisible();
    await expect(ranked(d1, 3)).toBeVisible();
    await expect(ranked(d2, 4)).toBeVisible();
    await expect(progress(4)).toBeVisible();

    // (b) between numbered items: reorder.
    await dragByHandle(page, handle(d3), ranked(d2, 4));
    await expect(ranked(d0, 1)).toBeVisible();
    await expect(ranked(d1, 2)).toBeVisible();
    await expect(ranked(d2, 3)).toBeVisible();
    await expect(ranked(d3, 4)).toBeVisible();

    // (c) a numbered item dragged onto an unranked one loses its number.
    const spare = options.find((o) => ![d0, d1, d2, d3].includes(o.value));
    if (!spare) {
      throw new Error("rankAll: needs at least 5 options to exercise drags");
    }
    await dragByHandle(page, handle(d3), unranked(spare.value));
    await expect(unranked(d3)).toBeVisible();
    await expect(progress(3)).toBeVisible();
    await expect(ranked(d2, 3)).toBeVisible();
    await unranked(d3).click();
    await expect(ranked(d3, 4)).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 720 });
    start = 4;
  }

  for (let i = start; i < desired.length; i += 1) {
    await expect(continueButton).toBeDisabled();
    await unranked(desired[i]).click();
    await expect(ranked(desired[i], i + 1)).toBeVisible();
  }

  await expect(progress(total)).toBeVisible();
  for (let i = 0; i < desired.length; i += 1) {
    await expect(ranked(desired[i], i + 1)).toBeVisible();
  }
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
}

test.describe.serial("session 2 end to end @session-2", () => {
  const participantEmail = testEmail("participant", "s2p");
  const adminEmail = testEmail("admin", "s2a");

  let skipReason: string | null = null;
  let identitiesTouched = false;
  let R: CopiedTestRound | null = null;
  let participantId = "";
  let consentGiven = false;

  /** Statement key -> what the participant answered. */
  const expectedRankings = new Map<string, number[]>();
  const expectedValues = new Map<string, number>();

  let session1Before: RealRoundSnapshot | null = null;
  let session2Before: RealRoundSnapshot | null = null;
  let legacyConsentBefore: number | null = null;

  test.beforeAll(async () => {
    test.setTimeout(300_000);

    // Read-only baselines of the real rounds, taken before anything else.
    session1Before = await snapshotRealRound(SESSION_1_ROUND_ID);
    session2Before = await snapshotRealRound(SESSION_2_ROUND_ID);
    legacyConsentBefore = await legacyConsentCount();

    // One open round at a time: never interfere with a round that is open.
    const openNow = await roundsOpenNow();
    if (openNow.length > 0) {
      skipReason = `Skipped: another round is open right now (${openNow
        .map((r) => `"${r.title}" #${r.round_number} ${r.id}`)
        .join(", ")}). The Session 2 fixture can only be opened when no round is open.`;
      return;
    }

    identitiesTouched = true;
    await sweepStaleTestData();
    await grantTestAdmin(adminEmail);
    participantId = await createTestParticipantUser(participantEmail);

    R = await createTestRoundCopiedFrom(SESSION_2_ROUND_ID);
    expect(R.roundId).not.toBe(SESSION_2_ROUND_ID);
    expect(R.roundNumber).toBeGreaterThanOrEqual(900000);

    // The copy must be the Session 2 map the flow below is written for.
    expect(R.sections.map((s) => s.label)).toEqual(EXPECTED_LABELS);
    expect(R.statements).toHaveLength(EXPECTED_STATEMENT_COUNT);
    expect(R.sections.every((s) => !s.grouped)).toBe(true);
    expect(R.statements.every((s) => !s.optional)).toBe(true);
    for (const section of R.sections) {
      const inSection = R.statements.filter((s) => s.sectionId === section.id);
      const expectedOptions = EXPECTED_RANKING_OPTION_COUNTS[section.label ?? ""];
      if (expectedOptions !== undefined) {
        expect(inSection).toHaveLength(1);
        expect(inSection[0].kind).toBe("ranking");
        expect(inSection[0].options).toHaveLength(expectedOptions);
      }
    }
    expect(R.sections.find((s) => s.label === "B2")?.scaleKey).toBe(
      "importance_change"
    );

    try {
      await openTestRound(R.roundId, 45);
    } catch (error) {
      if ((error as { code?: string } | null)?.code === "23P01") {
        skipReason =
          "Skipped: opening the Session 2 fixture now would overlap another round's window (one open round at a time).";
        return;
      }
      throw error;
    }

    const openAfter = await roundsOpenNow();
    expect(openAfter.map((r) => r.id)).toEqual([R.roundId]);
  });

  test.afterAll(async () => {
    test.setTimeout(300_000);

    try {
      if (R) {
        await closeTestRound(R.roundId).catch(() => undefined);
        await deleteTestRound(R.roundId);
        const { count } = await adminClient()
          .from("rounds")
          .select("id", { count: "exact", head: true })
          .eq("id", R.roundId);
        expect(count ?? 0).toBe(0);
      }
    } finally {
      if (identitiesTouched) {
        await revokeTestAdmin(adminEmail).catch(() => undefined);
        await revokeTestAdmin(participantEmail).catch(() => undefined);
        for (const email of [participantEmail, adminEmail]) {
          await deleteAuthUserByEmail(email);
          expect(await countAuthUsersByEmail(email)).toBe(0);
        }
      }
    }

    // The real rounds and the legacy Session 1 consent table are untouched.
    if (session1Before !== null) {
      expect(await snapshotRealRound(SESSION_1_ROUND_ID)).toBe(session1Before);
    }
    if (session2Before !== null) {
      expect(await snapshotRealRound(SESSION_2_ROUND_ID)).toBe(session2Before);
    }
    if (legacyConsentBefore !== null) {
      expect(await legacyConsentCount()).toBe(legacyConsentBefore);
    }
  });

  test("participant answers every Session 2 question (rankings, importance_change, ratings, agreement) and submits", async ({
    page,
    context,
  }) => {
    test.skip(skipReason !== null, skipReason ?? "");
    test.setTimeout(600_000);
    const round = R!;
    const admin = adminClient();

    const { data: scaleRows, error: scaleError } = await admin
      .from("scale_options")
      .select("scale_key, value, label")
      .order("value");
    expect(scaleError).toBeNull();
    const scaleLabels = (key: string) =>
      (scaleRows ?? [])
        .filter((r) => r.scale_key === key)
        .map((r) => ({ value: r.value as number, label: r.label as string }));
    expect(scaleLabels("importance_change").map((o) => o.label)).toEqual([
      "Much less important",
      "Less important",
      "About the same",
      "More important",
      "Much more important than today",
    ]);

    await signInViaCodePage(page, context, participantEmail);
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { level: 1, name: round.title, exact: true })
    ).toBeVisible();
    await page
      .getByRole("button", { name: SURVEY_MESSAGES.beginCta, exact: true })
      .click();

    let rankingIndex = 0;

    for (let si = 0; si < round.sections.length; si += 1) {
      const section = round.sections[si];
      const sectionNumber = si + 1;
      const label = section.label ?? "";
      const questionNumber = EXPECTED_QUESTION_NUMBERS[si];
      const heading = `${shownLabel(label)}. ${section.title}`;
      if (label === "B1" || label === "B2") {
        expect(heading.startsWith("B. ")).toBe(true);
      }

      // Section break: "Question n of 8" and the "B." style heading.
      await expect(page).toHaveURL(`/survey/section/${sectionNumber}`);
      await expect(
        visibleText(page, SURVEY_MESSAGES.sectionOf(questionNumber, TOTAL_QUESTIONS), {
          exact: true,
        })
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 1, name: heading, exact: true })
      ).toBeVisible();
      await page
        .getByRole("button", { name: SURVEY_MESSAGES.continueCta, exact: true })
        .click();

      const statements = round.statements.filter((s) => s.sectionId === section.id);
      for (let j = 0; j < statements.length; j += 1) {
        const statement = statements[j];
        const isLastInSection = j === statements.length - 1;
        const isLastSection = si === round.sections.length - 1;
        const nextUrl = !isLastInSection
          ? `/survey/${statements[j + 1].key}`
          : isLastSection
            ? "/survey/review"
            : `/survey/section/${sectionNumber + 1}`;

        await expect(page).toHaveURL(`/survey/${statement.key}`);
        await expect(
          page.getByRole("heading", { level: 1, name: heading, exact: true })
        ).toBeVisible();
        await expect(
          visibleText(page,
            SURVEY_MESSAGES.sectionProgress(
              questionNumber,
              TOTAL_QUESTIONS,
              j + 1,
              statements.length,
              shownLabel(label)
            ),
            { exact: true }
          )
        ).toBeVisible();

        if (statement.kind === "ranking") {
          const desired = chosenRanking(
            (statement.options ?? []).map((o) => o.value),
            rankingIndex
          );
          await rankAll(page, statement, desired, rankingIndex === 0);
          expectedRankings.set(statement.key, desired);
          rankingIndex += 1;
        } else if (statement.kind === "rating") {
          const value = (j * 3 + si) % 11;
          const radios = page.getByRole("radiogroup").getByRole("radio");
          await expect(radios).toHaveCount(11);
          await radios.nth(value).click();
          await expect(radios.nth(value)).toBeChecked();
          await page
            .getByRole("button", { name: SURVEY_MESSAGES.submit, exact: true })
            .click();
          expectedValues.set(statement.key, value);
        } else if (statement.kind === "scale") {
          const options = scaleLabels(section.scaleKey);
          expect(options.length).toBeGreaterThan(0);
          for (const option of options) {
            await expect(
              page.getByRole("radio", { name: option.label, exact: true })
            ).toBeVisible();
          }
          const chosen = options[j % options.length];
          const radio = page.getByRole("radio", { name: chosen.label, exact: true });
          await radio.click();
          await expect(radio).toBeChecked();
          await page
            .getByRole("button", { name: SURVEY_MESSAGES.submit, exact: true })
            .click();
          expectedValues.set(statement.key, chosen.value);
        } else {
          throw new Error(
            `Unexpected statement kind "${statement.kind}" on ${statement.key}`
          );
        }

        // A save goes to the hosted database and can occasionally take a few
        // seconds; the form stays disabled until it lands.
        await expect(page).toHaveURL(nextUrl, { timeout: 30_000 });
      }
    }

    expect(rankingIndex).toBe(4);

    // Review: every question answered; give consent if it is offered.
    await expect(
      page.getByRole("heading", { level: 1, name: SURVEY_MESSAGES.reviewHeading })
    ).toBeVisible();
    await expect(
      visibleText(page,
        SURVEY_MESSAGES.reviewAnswered(
          EXPECTED_STATEMENT_COUNT,
          EXPECTED_STATEMENT_COUNT
        ),
        { exact: true }
      )
    ).toBeVisible();

    const saveButton = page.getByRole("button", {
      name: SURVEY_MESSAGES.submitAndSaveCta,
      exact: true,
    });
    const plainSubmit = page.getByRole("button", {
      name: SURVEY_MESSAGES.submitCta,
      exact: true,
    });
    await expect(saveButton.or(plainSubmit)).toBeVisible();
    if (await saveButton.isVisible()) {
      consentGiven = true;
      await saveButton.click();
    } else {
      await plainSubmit.click();
    }

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: SURVEY_MESSAGES.thanksHeading })
    ).toBeVisible();

    // DB: the response is submitted, every answer is stored, rankings are
    // full permutations in the chosen order (never sorted).
    const { data: responses, error: responsesError } = await admin
      .from("responses")
      .select("id, round_id, submitted_at")
      .eq("user_id", participantId);
    expect(responsesError).toBeNull();
    expect(responses).toHaveLength(1);
    expect(responses![0].round_id).toBe(round.roundId);
    expect(responses![0].submitted_at).not.toBeNull();

    const { data: answerRows, error: answersError } = await admin
      .from("answers")
      .select("statement_id, value, choice_values")
      .eq("response_id", responses![0].id);
    expect(answersError).toBeNull();
    expect(answerRows).toHaveLength(EXPECTED_STATEMENT_COUNT);
    const answerByStatementId = new Map(
      (answerRows ?? []).map((a) => [a.statement_id as string, a])
    );

    for (const statement of round.statements) {
      const answer = answerByStatementId.get(statement.id);
      expect(answer, `answer for ${statement.key}`).toBeDefined();
      if (statement.kind === "ranking") {
        const stored = answer!.choice_values as number[];
        const optionValues = (statement.options ?? [])
          .map((o) => o.value)
          .sort((a, b) => a - b);
        expect(answer!.value).toBeNull();
        expect(stored).toEqual(expectedRankings.get(statement.key));
        expect([...stored].sort((a, b) => a - b)).toEqual(optionValues);
        expect(stored).not.toEqual(optionValues);
      } else {
        expect(answer!.choice_values).toBeNull();
        expect(answer!.value).toBe(expectedValues.get(statement.key));
      }
    }

    // Consent is per session: a results_consent_rounds row for the fixture
    // round only if consent was given, and nothing in the legacy table.
    const { data: consentRows, error: consentError } = await admin
      .from("results_consent_rounds")
      .select("round_id, consented, consent_text_version, consented_at")
      .eq("user_id", participantId);
    expect(consentError).toBeNull();
    if (consentGiven) {
      expect(consentRows).toHaveLength(1);
      expect(consentRows![0].round_id).toBe(round.roundId);
      expect(consentRows![0].consented).toBe(true);
      expect(consentRows![0].consent_text_version).toBe(RESULTS_CONSENT_VERSION);
      expect(consentRows![0].consented_at).not.toBeNull();
    } else {
      expect(consentRows).toEqual([]);
    }

    const { count: legacyRows, error: legacyError } = await admin
      .from("results_consent")
      .select("*", { count: "exact", head: true })
      .eq("user_id", participantId);
    expect(legacyError).toBeNull();
    expect(legacyRows ?? 0).toBe(0);
    expect(await legacyConsentCount()).toBe(legacyConsentBefore);
  });

  test("admin sees the response and presents ranking and importance_change slides", async ({
    page,
    context,
  }) => {
    test.skip(skipReason !== null, skipReason ?? "");
    test.setTimeout(300_000);
    const round = R!;

    await signInViaCodePage(page, context, adminEmail);

    // Responses view (the old /responses URL redirects to the round page).
    await page.goto(`/admin/rounds/${round.roundId}/responses`);
    await expect(page).toHaveURL(`/admin/rounds/${round.roundId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: round.title, exact: true })
    ).toBeVisible();
    const row = page.locator("tbody tr", { hasText: participantEmail });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(ADMIN_MESSAGES.badgeSubmitted);
    await expect(row).toContainText(
      ADMIN_MESSAGES.answeredOf(EXPECTED_STATEMENT_COUNT, EXPECTED_STATEMENT_COUNT)
    );
    if (consentGiven) {
      await expect(row).toContainText(ADMIN_MESSAGES.optedInBadge);
    }

    // Presentation mode.
    await page
      .getByRole("link", { name: ADMIN_MESSAGES.presentResults })
      .click();
    await expect(page).toHaveURL(`/admin/rounds/${round.roundId}/present`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { level: 1, name: round.title, exact: true })
    ).toBeVisible();

    const slide = page.locator('section[aria-roledescription="slide"]');
    await expect(slide).toHaveAttribute("aria-label", /^1 of \d+$/);
    // Every step changes either the slide counter or the reveal state.
    const fingerprint = async () =>
      `${await slide.getAttribute("aria-label")}|${await slide
        .locator('.invisible[aria-hidden="true"]')
        .count()}`;

    const firstRanking = round.statements.find((s) => s.kind === "ranking")!;
    const firstRankingOrder = expectedRankings.get(firstRanking.key);
    expect(firstRankingOrder).toBeDefined();
    const b2Section = round.sections.find((s) => s.label === "B2")!;
    const firstB2 = round.statements.find((s) => s.sectionId === b2Section.id)!;
    const importanceLabels = [
      "Much less important",
      "Less important",
      "About the same",
      "More important",
      "Much more important than today",
    ];
    const firstB2Value = expectedValues.get(firstB2.key);
    expect(firstB2Value).toBeDefined();

    // Results lists are found by CSS inside the revealed (aria-hidden="false")
    // part of the slide. Right after a reveal the list is fading in, and an
    // instant role/visibility check can miss it; the assertions below wait.
    const revealedList = (ariaLabel: string) =>
      slide.locator(`[aria-hidden="false"] ul[aria-label="${ariaLabel}"]`);
    const rankingBars = revealedList(PRESENTATION_MESSAGES.rankingBarsLabel);
    const breakdown = revealedList(PRESENTATION_MESSAGES.breakdownLabel);

    let sawRanking = false;
    let sawImportance = false;

    for (let step = 0; step < 200 && !(sawRanking && sawImportance); step += 1) {
      if (!sawRanking && (await rankingBars.count()) > 0) {
        // Section A's ranking: option labels, most popular first, with the
        // mean rank (one respondent, so mean rank = their rank).
        await expect(
          page.getByRole("heading", { level: 2, name: firstRanking.text, exact: true })
        ).toBeVisible();
        await expect(
          visibleText(page, PRESENTATION_MESSAGES.rankingBarsSubtitle, { exact: true })
        ).toBeVisible();
        const items = rankingBars.locator("li");
        await expect(items).toHaveCount(firstRankingOrder!.length);
        for (let i = 0; i < firstRankingOrder!.length; i += 1) {
          const option = firstRanking.options!.find(
            (o) => o.value === firstRankingOrder![i]
          )!;
          await expect(items.nth(i)).toContainText(option.label);
          await expect(items.nth(i)).toContainText(standalone(formatMean(i + 1)));
          await expect(items.nth(i)).toContainText(
            standalone(PRESENTATION_MESSAGES.rankingFirstPercent(i === 0 ? 100 : 0))
          );
        }
        sawRanking = true;
      }

      if (
        !sawImportance &&
        (await breakdown.count()) > 0 &&
        (await page
          .getByRole("heading", { level: 2, name: firstB2.text, exact: true })
          .isVisible())
      ) {
        // B2's first statement on the importance_change scale: all five
        // labels in scale order, the one answer at 100%.
        const items = breakdown.locator("li");
        await expect(items).toHaveCount(importanceLabels.length);
        for (let i = 0; i < importanceLabels.length; i += 1) {
          await expect(items.nth(i)).toContainText(importanceLabels[i]);
          await expect(items.nth(i)).toContainText(
            standalone(i + 1 === firstB2Value ? "100%" : "0%")
          );
        }
        sawImportance = true;
      }

      if (sawRanking && sawImportance) {
        break;
      }

      const before = await fingerprint();
      await page.keyboard.press("ArrowRight");
      await expect.poll(fingerprint).not.toBe(before);
    }

    expect(sawRanking, "a ranking slide with labels and mean ranks").toBe(true);
    expect(sawImportance, "an importance_change slide").toBe(true);

    // Aggregates only: the participant's identity never reaches the deck.
    // Nothing identifying is on screen while presenting. (The admin round
    // page visited before stays mounted but hidden after the client-side
    // navigation, and that page legitimately lists emails to the admin.)
    await expect(visibleText(page, participantEmail)).toHaveCount(0);
    expect(await slide.innerHTML()).not.toContain(participantEmail);
    // A fresh load of the presentation route carries no identity at all,
    // in the markup or the serialised server payload.
    await page.goto(page.url());
    await expect(slide).toHaveAttribute("aria-label", /^1 of \d+$/);
    const content = await page.content();
    expect(content).not.toContain(participantEmail);
    expect(content).not.toContain(participantId);
  });
});
