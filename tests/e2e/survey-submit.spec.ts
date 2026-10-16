import { test, expect } from "@playwright/test";
import {
  testEmail,
  adminClient,
  signInAsTestUser,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
} from "../support/supabase-admin";
import { signInViaCodePage, seedOwnAnswers } from "../support/survey-fixtures";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

/**
 * SURV-06/07: submit is refused while incomplete (with the saved answers
 * left exactly as stored), accepted once every statement is answered, and
 * every later visit/login shows the thanks screen while the database
 * refuses any further change to the locked response.
 */
test.describe.serial("survey submit @survey-submit", () => {
  const participantEmail = testEmail("participant", "sub1");

  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test.afterAll(async () => {
    await deleteAuthUserByEmail(participantEmail);
    expect(await countAuthUsersByEmail(participantEmail)).toBe(0);
  });

  test("incomplete submit is rejected with a count and leaves answers unchanged; completing and submitting locks the response and shows thanks everywhere", async ({
    page,
    context,
    browser,
  }) => {
    await signInViaCodePage(page, context, participantEmail);

    // 1. Seed 84 of 85 answers under the participant's own RLS, leaving
    // s7_12 (the last statement) unanswered.
    const ownClient = await signInAsTestUser(participantEmail);
    await seedOwnAnswers(ownClient, { exceptKeys: ["s7_12"] });

    // 2. /survey/review shows 84 of 85, 1 left to go.
    await page.goto("/survey/review");
    await expect(
      page.getByText(SURVEY_MESSAGES.reviewAnswered(84, 85))
    ).toBeVisible();
    await expect(page.getByText(SURVEY_MESSAGES.reviewRemaining(1))).toBeVisible();

    // 3. Submitting an incomplete response is rejected; nothing changes.
    const submitButton = page.getByRole("button", {
      name: SURVEY_MESSAGES.submitCta,
    });
    await submitButton.click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toHaveText(SURVEY_MESSAGES.incompleteSubmit(1));
    await expect(page).toHaveURL(/\/survey\/review$/);
    await expect(submitButton).toBeEnabled();

    const { data: afterRejectResponse, error: afterRejectError } =
      await ownClient.from("responses").select("submitted_at").single();
    expect(afterRejectError).toBeNull();
    expect(afterRejectResponse!.submitted_at).toBeNull();

    const { data: afterRejectAnswers, error: afterRejectAnswersError } =
      await ownClient
        .from("answers")
        .select("value, statements(key)");
    expect(afterRejectAnswersError).toBeNull();
    expect(afterRejectAnswers).toHaveLength(84);
    expect(
      (afterRejectAnswers ?? []).every(
        (a) => (a.statements as unknown as { key: string }).key !== "s7_12"
      )
    ).toBe(true);
    const afterRejectValues = new Map(
      (afterRejectAnswers ?? []).map((a) => [
        (a.statements as unknown as { key: string }).key,
        a.value as number,
      ])
    );
    expect([...afterRejectValues.values()].every((v) => v === 1)).toBe(true);

    // 4. Answer the last statement (select, then Submit); the review page
    // now shows 85 of 85.
    await page.goto("/");
    await expect(page).toHaveURL(/\/survey\/s7_12$/);
    await page.getByRole("radio", { name: "Strongly agree" }).click();
    await expect(page).toHaveURL(/\/survey\/s7_12$/);
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page).toHaveURL(/\/survey\/review$/);
    await expect(
      page.getByText(SURVEY_MESSAGES.reviewAnswered(85, 85))
    ).toBeVisible();

    // 5. Submitting a complete response succeeds and shows thanks.
    await page
      .getByRole("button", { name: SURVEY_MESSAGES.submitCta })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: SURVEY_MESSAGES.thanksHeading })
    ).toBeVisible();
    await expect(page.getByText(SURVEY_MESSAGES.thanksBody)).toBeVisible();

    // 6. Thanks persists on reload and on every survey route.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: SURVEY_MESSAGES.thanksHeading })
    ).toBeVisible();

    await page.goto("/survey/s1_01");
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: SURVEY_MESSAGES.thanksHeading })
    ).toBeVisible();

    await page.goto("/survey/review");
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: SURVEY_MESSAGES.thanksHeading })
    ).toBeVisible();

    // 7. A brand-new browser context, signing in fresh, also sees thanks.
    const freshContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL as string,
    });
    const freshPage = await freshContext.newPage();
    await signInViaCodePage(freshPage, freshContext, participantEmail);
    await expect(freshPage).toHaveURL(/\/$/);
    await expect(
      freshPage.getByRole("heading", { name: SURVEY_MESSAGES.thanksHeading })
    ).toBeVisible();
    await freshContext.close();

    // 8. The database refuses every further change under the participant's
    // own RLS; stored values and submitted_at stay exactly as they were.
    const { data: lockedResponse } = await ownClient
      .from("responses")
      .select("id, submitted_at")
      .single();
    const lockedSubmittedAt = lockedResponse!.submitted_at as string;

    const { data: statementRow } = await adminClient()
      .from("statements")
      .select("id")
      .eq("key", "s1_01")
      .single();

    const { data: upsertData, error: upsertAfterSubmitError } = await ownClient
      .from("answers")
      .upsert(
        {
          response_id: lockedResponse!.id,
          round_id: (await ownClient.rpc("current_open_round_id")).data,
          statement_id: statementRow!.id,
          value: 1,
        },
        { onConflict: "response_id,statement_id" }
      )
      .select();
    expect(upsertAfterSubmitError !== null || (upsertData ?? []).length === 0).toBe(
      true
    );

    const { data: s712Row } = await adminClient()
      .from("statements")
      .select("id")
      .eq("key", "s7_12")
      .single();
    const { data: updateAnswerData, error: updateAnswerError } =
      await ownClient
        .from("answers")
        .update({ value: 5 })
        .eq("response_id", lockedResponse!.id)
        .eq("statement_id", s712Row!.id)
        .select();
    expect(
      updateAnswerError !== null || (updateAnswerData ?? []).length === 0
    ).toBe(true);

    const { data: unlockData, error: unlockError } = await ownClient
      .from("responses")
      .update({ submitted_at: null })
      .eq("id", lockedResponse!.id)
      .select();
    expect(unlockError !== null || (unlockData ?? []).length === 0).toBe(true);

    const { data: recheckedResponse } = await ownClient
      .from("responses")
      .select("submitted_at")
      .eq("id", lockedResponse!.id)
      .single();
    expect(recheckedResponse!.submitted_at).toBe(lockedSubmittedAt);

    const { data: recheckedAnswers } = await ownClient
      .from("answers")
      .select("value, statements(key)");
    expect(recheckedAnswers).toHaveLength(85);
    const recheckedMap = new Map(
      (recheckedAnswers ?? []).map((a) => [
        (a.statements as unknown as { key: string }).key,
        a.value as number,
      ])
    );
    expect(recheckedMap.get("s1_01")).toBe(1);
    expect(recheckedMap.get("s7_12")).toBe(5);
    for (const [key, value] of recheckedMap) {
      if (key !== "s1_01" && key !== "s7_12") {
        expect(value).toBe(1);
      }
    }
  });
});
