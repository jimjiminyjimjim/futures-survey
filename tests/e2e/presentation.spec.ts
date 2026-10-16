import { test, expect, type Locator } from "@playwright/test";
import {
  testEmail,
  grantTestAdmin,
  revokeTestAdmin,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  authUserIdByEmail,
  sweepStaleTestData,
  adminClient,
  RUN_ID,
} from "../support/supabase-admin";
import {
  createTestRound,
  deleteTestRound,
  seedRoundResponses,
  signInViaCodePage,
  snapshotRound1,
  pastWindowFor,
  type TestRound,
} from "../support/survey-fixtures";
import { collectTextContrast } from "../support/contrast";

/**
 * WCAG AA minimums (1.4.3): 4.5:1 for normal text, 3:1 for "large" text
 * (>=24px, or >=18.66px bold) — same thresholds survey-contrast.spec.ts
 * uses for Phase 2's screens.
 */
const NORMAL_TEXT_MIN = 4.5;
const LARGE_TEXT_MIN = 3;

async function assertDeckContrast(locator: Locator, label: string): Promise<void> {
  await expect(locator).toBeVisible();
  const info = await locator.evaluate(collectTextContrast);
  const threshold = info.isLarge ? LARGE_TEXT_MIN : NORMAL_TEXT_MIN;
  expect(
    info.ratio,
    `${label}: ${info.ratio.toFixed(2)}:1 (fg ${info.fg} on bg ${info.bg}, ${info.fontSize}px/${info.fontWeight}) below ${threshold}:1`
  ).toBeGreaterThanOrEqual(threshold);
}

/**
 * PRES-01..05's read path: an admin launches a closed round's
 * presentation from the dashboard and steps through its agreement
 * statements, each with counts, percentages, net agreement and
 * respondents computed from submitted answers only. Round 1 is opened
 * read-only (never asserted on beyond navigation) — see "Round 1
 * read-only" in Task 3.
 */
