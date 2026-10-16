import { test, expect } from "@playwright/test";
import {
  testEmail,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
  signInAsTestUser,
} from "../support/supabase-admin";
import { signInViaCodePage, seedOwnAnswers } from "../support/survey-fixtures";

test.describe.serial("survey navigation @survey-navigation", () => {
  const participantEmail = testEmail("participant", "nav");

  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test.afterAll(async () => {
    await deleteAuthUserByEmail(participantEmail);
    expect(await countAuthUsersByEmail(participantEmail)).toBe(0);
  });

  test("progress, back/next across sections, skip, and the review summary", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, participantEmail);

    // 1. s1_01: '1 of 85', progressbar attrs, disabled Back.
    await page.goto("/survey/s1_01");
    await expect(page.getByText("1 of 85")).toBeVisible();
    const progressbar = page.getByRole("progressbar");
    await expect(progressbar).toHaveAttribute("aria-valuenow", "1");
    await expect(progressbar).toHaveAttribute("aria-valuemax", "85");
    await expect(page.getByRole("button", { name: "Back", exact: true })).toBeDisabled();

    // 2. Selecting an option alone does not advance; the primary button
    // flips to "Submit", which saves and advances to s1_02 ('2 of 85').
    // Back -> s1_01 with the saved option checked; Next -> s1_02 unchanged.
    await page
      .getByRole("radio", { name: "I could explain it simply" })
      .click();
    await expect(page).toHaveURL(/\/survey\/s1_01$/);
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page).toHaveURL(/\/survey\/s1_02$/);
    await expect(page.getByText("2 of 85")).toBeVisible();

    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).toHaveURL(/\/survey\/s1_01$/);
    await expect(
      page.getByRole("radio", { name: "I could explain it simply" })
    ).toBeChecked();

    // Revisiting an answered statement pre-selects it, so the primary
    // button reads "Submit" (re-saving the same value is allowed) rather
    // than "Next".
    await expect(
      page.getByRole("button", { name: "Submit", exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page).toHaveURL(/\/survey\/s1_02$/);

    // 3. Next on unanswered s1_02 skips to s1_03 without saving/selecting
    // anything; / then resumes at s1_02 (the first unanswered), not s1_03
    // (the last visited).
    await expect(
      page.getByRole("button", { name: "Next", exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/\/survey\/s1_03$/);

    await page.goto("/");
    await expect(page).toHaveURL(/\/survey\/s1_02$/);

    // 4. Section change: s1_16 -> Next -> s2_01.
    await page.goto("/survey/s1_16");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/\/survey\/s2_01$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Sustainability, scepticism and possibility",
      })
    ).toBeVisible();
    await expect(
      page.getByText(
        "Thinking about sustainability in products and design, how much do you agree with the following?"
      )
    ).toBeVisible();
    const agreementRadios = page.getByRole("radiogroup").getByRole("radio");
    await expect(agreementRadios).toHaveCount(5);
    const agreementLabels = [
      "Strongly disagree",
      "Disagree",
      "Neither",
      "Agree",
      "Strongly agree",
    ];
    for (let i = 0; i < agreementLabels.length; i += 1) {
      await expect(agreementRadios.nth(i)).toHaveAccessibleName(
        agreementLabels[i]
      );
    }

    // 5. Last statement: s7_12 shows '85 of 85'; Next -> /survey/review.
    await page.goto("/survey/s7_12");
    await expect(page.getByText("85 of 85")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/\/survey\/review$/);

    // 6. Review with only s1_01 answered.
    await expect(
      page.getByText("You've answered 1 of 85 statements.")
    ).toBeVisible();
    await expect(page.getByText("84 left to go")).toBeVisible();
    await page
      .getByRole("button", { name: "Go to the first unanswered statement" })
      .click();
    await expect(page).toHaveURL(/\/survey\/s1_02$/);

    // 7. Seed every remaining statement under the participant's own RLS,
    // then confirm / redirects to the complete review screen.
    const participant = await signInAsTestUser(participantEmail);
    await seedOwnAnswers(participant);

    await page.goto("/");
    await expect(page).toHaveURL(/\/survey\/review$/);
    await expect(
      page.getByText("You've answered 85 of 85 statements.")
    ).toBeVisible();
    await expect(page.getByText(/left to go/)).toHaveCount(0);
  });
});
