import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  testEmail,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
  signInAsTestUser,
} from "../support/supabase-admin";
import { signInViaCodePage } from "../support/survey-fixtures";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

async function answerValue(
  client: SupabaseClient,
  key: string
): Promise<number | undefined> {
  const { data, error } = await client
    .from("answers")
    .select("value, statements(key)");
  if (error) {
    throw error;
  }
  const row = (data ?? []).find(
    (a) => (a.statements as unknown as { key: string }).key === key
  );
  return row?.value as number | undefined;
}

test.describe.serial("survey keyboard + a11y @survey-keyboard-a11y", () => {
  const kbdEmail = testEmail("participant", "kbd");
  const kbd2Email = testEmail("participant", "kbd2");

  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test.afterAll(async () => {
    await deleteAuthUserByEmail(kbdEmail);
    await deleteAuthUserByEmail(kbd2Email);
    expect(await countAuthUsersByEmail(kbdEmail)).toBe(0);
    expect(await countAuthUsersByEmail(kbd2Email)).toBe(0);
  });

  test("digit and arrow shortcuts drive save-and-advance without fighting the radio group", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, kbdEmail);
    const kbdClient = await signInAsTestUser(kbdEmail);

    // 1. Digit '3' on s1_03 (focus on the page body) only selects — no
    // save, no navigation. Enter then activates the primary button
    // (now "Submit"), which saves and advances. networkidle guards
    // against sending a keyboard shortcut before this client component
    // has hydrated (the dev server also lazily compiles each route's
    // client bundle on first visit) — a real document keydown listener,
    // unlike a click target, gives Playwright's own actionability checks
    // nothing to wait on.
    await page.goto("/survey/s1_03");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("3");
    await expect(page).toHaveURL(/\/survey\/s1_03$/);
    expect(await answerValue(kbdClient, "s1_03")).toBeUndefined();
    await expect(
      page.getByRole("radio", { name: "I could explain it simply" })
    ).toBeChecked();
    await expect(
      page.getByRole("button", { name: "Submit", exact: true })
    ).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/survey\/s1_04$/);
    expect(await answerValue(kbdClient, "s1_03")).toBe(3);

    // 2. Out-of-range digits and modifier chords on s1_04 (familiarity, 4
    // options) do nothing; '4' only selects (no save, no navigation);
    // Enter saves and advances.
    await page.keyboard.press("0");
    await page.waitForTimeout(750);
    await expect(page).toHaveURL(/\/survey\/s1_04$/);
    expect(await answerValue(kbdClient, "s1_04")).toBeUndefined();

    await page.keyboard.press("5");
    await page.waitForTimeout(750);
    await expect(page).toHaveURL(/\/survey\/s1_04$/);
    expect(await answerValue(kbdClient, "s1_04")).toBeUndefined();

    await page.keyboard.press("Control+2");
    await page.waitForTimeout(750);
    await expect(page).toHaveURL(/\/survey\/s1_04$/);
    expect(await answerValue(kbdClient, "s1_04")).toBeUndefined();

    await page.keyboard.press("4");
    await page.waitForTimeout(750);
    await expect(page).toHaveURL(/\/survey\/s1_04$/);
    expect(await answerValue(kbdClient, "s1_04")).toBeUndefined();
    await expect(
      page.getByRole("radio", {
        name: "I understand it well and could use it in my work",
      })
    ).toBeChecked();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/survey\/s1_05$/);
    expect(await answerValue(kbdClient, "s1_04")).toBe(4);

    // 3. ArrowLeft/ArrowRight (focus outside the radio group) page-navigate;
    // the saved option on s1_04 shows checked on the way back. ArrowRight
    // never saves, even with an unsaved selection present (not exercised
    // here since nothing is selected on s1_05 yet).
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(/\/survey\/s1_04$/);
    await expect(
      page.getByRole("radio", {
        name: "I understand it well and could use it in my work",
      })
    ).toBeChecked();

    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/\/survey\/s1_05$/);

    // 4. Tab into the radio group, then ArrowDown — native in-group
    // navigation only, selects without saving, never a page change.
    await page.keyboard.press("Tab");
    while (
      !(await page.evaluate(
        () => document.activeElement?.getAttribute("role") === "radio"
      ))
    ) {
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(750);
    await expect(page).toHaveURL(/\/survey\/s1_05$/);
    expect(await answerValue(kbdClient, "s1_05")).toBeUndefined();

    // 5. Hint text matches the current scale's option count. Scoped to
    // the visible element: Next's instant-navigation cache keeps the
    // previous same-pattern statement page mounted-but-hidden (excluded
    // from the accessibility tree, confirmed via getByRole elsewhere in
    // this file) for fast back-navigation, and a plain text match (unlike
    // a role query) does not filter by visibility on its own.
    await expect(
      page
        .getByText(SURVEY_MESSAGES.keyboardHint(4), { exact: true })
        .filter({ visible: true })
    ).toBeVisible();

    // 6. On s2_01 (agreement, 5 options): '6' is out of range, '5' only
    // selects (no save, no navigation); Enter saves and advances.
    await page.goto("/survey/s2_01");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("6");
    await page.waitForTimeout(750);
    await expect(page).toHaveURL(/\/survey\/s2_01$/);
    expect(await answerValue(kbdClient, "s2_01")).toBeUndefined();

    await page.keyboard.press("5");
    await page.waitForTimeout(750);
    await expect(page).toHaveURL(/\/survey\/s2_01$/);
    expect(await answerValue(kbdClient, "s2_01")).toBeUndefined();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/survey\/s2_02$/);
    expect(await answerValue(kbdClient, "s2_01")).toBe(5);

    await expect(
      page
        .getByText(SURVEY_MESSAGES.keyboardHint(5), { exact: true })
        .filter({ visible: true })
    ).toBeVisible();
  });

  test("phone viewport, keyboard focus ring, and a graceful autosave failure", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, kbd2Email);
    await page.setViewportSize({ width: 360, height: 740 });

    async function assertNoHorizontalScroll() {
      const overflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(overflowing).toBe(false);
    }

    async function assertMinHeight(locator: ReturnType<typeof page.locator>) {
      const count = await locator.count();
      for (let i = 0; i < count; i += 1) {
        const box = await locator.nth(i).boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }

    // 1. / (start screen).
    await expect(page).toHaveURL(/\/$/);
    await assertNoHorizontalScroll();
    await assertMinHeight(page.getByRole("button", { name: "Begin survey" }));

    // 2. /survey/s1_16 — option rows, Back/Next, long label wrap.
    await page.goto("/survey/s1_16");
    await assertNoHorizontalScroll();
    await assertMinHeight(page.getByRole("radiogroup").locator("label"));
    await assertMinHeight(
      page.getByRole("button", { name: "Back", exact: true })
    );
    await assertMinHeight(
      page.getByRole("button", { name: "Next", exact: true })
    );
    const longLabel = page.getByText(
      "I understand it well and could use it in my work",
      { exact: true }
    );
    const longLabelFits = await longLabel.evaluate(
      (el) => el.scrollWidth <= el.clientWidth + 1
    );
    expect(longLabelFits).toBe(true);

    // 3. /survey/s2_07 — labelled radiogroup by the exact statement text.
    await page.goto("/survey/s2_07");
    await assertNoHorizontalScroll();
    await assertMinHeight(page.getByRole("radiogroup").locator("label"));
    await expect(
      page.getByRole("radiogroup", {
        name: "Making individual products more sustainable can feel inadequate when the wider systems that produce them remain unchanged.",
      })
    ).toBeVisible();

    // 4. /survey/review. Scoped to the Card's own buttons — an unscoped
    // page.getByRole("button") also catches Next.js's dev-mode devtools
    // overlay (e.g. "Open Next.js Dev Tools", 32px), which isn't part of
    // this app's UI.
    await page.goto("/survey/review");
    await assertNoHorizontalScroll();
    await assertMinHeight(
      page.locator('[data-slot="card"]').getByRole("button")
    );

    // 5. Keyboard focus ring on a statement page.
    await page.goto("/survey/s1_01");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Tab");
    let tabs = 0;
    while (
      !(await page.evaluate(
        () => document.activeElement?.getAttribute("role") === "radio"
      ))
    ) {
      await page.keyboard.press("Tab");
      tabs += 1;
      if (tabs > 20) {
        throw new Error("Could not Tab to a radio within 20 presses");
      }
    }
    const focusVisible = await page.evaluate(() =>
      document.activeElement instanceof Element
        ? document.activeElement.matches(":focus-visible")
        : false
    );
    expect(focusVisible).toBe(true);
    const ringVisible = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = window.getComputedStyle(el);
      return style.boxShadow !== "none" || style.outlineStyle !== "none";
    });
    expect(ringVisible).toBe(true);

    // 6. Autosave failure on the still-unanswered s1_01: selecting an
    // option alone saves nothing. Pressing Submit while the save POST is
    // aborted shows a friendly alert, URL unchanged, selection kept on
    // screen (not reverted) and radios re-enabled so Submit can simply be
    // pressed again; unroute recovers.
    await page.route("**/survey/**", (route) => {
      if (route.request().method() === "POST") {
        return route.abort("failed");
      }
      return route.continue();
    });

    const radios = page.getByRole("radiogroup").getByRole("radio");
    await radios.first().click();
    await expect(radios.first()).toBeChecked();

    const submitButton = page.getByRole("button", {
      name: "Submit",
      exact: true,
    });
    await submitButton.click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toHaveText(SURVEY_MESSAGES.saveFailed);
    await expect(page).toHaveURL(/\/survey\/s1_01$/);
    await expect(radios.first()).toBeChecked();
    const radioCount = await radios.count();
    for (let i = 0; i < radioCount; i += 1) {
      await expect(radios.nth(i)).toBeEnabled();
    }

    await page.unroute("**/survey/**");
    await submitButton.click();
    await expect(page).toHaveURL(/\/survey\/s1_02$/);
  });
});