test.describe.serial("presentation @presentation", () => {
  const adminEmail = testEmail("admin", "pres");
  const paEmail = testEmail("participant", "pa");
  const pbEmail = testEmail("participant", "pb");
  const pcEmail = testEmail("participant", "pc");
  const pdEmail = testEmail("participant", "pd");

  let round1SnapshotBefore: string;
  let R: TestRound;
  let responseIds: Record<string, string>;

  test.beforeAll(async () => {
    await sweepStaleTestData();
    round1SnapshotBefore = await snapshotRound1();
    await grantTestAdmin(adminEmail);

    R = await createTestRound({
      window: "closed",
      sections: [{ scaleKey: "agreement", statementCount: 2 }],
    });

    responseIds = await seedRoundResponses(R.roundId, [
      { email: paEmail, answers: { e2e_s1_01: 5, e2e_s1_02: 3 }, submit: true },
      { email: pbEmail, answers: { e2e_s1_01: 4, e2e_s1_02: 3 }, submit: true },
      { email: pcEmail, answers: { e2e_s1_01: 1, e2e_s1_02: 2 }, submit: true },
      { email: pdEmail, answers: { e2e_s1_01: 1 }, submit: false },
    ]);
  });

  test.afterAll(async () => {
    await deleteTestRound(R.roundId).catch(() => undefined);
    await revokeTestAdmin(adminEmail).catch(() => undefined);
    for (const email of [adminEmail, paEmail, pbEmail, pcEmail, pdEmail]) {
      await deleteAuthUserByEmail(email);
      expect(await countAuthUsersByEmail(email)).toBe(0);
    }

    const round1SnapshotAfter = await snapshotRound1();
    expect(round1SnapshotAfter).toBe(round1SnapshotBefore);
  });

  test("launch and step through", async ({ page, context }) => {
    await signInViaCodePage(page, context, adminEmail);
    await page.goto("/admin");

    const roundTitle = `e2e-${RUN_ID}-${R.roundNumber}`;
    const row = page.locator("tbody tr", {
      hasText: `Round ${R.roundNumber} ·`,
    });
    await row.getByRole("button", { name: /Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Present results" }).click();
    await expect(page).toHaveURL(`/admin/rounds/${R.roundId}/present`);

    await expect(
      page.getByRole("heading", { level: 1, name: roundTitle })
    ).toBeVisible();
    await expect(page.getByText("3 respondents")).toBeVisible();
    await expect(page.getByText("1 of 4")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Previous slide" })
    ).toBeDisabled();

    // Forced-dark canvas contrast backstop (automated WCAG AA check,
    // tests/support/contrast.ts): title heading, respondent line, slide
    // counter and the keyboard-hint pill.
    await assertDeckContrast(
      page.getByRole("heading", { level: 1, name: roundTitle }),
      "title heading"
    );
    await assertDeckContrast(
      page.getByText("3 respondents"),
      "title respondent count"
    );
    await assertDeckContrast(page.getByText("1 of 4"), "slide counter");
    await assertDeckContrast(
      page.getByText(/to navigate.*Space to advance/),
      "keyboard hint"
    );

    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("heading", { level: 2, name: "e2e section 1" })
    ).toBeVisible();
    await expect(page.getByText("e2e prompt 1")).toBeVisible();
    await expect(page.getByText("2 statements", { exact: true })).toBeVisible();
    await expect(page.getByText("2 of 4")).toBeVisible();

    await assertDeckContrast(
      page.getByRole("heading", { level: 2, name: "e2e section 1" }),
      "section-intro heading"
    );
    await assertDeckContrast(
      page.getByText("2 statements", { exact: true }),
      "section-intro statement count"
    );

    await page.keyboard.press(" ");
    const breakdown1 = page.getByRole("list", { name: "Answer breakdown" });
    await expect(breakdown1).toContainText("Strongly disagree");
    await assertDeckContrast(
      page.getByText("e2e section 1", { exact: true }),
      "statement-slide section label"
    );
    const items1 = breakdown1.locator("li");
    await expect(items1.nth(0)).toContainText("1 · 33%");
    await expect(items1.nth(1)).toContainText("0 · 0%");
    await expect(items1.nth(2)).toContainText("0 · 0%");
    await expect(items1.nth(3)).toContainText("1 · 33%");
    await expect(items1.nth(4)).toContainText("1 · 33%");
    await expect(page.getByText("+33 net agreement")).toBeVisible();
    await expect(page.getByText("3 respondents")).toBeVisible();

    await page.getByRole("heading", { level: 2 }).click();
    const breakdown2 = page.getByRole("list", { name: "Answer breakdown" });
    const items2 = breakdown2.locator("li");
    await expect(items2.nth(0)).toContainText("0 · 0%");
    await expect(items2.nth(1)).toContainText("1 · 33%");
    await expect(items2.nth(2)).toContainText("2 · 67%");
    await expect(items2.nth(3)).toContainText("0 · 0%");
    await expect(items2.nth(4)).toContainText("0 · 0%");
    await expect(page.getByText("−33 net agreement")).toBeVisible();
    await expect(page.getByText("4 of 4")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next slide" })).toBeDisabled();

    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("4 of 4")).toBeVisible();

    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText("3 of 4")).toBeVisible();

    const content = await page.content();
    for (const email of [paEmail, pbEmail, pcEmail, pdEmail]) {
      expect(content).not.toContain(email);
      const userId = await authUserIdByEmail(email);
      if (userId) {
        expect(content).not.toContain(userId);
      }
    }
    for (const responseId of Object.values(responseIds)) {
      expect(content).not.toContain(responseId);
    }
  });

  test("familiarity and overview", async ({ page, context }) => {
    const faEmail = testEmail("participant", "fa");
    const fbEmail = testEmail("participant", "fb");

    const F = await createTestRound({
      window: "closed",
      sections: [
        { scaleKey: "familiarity", statementCount: 3 },
        { scaleKey: "agreement", statementCount: 1 },
      ],
    });

    try {
      await seedRoundResponses(F.roundId, [
        {
          email: faEmail,
          answers: { e2e_s1_01: 1, e2e_s1_02: 4, e2e_s1_03: 2, e2e_s2_01: 3 },
          submit: true,
        },
        {
          email: fbEmail,
          answers: { e2e_s1_01: 2, e2e_s1_02: 4, e2e_s1_03: 2, e2e_s2_01: 3 },
          submit: true,
        },
      ]);

      await signInViaCodePage(page, context, adminEmail);
      await page.goto(`/admin/rounds/${F.roundId}/present`);
await page.waitForLoadState("networkidle");

      await expect(page.getByText("1 of 8")).toBeVisible();

      // Slide 3 (index 2): the first familiarity statement (e2e_s1_01,
      // answers 1 and 2 -> one each).
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await expect(page.getByText("3 of 8")).toBeVisible();
      const breakdownF = page.getByRole("list", { name: "Answer breakdown" });
      await expect(breakdownF).toContainText("I've never heard of it");
      await expect(breakdownF).toContainText(
        "I've heard of it but couldn't explain it"
      );
      const itemsF = breakdownF.locator("li");
      await expect(itemsF.nth(0)).toContainText("1 · 50%");
      await expect(itemsF.nth(1)).toContainText("1 · 50%");
      await expect(itemsF.nth(2)).toContainText("0 · 0%");
      await expect(itemsF.nth(3)).toContainText("0 · 0%");
      await expect(page.getByText(/net agreement/)).toHaveCount(0);

      // Slide 6 (index 5): the familiarity overview, ranked 4.0, 2.0, 1.5.
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await expect(page.getByText("6 of 8")).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: "Familiarity overview" })
      ).toBeVisible();
      await expect(
        page.getByText("Section 1 · ranked by average familiarity, most familiar first")
      ).toBeVisible();
      const ranking = page.getByRole("list", {
        name: "Terms ranked by average familiarity",
      });
      const rankedRows = ranking.locator("li");
      await expect(rankedRows.nth(0)).toContainText("e2e statement 1-2");
      await expect(rankedRows.nth(0)).toContainText("4.0");
      await expect(rankedRows.nth(1)).toContainText("e2e statement 1-3");
      await expect(rankedRows.nth(1)).toContainText("2.0");
      await expect(rankedRows.nth(2)).toContainText("e2e statement 1-1");
      await expect(rankedRows.nth(2)).toContainText("1.5");

      // Slide 7 (index 6): the section-2 intro.
      await page.keyboard.press("ArrowRight");
      await expect(page.getByText("7 of 8")).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: "e2e section 2" })
      ).toBeVisible();
    } finally {
      await deleteTestRound(F.roundId).catch(() => undefined);
      await deleteAuthUserByEmail(faEmail);
      await deleteAuthUserByEmail(fbEmail);
      expect(await countAuthUsersByEmail(faEmail)).toBe(0);
      expect(await countAuthUsersByEmail(fbEmail)).toBe(0);
    }
  });

  test("edge states: zero respondents, one respondent, empty structures, long text", async ({
    page,
    context,
  }) => {
    const roundIds: string[] = [];
    const emails: string[] = [];

    try {
      await signInViaCodePage(page, context, adminEmail);

      // Z: zero respondents, one agreement + one familiarity section, no
      // responses at all.
      const Z = await createTestRound({
        window: "closed",
        sections: [
          { scaleKey: "agreement", statementCount: 1 },
          { scaleKey: "familiarity", statementCount: 1 },
        ],
      });
      roundIds.push(Z.roundId);

      await page.goto(`/admin/rounds/${Z.roundId}/present`);
await page.waitForLoadState("networkidle");
      await expect(page.getByText("0 respondents")).toBeVisible();
      await expect(page.getByText("1 of 6")).toBeVisible();

      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await expect(page.getByText("3 of 6")).toBeVisible();
      const chartSurface = page.locator('[data-slot="chart"]').first();
      const chartBox = await chartSurface.boundingBox();
      expect(chartBox).not.toBeNull();
      expect(chartBox!.width).toBeGreaterThan(0);
      expect(chartBox!.height).toBeGreaterThan(0);
      const zAgreementItems = page
        .getByRole("list", { name: "Answer breakdown" })
        .locator("li");
      await expect(zAgreementItems).toHaveCount(5);
      for (let i = 0; i < 5; i += 1) {
        await expect(zAgreementItems.nth(i)).toContainText("0 · 0%");
      }
      await expect(page.getByText("No respondents yet")).toBeVisible();
      await expect(
        page.getByText(
          "Results will appear here once participants submit answers for this round."
        )
      ).toBeVisible();
      await expect(page.getByText("net agreement")).toHaveCount(0);

      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await expect(page.getByText("5 of 6")).toBeVisible();
      const zFamiliarityItems = page
        .getByRole("list", { name: "Answer breakdown" })
        .locator("li");
      await expect(zFamiliarityItems).toHaveCount(4);
      for (let i = 0; i < 4; i += 1) {
        await expect(zFamiliarityItems.nth(i)).toContainText("0 · 0%");
      }
      await expect(page.getByText("No respondents yet")).toBeVisible();

      await page.keyboard.press("ArrowRight");
      await expect(page.getByText("6 of 6")).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: "Familiarity overview" })
      ).toBeVisible();
      await expect(page.getByText("No respondents yet")).toBeVisible();
      const zOverviewRows = page
        .getByRole("list", { name: "Terms ranked by average familiarity" })
        .locator("li");
      await expect(zOverviewRows).toHaveCount(1);
      await expect(zOverviewRows.nth(0)).toContainText("0.0");

      // O: one respondent, one agreement statement, answered 2 (Disagree).
      const O = await createTestRound({
        window: "closed",
        sections: [{ scaleKey: "agreement", statementCount: 1 }],
      });
      roundIds.push(O.roundId);
      const oEmail = testEmail("participant", "oe");
      emails.push(oEmail);
      await seedRoundResponses(O.roundId, [
        { email: oEmail, answers: { e2e_s1_01: 2 }, submit: true },
      ]);

      await page.goto(`/admin/rounds/${O.roundId}/present`);
