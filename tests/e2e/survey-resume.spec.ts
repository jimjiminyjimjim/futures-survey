import { test, expect } from "@playwright/test";
import {
  testEmail,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
} from "../support/supabase-admin";
import { signInViaCodePage } from "../support/survey-fixtures";

test.describe.serial("survey resume @survey-resume", () => {
  const participantEmail = testEmail("participant", "res");

  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test.afterAll(async () => {
    await deleteAuthUserByEmail(participantEmail);
    expect(await countAuthUsersByEmail(participantEmail)).toBe(0);
  });

  test("start screen, begin, leave and return, resume after a fresh sign-in", async ({
    page,
    context,
    browser,
  }) => {
    // 1. Sign in; see the start screen.
    await signInViaCodePage(page, context, participantEmail);
    await expect(page).toHaveURL(/\/$/);

    await expect(
      page.getByRole("heading", { level: 1, name: "Round 1" })
    ).toBeVisible();
    await expect(page.getByText("85 questions · about 14 minutes")).toBeVisible();
    await expect(page.getByText("Signed in as")).toContainText(
      participantEmail
    );
    await expect(page.getByRole("link", { name: "Open admin" })).toHaveCount(
      0
    );
    const beginButton = page.getByRole("button", { name: "Begin survey" });
    await expect(beginButton).toBeVisible();

    // 2. Begin -> s1_01; selecting alone does not advance; Submit saves
    // and advances to s1_02.
    await beginButton.click();
    await expect(page).toHaveURL(/\/survey\/s1_01$/);
    await page
      .getByRole("radio", {
        name: "I've heard of it but couldn't explain it",
      })
      .click();
    await expect(page).toHaveURL(/\/survey\/s1_01$/);
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page).toHaveURL(/\/survey\/s1_02$/);

    // 3. Leaving and returning to / resumes at the last unanswered
    // statement (s1_02 — not yet answered).
    await page.goto("/");
    await expect(page).toHaveURL(/\/survey\/s1_02$/);

    // 4. Answer s1_02 -> s1_03 (select, then Submit).
    const radiogroup102 = page.getByRole("radiogroup");
    await radiogroup102.getByRole("radio").first().click();
    await expect(page).toHaveURL(/\/survey\/s1_02$/);
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page).toHaveURL(/\/survey\/s1_03$/);

    // 5. A fresh browser context + a brand-new sign-in for the same
    // participant also resumes at the first unanswered statement (s1_03),
    // not whatever was last visited in the first context.
    const freshContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    const freshPage = await freshContext.newPage();
    await signInViaCodePage(freshPage, freshContext, participantEmail);
    await freshPage.goto("/");
    await expect(freshPage).toHaveURL(/\/survey\/s1_03$/);
    await freshContext.close();
  });
});
