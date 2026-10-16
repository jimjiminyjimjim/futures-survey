import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  testEmail,
  signInAsTestUser,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
} from "../support/supabase-admin";
import { signInViaCodePage, seedOwnAnswers } from "../support/survey-fixtures";
import {
  NoOpenRoundScreen,
  SurveyErrorScreen,
  ThanksScreen,
} from "@/components/survey/status-screens";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import {
  collectTextContrast,
  collectFocusRingContrast,
  collectRadioIndicatorContrast,
} from "../support/contrast";

/**
 * Automated WCAG AA contrast backstop for Phase 2's participant screens
 * (the human-verification item flagged in 02-VERIFICATION.md as "cheaply
 * automatable without a new dependency"). Colours are normalised to sRGB
 * via an in-page 1x1 canvas (tests/support/contrast.ts) — no new npm
 * dependency, works regardless of whether `getComputedStyle` resolves this
 * project's `oklch()` tokens to `rgb()` or leaves them as `oklch()`.
 *
 * Dark mode note: this app's `.dark` CSS class (see src/app/globals.css's
 * `@custom-variant dark (&:is(.dark *));`) is never toggled by any code in
 * this codebase — there is no ThemeProvider, no `prefers-color-scheme`
 * listener, nothing. The `dark:` Tailwind classes used throughout the
 * participant screens are therefore currently dead CSS in production; a
 * real browser's OS-level dark preference has no visible effect on this
 * app today. Adding a working theme toggle would be a new feature, out of
 * scope for this gap-closure pass. To still exercise the already-authored
 * dark oklch token set (exactly what 02-VERIFICATION.md's human-check
 * asked for), each test below manually adds/removes the `dark` class on
 * `<html>` after measuring the light-mode render, rather than relying on
 * Playwright's `colorScheme` context option (which only drives
 * `prefers-color-scheme` media queries — ineffective here since the
 * variant is class-based, not media-based).
 */

const NORMAL_TEXT_MIN = 4.5;
const LARGE_TEXT_MIN = 3;
const NON_TEXT_MIN = 3;

async function assertTextContrast(
  locator: Locator,
  label: string
): Promise<void> {
  await expect(locator).toBeVisible();
  const info = await locator.evaluate(collectTextContrast);
  const threshold = info.isLarge ? LARGE_TEXT_MIN : NORMAL_TEXT_MIN;
  expect(
    info.ratio,
    `${label}: ratio=${info.ratio.toFixed(2)} needs >= ${threshold} ` +
      `(fg=${info.fg} bg=${info.bg} text="${info.text}" ` +
      `fontSize=${info.fontSize}px weight=${info.fontWeight} large=${info.isLarge})`
  ).toBeGreaterThanOrEqual(threshold);
}

async function withBothSchemes(
  page: Page,
  run: (scheme: "light" | "dark") => Promise<void>
): Promise<void> {
  await run("light");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await run("dark");
  await page.evaluate(() =>
    document.documentElement.classList.remove("dark")
  );
}

/**
 * Injects a real server-rendered status screen (wrapped in the exact outer
 * classes page.tsx uses) as a brand-new document via `page.setContent()`,
 * carrying over every `<link rel="stylesheet">` and `<style>` tag the real
 * app's last-loaded route produced — so the markup renders with the real
 * production CSS, byte-for-byte. `setContent()` navigates away from the
 * live page entirely (CDP-level, not a DOM mutation), which matters here:
 * mutating `document.body.innerHTML` directly while Next.js's React tree
 * is still mounted triggers a hydration-mismatch recovery that wipes the
 * injected markup out from under the test before styles can be read.
 *
 * Needed because `/` can never actually resolve to "no-round" or "error"
 * live — Round 1 must stay open (PRIV-01) — so these two screens are
 * otherwise unreachable by real navigation. `ThanksScreen` is reachable
 * live (survey-submit.spec.ts proves it) but is included here too for a
 * cheap, consistent check that doesn't require a full 85-answer
 * submission against the shared DB.
 */
async function injectStatusScreen(
  page: Page,
  element: React.ReactElement
): Promise<void> {
  const inner = renderToStaticMarkup(element);
  const html = `<div class="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-4 py-12 dark:bg-black">${inner}</div>`;
  const headExtras = await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll('link[rel="stylesheet"]')
    ).map((l) => `<link rel="stylesheet" href="${(l as HTMLLinkElement).href}">`);
    const styles = Array.from(document.querySelectorAll("style")).map(
      (s) => `<style>${s.innerHTML}</style>`
    );
    return [...links, ...styles].join("\n");
  });
  await page.setContent(
    `<!doctype html><html><head>${headExtras}</head><body class="min-h-full flex flex-col">${html}</body></html>`
  );
}