await page.waitForLoadState("networkidle");
      await expect(page.getByText("1 respondent")).toBeVisible();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      const oItems = page
        .getByRole("list", { name: "Answer breakdown" })
        .locator("li");
      await expect(oItems.nth(0)).toContainText("0 · 0%");
      await expect(oItems.nth(1)).toContainText("1 · 100%");
      await expect(oItems.nth(2)).toContainText("0 · 0%");
      await expect(oItems.nth(3)).toContainText("0 · 0%");
      await expect(oItems.nth(4)).toContainText("0 · 0%");
      await expect(page.getByText("−100 net agreement")).toBeVisible();

      // E1: no sections at all -> a one-slide deck.
      const E1 = await createTestRound({ window: "closed", sections: [] });
      roundIds.push(E1.roundId);

      await page.goto(`/admin/rounds/${E1.roundId}/present`);
await page.waitForLoadState("networkidle");
      await expect(page.getByText("1 of 1")).toBeVisible();
      await expect(page.getByText("0 respondents")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Previous slide" })
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Next slide" })
      ).toBeDisabled();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press(" ");
      await expect(page.getByText("1 of 1")).toBeVisible();

      // E2: a zero-statement section immediately followed by the next
      // section's intro.
      const E2 = await createTestRound({
        window: "closed",
        sections: [
          { scaleKey: "agreement", statementCount: 0 },
          { scaleKey: "agreement", statementCount: 1 },
        ],
      });
      roundIds.push(E2.roundId);

      await page.goto(`/admin/rounds/${E2.roundId}/present`);
