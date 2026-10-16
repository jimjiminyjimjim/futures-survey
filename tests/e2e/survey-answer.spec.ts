import { test, expect } from "@playwright/test";
import {
  testEmail,
  issueEmailOtp,
  adminClient,
  signInAsTestUser,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
} from "../support/supabase-admin";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

const PENDING_EMAIL_COOKIE = "dfs_pending_email";

test.describe.serial("survey answer @survey-answer", () => {
  const participantEmail = testEmail("participant");

  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test.afterAll(async () => {
    await deleteAuthUserByEmail(participantEmail);
    expect(await countAuthUsersByEmail(participantEmail)).toBe(0);
  });

  test("participant answers s1_01, autosaves, advances, resumes, sees save failure, and gets 404s for bad keys", async ({
    page,
    context,
  }) => {
    // 1. Sign in via the Phase 1 cookie + /login/code pattern.
    const code = await issueEmailOtp(participantEmail);
    await context.addCookies([
      {
        name: PENDING_EMAIL_COOKIE,
        value: encodeURIComponent(participantEmail),
        domain: "localhost",
        path: "/login",
      },
    ]);
    await page.goto("/login/code");
    await page.getByLabel("6-digit code").fill(code);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);

    // 2. Empty state on s1_01.
    await page.goto("/survey/s1_01");
    await expect(
      page.getByRole("heading", {
        name: "The language of design and change",
        level: 1,
      })
    ).toBeVisible();
    await expect(
      page.getByText("How familiar are you with the following ideas?")
    ).toBeVisible();

    const radioGroup = page.getByRole("radiogroup", {
      name: "Sustainability",
    });
    await expect(radioGroup).toBeVisible();

    const optionLabels = [
      "I've never heard of it",
      "I've heard of it but couldn't explain it",
      "I could explain it simply",
      "I understand it well and could use it in my work",
    ];
    const radios = radioGroup.getByRole("radio");
    await expect(radios).toHaveCount(4);
    for (let i = 0; i < optionLabels.length; i += 1) {
      await expect(radios.nth(i)).toHaveAccessibleName(optionLabels[i]);
      await expect(radios.nth(i)).not.toBeChecked();
    }
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);

    const lastLabel = page.getByText(optionLabels[3], { exact: true });
    const fitsWithoutOverflow = await lastLabel.evaluate(
      (el) => el.scrollWidth <= el.clientWidth + 1
    );
    expect(fitsWithoutOverflow).toBe(true);

    // 3. Choosing an option only selects it — no save, no navigation —
    // and flips the primary button's label from "Next" to "Submit".
    const primaryButton = page.getByRole("button", {
      name: /^(Next|Submit)$/,
    });
    await expect(primaryButton).toHaveText("Next");
    await radioGroup
      .getByRole("radio", { name: "I could explain it simply" })
      .click();
    await expect(
      radioGroup.getByRole("radio", { name: "I could explain it simply" })
    ).toBeChecked();
    await expect(page).toHaveURL(/\/survey\/s1_01$/);
    await expect(primaryButton).toHaveText("Submit");

    // Submit saves the selection and advances.
    await primaryButton.click();
    await expect(page).toHaveURL(/\/survey\/s1_02$/);
    await expect(page.getByText("Greenwashing")).toBeVisible();

    // 4. Verify the saved row directly, under the participant's own RLS.
    const admin = adminClient();
    const { data: round1, error: round1Error } = await admin
      .from("rounds")
      .select("id")
      .eq("round_number", 1)
      .single();
    expect(round1Error).toBeNull();
    const round1Id = round1!.id as string;

    const participant = await signInAsTestUser(participantEmail);
    const { data: openRoundId, error: openRoundError } =
      await participant.rpc("current_open_round_id");
    expect(openRoundError).toBeNull();
    expect(openRoundId).toBe(round1Id);

    const { data: responses, error: responsesError } = await participant
      .from("responses")
      .select("id, round_id, submitted_at");
    expect(responsesError).toBeNull();
    expect(responses).toHaveLength(1);
    expect(responses![0].round_id).toBe(round1Id);
    expect(responses![0].submitted_at).toBeNull();

    async function ownAnswers() {
      const { data, error } = await participant
        .from("answers")
        .select("value, statements(key)");
      expect(error).toBeNull();
      return (data ?? []).map((a) => ({
        key: (a.statements as unknown as { key: string }).key,
        value: a.value as number,
      }));
    }

    expect(await ownAnswers()).toEqual([{ key: "s1_01", value: 3 }]);

    // 5. Revisiting shows the saved selection pre-checked with the primary
    // button already reading "Submit"; changing the selection and
    // pressing Submit updates the same row (PRIV-01 idempotency edge)
    // rather than adding a second one.
    await page.goto("/survey/s1_01");
    await expect(
      radioGroup.getByRole("radio", { name: "I could explain it simply" })
    ).toBeChecked();
    await expect(primaryButton).toHaveText("Submit");

    await radioGroup
      .getByRole("radio", {
        name: "I understand it well and could use it in my work",
      })
      .click();
    // Selecting alone does not save or navigate.
    await expect(page).toHaveURL(/\/survey\/s1_01$/);
    expect(await ownAnswers()).toEqual([{ key: "s1_01", value: 3 }]);

    await primaryButton.click();
    await expect(page).toHaveURL(/\/survey\/s1_02$/);

    expect(await ownAnswers()).toEqual([{ key: "s1_01", value: 4 }]);

    // 6. Save failure: select an option, then abort the Submit network
    // call and expect a friendly alert, no navigation, and the selection
    // kept on screen (not reverted) so Submit can simply be pressed again.
    await page.goto("/survey/s1_03");
    const radiosOnS103 = page.getByRole("radiogroup").getByRole("radio");
    await radiosOnS103.first().click();
    await expect(radiosOnS103.first()).toBeChecked();

    await page.route("**/survey/**", (route) => {
      if (route.request().method() === "POST") {
        return route.abort("failed");
      }
      return route.continue();
    });

    const primaryButtonS103 = page.getByRole("button", {
      name: /^(Next|Submit)$/,
    });
    await expect(primaryButtonS103).toHaveText("Submit");
    await primaryButtonS103.click();

    const alert = page.locator('p[role="alert"]');
    await expect(alert).toHaveText(SURVEY_MESSAGES.saveFailed);
    await expect(page).toHaveURL(/\/survey\/s1_03$/);
    await expect(radiosOnS103.first()).toBeChecked();

    await page.unroute("**/survey/**");

    // 7. Unknown / differently-cased keys 404.
    const zz99Response = await page.goto("/survey/zz_99");
    expect(zz99Response?.status()).toBe(404);
    const upperResponse = await page.goto("/survey/S1_01");
    expect(upperResponse?.status()).toBe(404);
  });
});