test.describe.serial("survey contrast (WCAG AA) @survey-contrast", () => {
  const startEmail = testEmail("participant", "ctr1");
  const statementEmail = testEmail("participant", "ctr2");
  const reviewEmail = testEmail("participant", "ctr3");

  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test.afterAll(async () => {
    await deleteAuthUserByEmail(startEmail);
    await deleteAuthUserByEmail(statementEmail);
    await deleteAuthUserByEmail(reviewEmail);
    expect(await countAuthUsersByEmail(startEmail)).toBe(0);
    expect(await countAuthUsersByEmail(statementEmail)).toBe(0);
    expect(await countAuthUsersByEmail(reviewEmail)).toBe(0);
  });

  test("status screens (no-round / error / thanks) meet 4.5:1 heading+body contrast", async ({
    page,
  }) => {
    // /login is public (no auth) and loads the same compiled global
    // stylesheet every route shares, so the injected markup below renders
    // with the real production CSS.
    await page.goto("/login");

    for (const [name, element] of [
      ["NoOpenRoundScreen", createElement(NoOpenRoundScreen)],
      ["SurveyErrorScreen", createElement(SurveyErrorScreen)],
      ["ThanksScreen", createElement(ThanksScreen)],
    ] as const) {
      await injectStatusScreen(page, element);
      await withBothSchemes(page, async (scheme) => {
        await assertTextContrast(
          page.locator('[data-slot="empty-title"]'),
          `${name} heading (${scheme})`
        );
        await assertTextContrast(
          page.locator('[data-slot="empty-description"]'),
          `${name} body (${scheme})`
        );
      });
    }
  });

  test("start screen: round title, count/time copy, Begin button, footer copy", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, startEmail);
    await expect(page.getByRole("button", { name: "Begin survey" })).toBeVisible();

    await withBothSchemes(page, async (scheme) => {
      await assertTextContrast(
        // Scope to the visible heading: Next's instant-navigation cache
        // can keep /login or /login/code mounted-but-hidden, and both
        // have their own role="heading" level-1 element.
        page.getByRole("heading", { level: 1 }).filter({ visible: true }),
        `start round title (${scheme})`
      );
      await assertTextContrast(
        // Next's instant-navigation cache can keep the previous /login/code
        // page mounted-but-hidden (same note as
        // tests/e2e/survey-keyboard-a11y.spec.ts), which also has its own
        // `[data-slot="card-description"]" — scope to the visible one.
        page.locator('[data-slot="card-description"]').filter({ visible: true }),
        `start count/time copy (${scheme})`
      );
      await assertTextContrast(
        page.getByRole("button", { name: SURVEY_MESSAGES.beginCta }),
        `start "${SURVEY_MESSAGES.beginCta}" button label (${scheme})`
      );
      await assertTextContrast(
        page.getByText(/^Signed in as /),
        `start footer copy (${scheme})`
      );
    });
  });

  test("statement screen: statement text, option labels, progress, body copy, Back/Next, focus ring, checked indicator, save-error copy", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, statementEmail);
    await page.goto("/survey/s1_01");
    await page.waitForLoadState("networkidle");

    const statementText = page
      .locator('p[id^="statement-"]')
      .filter({ visible: true });
    const firstOptionLabelText = page
      .getByRole("radiogroup")
      .filter({ visible: true })
      .locator("label")
      .first()
      .locator("span")
      .first();
    const progressLabelEl = page
      .locator('[data-slot="progress-label"]')
      .filter({ visible: true });
    const sectionPrompt = page.locator("h1 + p").filter({ visible: true });
    const nextButton = page.getByRole("button", { name: "Next", exact: true });
    // "Back" is skipped here deliberately: s1_01 is the first statement, so
    // its Back button is `disabled` (no prevHref) and WCAG 1.4.3/1.4.11
    // explicitly exempt inactive ("disabled") UI components from contrast
    // requirements — checking it would also be measuring the wrong thing,
    // since Tailwind's `disabled:opacity-50` fades via the CSS `opacity`
    // property (a separate compositing step over whatever is BEHIND the
    // whole element), not via the `color`/`background-color` values this
    // test reads, so a disabled-element reading would be an overestimate
    // of the real rendered contrast. The enabled "Back" button (outline
    // variant) is covered below on s1_02 and on the review screen.

    await withBothSchemes(page, async (scheme) => {
      await assertTextContrast(statementText, `statement text (${scheme})`);
      await assertTextContrast(
        firstOptionLabelText,
        `first option label (${scheme})`
      );
      await assertTextContrast(progressLabelEl, `progress label (${scheme})`);
      await assertTextContrast(sectionPrompt, `section prompt body copy (${scheme})`);
      await assertTextContrast(nextButton, `"Next" button label (${scheme})`);
    });

    // Keyboard focus ring + checked-radio indicator (WCAG 1.4.11). Run as
    // an explicit light/dark pair with a fresh navigation between them
    // (rather than reusing withBothSchemes) so each scheme starts from a
    // clean, deterministic focus/selection state instead of compounding
    // the previous scheme's Tab/ArrowDown-driven DOM changes.
    async function measureFocusAndIndicator(scheme: "light" | "dark") {
      await page.goto("/survey/s1_01");
      await page.waitForLoadState("networkidle");
      if (scheme === "dark") {
        await page.evaluate(() =>
          document.documentElement.classList.add("dark")
        );
      }

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
      const focused = page.locator(":focus");
      const ringInfo = await focused.evaluate(collectFocusRingContrast);
      expect(
        ringInfo.ratio,
        `statement radio focus ring (${scheme}): ratio=${ringInfo.ratio.toFixed(2)} ` +
          `needs >= ${NON_TEXT_MIN} (bg=${ringInfo.bg} detail=${ringInfo.detail})`
      ).toBeGreaterThanOrEqual(NON_TEXT_MIN);

      // ArrowDown only selects — like every other selection path, it
      // never saves or navigates on its own (statement-form.tsx), so this
      // is a safe way to produce a checked radio without leaving the page
      // before the test can read styles.
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(750);
      const checkedRadio = page.getByRole("radio", { checked: true });
      await expect(checkedRadio).toHaveCount(1);
      const indicatorInfo = await checkedRadio.evaluate(
        collectRadioIndicatorContrast
      );
      expect(
        indicatorInfo.circleVsRow,
        `checked radio circle vs row background (${scheme}): ` +
          `ratio=${indicatorInfo.circleVsRow.toFixed(2)} needs >= ${NON_TEXT_MIN} ` +
          `(row=${indicatorInfo.rowBackdrop} circle=${indicatorInfo.circleEffective})`
      ).toBeGreaterThanOrEqual(NON_TEXT_MIN);
      expect(
        indicatorInfo.dotVsCircle,
        `checked radio dot vs circle background (${scheme}): dot not found or fully transparent`
      ).not.toBeNull();
      expect(
        indicatorInfo.dotVsCircle!,
        `checked radio dot vs circle background (${scheme}): ` +
          `ratio=${indicatorInfo.dotVsCircle!.toFixed(2)} needs >= ${NON_TEXT_MIN}`
      ).toBeGreaterThanOrEqual(NON_TEXT_MIN);

      if (scheme === "dark") {
        await page.evaluate(() =>
          document.documentElement.classList.remove("dark")
        );
      }
    }

    await measureFocusAndIndicator("light");
    await measureFocusAndIndicator("dark");

    // Save-error copy (role="alert", text-destructive): select an option,
    // abort the save POST, press Submit, same technique as
    // survey-keyboard-a11y.spec.ts, then measure the alert in both
    // schemes before unrouting.
    await page.goto("/survey/s1_02");
    await page.waitForLoadState("networkidle");
    await page.route("**/survey/**", (route) => {
      if (route.request().method() === "POST") {
        return route.abort("failed");
      }
      return route.continue();
    });
    const radios = page.getByRole("radiogroup").getByRole("radio");
    await radios.first().click();
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toHaveText(SURVEY_MESSAGES.saveFailed);
    // s1_02 has a prevHref (s1_01), so "Back" is enabled here — the right
    // place to check its label contrast (outline-variant button).
    const enabledBackButton = page.getByRole("button", {
      name: "Back",
      exact: true,
    });

    await withBothSchemes(page, async (scheme) => {
      await assertTextContrast(alert, `save-failure error copy (${scheme})`);
      await assertTextContrast(
        enabledBackButton,
        `"Back" button label, enabled (${scheme})`
      );
    });

    await page.unroute("**/survey/**");
  });

  test("review screen: heading, answered/remaining copy, buttons, incomplete-submit error copy", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, reviewEmail);
    const ownClient = await signInAsTestUser(reviewEmail);
    await seedOwnAnswers(ownClient, { exceptKeys: ["s7_12"] });

    await page.goto("/survey/review");
    await expect(
      page.getByText(SURVEY_MESSAGES.reviewAnswered(84, 85))
    ).toBeVisible();

    const heading = page.getByRole("heading", { level: 1 }).filter({ visible: true });
    const answeredCopy = page
      .locator('[data-slot="card-description"]')
      .filter({ visible: true });
    const remainingCopy = page.getByText(SURVEY_MESSAGES.reviewRemaining(1));
    const goToFirstUnanswered = page.getByRole("button", {
      name: SURVEY_MESSAGES.reviewFirstUnanswered,
    });
    const backButton = page.getByRole("button", {
      name: SURVEY_MESSAGES.back,
      exact: true,
    });
    const submitButton = page.getByRole("button", {
      name: SURVEY_MESSAGES.submitCta,
    });

    await withBothSchemes(page, async (scheme) => {
      await assertTextContrast(heading, `review heading (${scheme})`);
      await assertTextContrast(answeredCopy, `review "answered" copy (${scheme})`);
      await assertTextContrast(remainingCopy, `review "remaining" copy (${scheme})`);
      await assertTextContrast(
        goToFirstUnanswered,
        `review "first unanswered" button label (${scheme})`
      );
      await assertTextContrast(backButton, `review "Back" button label (${scheme})`);
      await assertTextContrast(
        submitButton,
        `review "${SURVEY_MESSAGES.submitCta}" button label (${scheme})`
      );
    });

    // Incomplete-submit rejection copy (role="alert", text-destructive).
    await submitButton.click();
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toHaveText(SURVEY_MESSAGES.incompleteSubmit(1));

    await withBothSchemes(page, async (scheme) => {
      await assertTextContrast(alert, `incomplete-submit error copy (${scheme})`);
    });
  });
});