await page.waitForLoadState("networkidle");
      await page.keyboard.press("ArrowRight");
      await expect(page.getByText("0 statements", { exact: true })).toBeVisible();
      await expect(page.getByText("2 of 4")).toBeVisible();
      await page.keyboard.press("ArrowRight");
      await expect(
        page.getByRole("heading", { level: 2, name: "e2e section 2" })
      ).toBeVisible();

      // L: long round title and a 300-character statement, both must wrap
      // rather than clip.
      const longTitleSuffix = "x".repeat(120);
      const longText = "Lorem ipsum dolor sit amet consectetur ".repeat(8).slice(0, 300);
      const L = await createTestRound({
        window: "draft",
        sections: [{ scaleKey: "agreement", statementCount: 1 }],
        titleSuffix: longTitleSuffix,
      });
      roundIds.push(L.roundId);

      const admin = adminClient();
      const { error: textError } = await admin
        .from("statements")
        .update({ text: longText })
        .eq("round_id", L.roundId)
        .eq("key", "e2e_s1_01");
      expect(textError).toBeNull();
      const pastWindow = pastWindowFor(L.roundNumber);
      const { error: windowError } = await admin
        .from("rounds")
        .update({ opens_at: pastWindow.opensAt, closes_at: pastWindow.closesAt })
        .eq("id", L.roundId);
      expect(windowError).toBeNull();

      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(`/admin/rounds/${L.roundId}/present`);
