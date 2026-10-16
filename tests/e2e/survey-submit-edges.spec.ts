import { test, expect } from "@playwright/test";
import {
  testEmail,
  adminClient,
  authUserIdByEmail,
  signInAsTestUser,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
} from "../support/supabase-admin";
import { signInViaCodePage, seedOwnAnswers } from "../support/survey-fixtures";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

/**
 * Edge states around submit: zero answers, a network failure that must be
 * retryable, a stale tab touched after another tab submitted, and a second
 * tab attempting its own submit after the response is already locked.
 * None of these should ever surface a raw error or navigate to an error
 * page — only the documented copy.
 */
test.describe.serial("survey submit edges @survey-submit-edges", () => {
  const zeroAnswerEmail = testEmail("participant", "sub2");
  const midFlightEmail = testEmail("participant", "sub3");

  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test.afterAll(async () => {
    await deleteAuthUserByEmail(zeroAnswerEmail);
    await deleteAuthUserByEmail(midFlightEmail);
    expect(await countAuthUsersByEmail(zeroAnswerEmail)).toBe(0);
    expect(await countAuthUsersByEmail(midFlightEmail)).toBe(0);
  });

  test("a participant with zero answers sees the full remaining count and the submit attempt creates no responses row", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, zeroAnswerEmail);

    await page.goto("/survey/review");
    await expect(
      page.getByText(SURVEY_MESSAGES.reviewAnswered(0, 85))
    ).toBeVisible();

    await page
      .getByRole("button", { name: SURVEY_MESSAGES.submitCta })
      .click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toHaveText(SURVEY_MESSAGES.incompleteSubmit(85));
    await expect(page).toHaveURL(/\/survey\/review$/);

    const userId = await authUserIdByEmail(zeroAnswerEmail);
    const { data: responseRows, error } = await adminClient()
      .from("responses")
      .select("id")
      .eq("user_id", userId);
    expect(error).toBeNull();
    expect(responseRows ?? []).toHaveLength(0);
  });

  test("a network failure on submit shows the retryable alert and changes nothing; a stale tab touched after another tab submits sees alreadySubmitted; a second tab's own submit attempt also sees alreadySubmitted", async ({
    page,
    context,
  }) => {
    // Seed every statement (value 1) under the participant's own RLS
    // BEFORE opening any page, so all three tabs start from a complete,
    // unsubmitted response.
    const ownClient = await signInAsTestUser(midFlightEmail);
    await seedOwnAnswers(ownClient, { value: 1 });

    await signInViaCodePage(page, context, midFlightEmail);

    // Open A (a statement, prefilled) and C (review) before B does
    // anything, so all three reflect the pre-submit state.
    const pageA = await context.newPage();
    await pageA.goto("/survey/s1_01");
    // Familiarity scale: value 1 = "I've never heard of it" — the value
    // seedOwnAnswers stored for every statement, including s1_01.
    const originalOption = pageA.getByRole("radio", {
      name: "I've never heard of it",
    });
    await expect(originalOption).toBeChecked();

    const pageC = await context.newPage();
    await pageC.goto("/survey/review");
    await expect(
      pageC.getByText(SURVEY_MESSAGES.reviewAnswered(85, 85))
    ).toBeVisible();

    const pageB = await context.newPage();
    await pageB.goto("/survey/review");
    const submitButtonB = pageB.getByRole("button", {
      name: SURVEY_MESSAGES.submitCta,
    });

    // Network failure: abort the submit POST.
    await pageB.route("**/survey/**", (route) => {
      if (route.request().method() === "POST") {
        return route.abort("failed");
      }
      return route.continue();
    });
    await submitButtonB.click();
    await expect(pageB.locator('p[role="alert"]')).toHaveText(
      SURVEY_MESSAGES.submitFailed
    );
    await expect(submitButtonB).toBeEnabled();
    await expect(pageB).toHaveURL(/\/survey\/review$/);

    const { data: stillUnsubmitted, error: stillUnsubmittedError } =
      await ownClient.from("responses").select("submitted_at").single();
    expect(stillUnsubmittedError).toBeNull();
    expect(stillUnsubmitted!.submitted_at).toBeNull();

    // After unroute, the same button succeeds and locks the response.
    await pageB.unroute("**/survey/**");
    await submitButtonB.click();
    await expect(pageB).toHaveURL(/\/$/);
    await expect(
      pageB.getByRole("heading", { name: SURVEY_MESSAGES.thanksHeading })
    ).toBeVisible();

    // Stale tab A: choosing a different option alone does not save —
    // only pressing Submit attempts it, which shows the already-submitted
    // copy, stays put, and reverts the visible selection back to the
    // originally saved value for s1_01 (a selection that can never be
    // saved, unlike a retryable network failure).
    const newOption = pageA.getByRole("radio", {
      name: "I understand it well and could use it in my work",
    });
    await newOption.click();
    await expect(newOption).toBeChecked();
    await pageA.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(pageA.locator('p[role="alert"]')).toHaveText(
      SURVEY_MESSAGES.alreadySubmitted
    );
    await expect(pageA).toHaveURL(/\/survey\/s1_01$/);
    await expect(originalOption).toBeChecked();

    const { data: s101 } = await adminClient()
      .from("statements")
      .select("id")
      .eq("key", "s1_01")
      .single();
    const { data: s101Answer, error: s101AnswerError } = await ownClient
      .from("answers")
      .select("value")
      .eq("statement_id", s101!.id)
      .single();
    expect(s101AnswerError).toBeNull();
    expect(s101Answer!.value).toBe(1);

    // Second-tab submit C: its own submit attempt also sees
    // already-submitted, not a raw error or a navigation to an error page.
    const submitButtonC = pageC.getByRole("button", {
      name: SURVEY_MESSAGES.submitCta,
    });
    await submitButtonC.click();
    await expect(pageC.locator('p[role="alert"]')).toHaveText(
      SURVEY_MESSAGES.alreadySubmitted
    );
    await expect(pageC).toHaveURL(/\/survey\/review$/);
  });
});
