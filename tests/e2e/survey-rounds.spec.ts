import { test, expect } from "@playwright/test";
import {
  testEmail,
  adminClient,
  authUserIdByEmail,
  issueEmailOtp,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
} from "../support/supabase-admin";
import { createTestRound, deleteTestRound, signInViaCodePage } from "../support/survey-fixtures";

/**
 * SURV-08: a participant whose response in an earlier, closed round is
 * submitted still sees the open round's real start screen — never the
 * thanks screen, which is scoped to the currently open round only.
 */
test.describe.serial("survey rounds @survey-rounds", () => {
  const participantEmail = testEmail("participant", "rnd");
  let closedRoundId: string;

  test.beforeAll(async () => {
    await sweepStaleTestData();

    const closedRound = await createTestRound({ window: "closed" });
    closedRoundId = closedRound.roundId;

    // Ensure the auth user exists before the service-role fixture needs
    // its id — generateLink (behind issueEmailOtp) creates it if absent,
    // the same way signInAsTestUser does in every other spec.
    await issueEmailOtp(participantEmail);

    const service = adminClient();
    const userId = await authUserIdByEmail(participantEmail);
    await service
      .from("responses")
      .insert({ round_id: closedRoundId, user_id: userId });
    const { data: response } = await service
      .from("responses")
      .select("id")
      .eq("round_id", closedRoundId)
      .eq("user_id", userId)
      .single();
    await service.from("answers").insert(
      closedRound.statementIds.map((id, i) => ({
        response_id: response!.id,
        round_id: closedRoundId,
        statement_id: id,
        value: i + 1,
      }))
    );
    await service
      .from("responses")
      .update({ submitted_at: new Date().toISOString() })
      .eq("id", response!.id);
  });

  test.afterAll(async () => {
    await deleteTestRound(closedRoundId).catch(() => undefined);
    await deleteAuthUserByEmail(participantEmail);
    expect(await countAuthUsersByEmail(participantEmail)).toBe(0);
  });

  test("a submitted response in an earlier closed round does not block the open round's start screen", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, participantEmail);

    await expect(
      page.getByRole("heading", { level: 1, name: "Round 1" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Begin survey" })
    ).toBeVisible();
    await expect(page.getByText("Thanks — you're done")).toHaveCount(0);
  });
});