await page.waitForLoadState("networkidle");
      const titleHeading = page.getByRole("heading", { level: 1 });
      await expect(titleHeading).toBeVisible();
      const titleScroll = await titleHeading.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(titleScroll.scrollWidth).toBeLessThanOrEqual(titleScroll.clientWidth);

      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      const statementHeading = page.getByRole("heading", { level: 2 });
      await expect(statementHeading).toBeVisible();
      const statementScroll = await statementHeading.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(statementScroll.scrollWidth).toBeLessThanOrEqual(
        statementScroll.clientWidth
      );
      const docScroll = await page.evaluate(() => ({
        scrollHeight: document.scrollingElement!.scrollHeight,
        innerHeight: window.innerHeight,
      }));
      expect(docScroll.scrollHeight).toBeLessThanOrEqual(docScroll.innerHeight);
    } finally {
      for (const roundId of roundIds) {
        await deleteTestRound(roundId).catch(() => undefined);
      }
      for (const email of emails) {
        await deleteAuthUserByEmail(email);
        expect(await countAuthUsersByEmail(email)).toBe(0);
      }
    }
  });

  test("navigation guards: modifiers, key repeat, focused-button space, control clicks, Escape", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, adminEmail);
    await page.goto(`/admin/rounds/${R.roundId}/present`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("1 of 4")).toBeVisible();

    // Modifier-held arrow keys leave the counter unchanged.
    await page.keyboard.press("Control+ArrowRight");
    await page.keyboard.press("Meta+ArrowRight");
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.getByText("1 of 4")).toBeVisible();

    // An auto-repeat keydown (dispatched directly — Playwright's
    // keyboard.press cannot set `repeat`) leaves it unchanged.
    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          repeat: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    await expect(page.getByText("1 of 4")).toBeVisible();

    // Focusing "Next slide" and pressing Space advances exactly one slide
    // (the control's own click/activation never double-fires with the
    // deck's Space handler).
    await page.getByRole("button", { name: "Next slide" }).focus();
    await page.keyboard.press(" ");
    await expect(page.getByText("2 of 4")).toBeVisible();

    // Clicking "Previous slide" moves back exactly one.
    await page.getByRole("button", { name: "Previous slide" }).click();
    await expect(page.getByText("1 of 4")).toBeVisible();

    // Escape is never handled or prevented by the deck: dispatch it
    // directly and read defaultPrevented off the same event object after
    // dispatchEvent() returns (dispatch is synchronous, so every
    // listener — including the deck's document keydown handler — has
    // already run).
    const escapeDefaultPrevented = await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(escapeDefaultPrevented).toBe(false);
    await expect(page.getByText("1 of 4")).toBeVisible();

    // Clicking "Back to rounds" performs only its own navigation — it
    // never also triggers the slide area's click-to-advance.
    await page.getByRole("link", { name: "Back to rounds" }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("projector type and theme: forced-dark canvas, type scale, chart colours, progress bar, hit targets", async ({
    page,
    context,
  }) => {
    const famEmail = testEmail("participant", "ty");
    const Familiar = await createTestRound({
      window: "closed",
      sections: [{ scaleKey: "familiarity", statementCount: 1 }],
    });

    try {
      await seedRoundResponses(Familiar.roundId, [
        { email: famEmail, answers: { e2e_s1_01: 1 }, submit: true },
      ]);

      await signInViaCodePage(page, context, adminEmail);
      await page.emulateMedia({ colorScheme: "light" });

      await page.goto(`/admin/rounds/${R.roundId}/present`);
      await page.waitForLoadState("networkidle");

      // Forced-dark canvas: unaffected by the OS/browser colour scheme.
      const deckRoot = page.locator(".bg-pres-page").first();
      await expect(deckRoot).toHaveCSS("background-color", "rgb(13, 13, 13)");

      // Progress bar: 25 on slide 1 of 4, hit targets >= 44x44.
      const progressBar = page.getByRole("progressbar", {
        name: "Slide progress",
      });
      await expect(progressBar).toHaveAttribute("aria-valuenow", "25");

      const prevBox = await page
        .getByRole("button", { name: "Previous slide" })
        .boundingBox();
      const nextBox = await page
        .getByRole("button", { name: "Next slide" })
        .boundingBox();
      expect(prevBox!.width).toBeGreaterThanOrEqual(44);
      expect(prevBox!.height).toBeGreaterThanOrEqual(44);
      expect(nextBox!.width).toBeGreaterThanOrEqual(44);
      expect(nextBox!.height).toBeGreaterThanOrEqual(44);

      // Title 80px.
      await expect(page.getByRole("heading", { level: 1 })).toHaveCSS(
        "font-size",
        "80px"
      );

      await page.keyboard.press("ArrowRight");
      // Section-intro 48px.
      await expect(page.getByRole("heading", { level: 2 })).toHaveCSS(
        "font-size",
        "48px"
      );

      await page.keyboard.press(" ");
      // Statement 28px; breakdown labels and counter 20px; first
      // agreement swatch is --pres-agreement-1 (#e66767).
      await expect(page.getByRole("heading", { level: 2 })).toHaveCSS(
        "font-size",
        "28px"
      );
      await expect(page.getByText("3 of 4")).toHaveCSS("font-size", "20px");
      const breakdown = page.getByRole("list", { name: "Answer breakdown" });
      await expect(breakdown.locator("li").first()).toHaveCSS(
        "font-size",
        "20px"
      );
      const firstAgreementSwatch = breakdown
        .locator("li")
        .first()
        .locator("span")
        .first();
      await expect(firstAgreementSwatch).toHaveCSS(
        "background-color",
        "rgb(230, 103, 103)"
      );

      // 100 on the last slide.
      await page.keyboard.press("ArrowRight");
      await expect(page.getByText("4 of 4")).toBeVisible();
      await expect(progressBar).toHaveAttribute("aria-valuenow", "100");

      // First familiarity swatch is --pres-familiarity-1 (#9ec5f4).
      await page.goto(`/admin/rounds/${Familiar.roundId}/present`);
      await page.waitForLoadState("networkidle");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      const famBreakdown = page.getByRole("list", { name: "Answer breakdown" });
      const firstFamiliaritySwatch = famBreakdown
        .locator("li")
        .first()
        .locator("span")
        .first();
      await expect(firstFamiliaritySwatch).toHaveCSS(
        "background-color",
        "rgb(158, 197, 244)"
      );
    } finally {
      await deleteTestRound(Familiar.roundId).catch(() => undefined);
      await deleteAuthUserByEmail(famEmail);
      expect(await countAuthUsersByEmail(famEmail)).toBe(0);
    }
  });

  test("launch visibility: draft rounds have no Present results action; open and closed rounds do", async ({
    page,
    context,
  }) => {
    const D = await createTestRound({ window: "draft" });

    try {
      await signInViaCodePage(page, context, adminEmail);
      await page.goto("/admin");

      const draftRow = page.locator("tbody tr", {
        hasText: `Round ${D.roundNumber} ·`,
      });
      await draftRow.getByRole("button", { name: /Actions for/ }).click();
      await expect(
        page.getByRole("menuitem", { name: "Present results" })
      ).toHaveCount(0);
      await page.keyboard.press("Escape");

      const closedRow = page.locator("tbody tr", {
        hasText: `Round ${R.roundNumber} ·`,
      });
      await closedRow.getByRole("button", { name: /Actions for/ }).click();
      await expect(
        page.getByRole("menuitem", { name: "Present results" })
      ).toBeVisible();
      await page.keyboard.press("Escape");

      const round1Row = page.locator("tbody tr", { hasText: "Round 1 ·" });
      await round1Row.getByRole("button", { name: /Actions for/ }).click();
      await expect(
        page.getByRole("menuitem", { name: "Present results" })
      ).toBeVisible();
      await page.keyboard.press("Escape");
    } finally {
      await deleteTestRound(D.roundId).catch(() => undefined);
    }
  });

  test("Round 1 read-only: presents the real live round without any mutation", async ({
    page,
    context,
  }) => {
    const admin = adminClient();
    const { data: round1, error } = await admin
      .from("rounds")
      .select("id, title")
      .eq("round_number", 1)
      .single();
    expect(error).toBeNull();
    expect(round1).not.toBeNull();

    await signInViaCodePage(page, context, adminEmail);
    await page.goto(`/admin/rounds/${round1!.id}/present`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("1 of 94")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: round1!.title })
    ).toBeVisible();
    await expect(page.getByText(/^\d+ respondents?$/)).toBeVisible();

    // Nothing else about Round 1's real distributions is asserted —
    // snapshotRound1() in afterAll proves it is unchanged.
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "The language of design and change",
      })
    ).toBeVisible();
    await expect(page.getByText("16 statements", { exact: true })).toBeVisible();
  });
});
