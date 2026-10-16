import { test, expect } from "@playwright/test";
import {
  testEmail,
  adminClient,
  grantTestAdmin,
  revokeTestAdmin,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
  RUN_ID,
} from "../support/supabase-admin";
import {
  createTestRound,
  deleteTestRound,
  signInViaCodePage,
  snapshotRound1,
  assertTestRound,
  type TestRound,
} from "../support/survey-fixtures";
import { toAdminDateTimeInputValue } from "../../src/lib/admin/datetime";
import { ADMIN_MESSAGES } from "../../src/lib/admin/messages";

/**
 * RND-02/RND-05/RND-06's UI half: an admin edits a draft round's title and
 * UK-time open/close dates (every refusal shown with its exact copy, the
 * draft's dates left unchanged), and Round 1's Opens field is read-only
 * and never submitted. Task 3 extends this file with Open now / Close
 * early. Round 1 is snapshotted before/after to prove it is never touched.
 */
test.describe.serial("admin round lifecycle @admin-round-lifecycle", () => {
  const adminEmail = testEmail("admin", "life");

  let round1SnapshotBefore: string;
  let draft: TestRound;
  let closedFixture: TestRound;

  test.beforeAll(async () => {
    await sweepStaleTestData();
    round1SnapshotBefore = await snapshotRound1();
    await grantTestAdmin(adminEmail);

    draft = await createTestRound({ window: "draft" });
    await assertTestRound(draft.roundId);
    closedFixture = await createTestRound({ window: "closed" });
    await assertTestRound(closedFixture.roundId);
  });

  test.afterAll(async () => {
    await deleteTestRound(draft.roundId).catch(() => undefined);
    await deleteTestRound(closedFixture.roundId).catch(() => undefined);
    await revokeTestAdmin(adminEmail);
    await deleteAuthUserByEmail(adminEmail);
    expect(await countAuthUsersByEmail(adminEmail)).toBe(0);

    const round1SnapshotAfter = await snapshotRound1();
    expect(round1SnapshotAfter).toBe(round1SnapshotBefore);
  });

  test("schedule form: empty draft, rename, every date refusal leaves the DB unchanged, and Round 1's Opens is read-only", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, adminEmail);
    await page.goto(`/admin/rounds/${draft.roundId}`);

    const admin = adminClient();
    const scheduleForm = page.locator('[data-slot="schedule-form"]');

    const titleInput = scheduleForm.getByLabel("Round title");
    const opensInput = scheduleForm.getByLabel("Opens (UK time)");
    const closesInput = scheduleForm.getByLabel("Closes (UK time)");
    const saveButton = scheduleForm.getByRole("button", { name: "Save" });

    // UI empty: a fresh draft shows both date inputs empty and badge "Draft".
    await expect(opensInput).toHaveValue("");
    await expect(closesInput).toHaveValue("");
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();

    // Rename: Save shows "Saved.", and the new title survives a reload.
    const newTitle = `e2e-${RUN_ID}-renamed`;
    await titleInput.fill(newTitle);
    await saveButton.click();
    await expect(scheduleForm.getByText("Saved.", { exact: true })).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: newTitle })
    ).toBeVisible();
    const { data: afterRename } = await admin
      .from("rounds")
      .select("title")
      .eq("id", draft.roundId)
      .single();
    expect(afterRename!.title).toBe(newTitle);

    async function expectRefusal(options: {
      opens: string;
      closes: string;
      title?: string;
      message: string;
    }) {
      const freshForm = page.locator('[data-slot="schedule-form"]');
      const freshTitleInput = freshForm.getByLabel("Round title");
      const freshOpensInput = freshForm.getByLabel("Opens (UK time)");
      const freshClosesInput = freshForm.getByLabel("Closes (UK time)");
      const freshSaveButton = freshForm.getByRole("button", { name: "Save" });

      if (options.title !== undefined) {
        await freshTitleInput.fill(options.title);
      }
      await freshOpensInput.fill(options.opens);
      await freshClosesInput.fill(options.closes);
      await freshSaveButton.click();
      await expect(freshForm.getByRole("alert")).toHaveText(options.message);

      const { data } = await admin
        .from("rounds")
        .select("opens_at, closes_at")
        .eq("id", draft.roundId)
        .single();
      expect(data!.opens_at).toBeNull();
      expect(data!.closes_at).toBeNull();
    }

    // Opens far in the future, Closes empty: Round 1 is open-ended, so any
    // dated window after it overlaps.
    await expectRefusal({
      opens: "2099-01-01T09:00",
      closes: "",
      message:
        "These dates overlap another round's — only one round can be open at a time.",
    });

    // Closes before opens, same attempt: dates_order wins before the
    // overlap trigger ever runs.
    await expectRefusal({
      opens: "2099-01-01T09:00",
      closes: "2099-01-01T08:00",
      message: "The close date must be after the open date.",
    });

    // Opens in the past.
    await expectRefusal({
      opens: "2020-01-01T09:00",
      closes: "",
      message:
        "Choose an open date and time in the future, or use Open now.",
    });

    // Closes in the past, opens left empty.
    await expectRefusal({
      opens: "",
      closes: "2020-01-01T09:00",
      message: "Choose a close date and time in the future.",
    });

    // Blank title (zod, short-circuits before any date is ever parsed).
    await expectRefusal({
      opens: "",
      closes: "",
      title: "   ",
      message: "Enter a round title.",
    });

    // The draft's title is still the renamed value — no refusal above ever
    // touched it (the blank-title attempt was itself refused).
    const { data: stillRenamed } = await admin
      .from("rounds")
      .select("title")
      .eq("id", draft.roundId)
      .single();
    expect(stillRenamed!.title).toBe(newTitle);

    // Round 1 (read-only checks only — no Save is ever pressed here):
    // Opens is disabled and shows Round 1's own stored value; Closes is
    // empty (open-ended).
    const { data: round1 } = await admin
      .from("rounds")
      .select("id, opens_at, closes_at")
      .eq("round_number", 1)
      .single();

    await page.goto(`/admin/rounds/${round1!.id}`);
    const round1Form = page.locator('[data-slot="schedule-form"]');
    const round1OpensInput = round1Form.getByLabel("Opens (UK time)");
    const round1ClosesInput = round1Form.getByLabel("Closes (UK time)");
    await expect(round1OpensInput).toBeDisabled();
    await expect(round1OpensInput).toHaveValue(
      toAdminDateTimeInputValue(round1!.opens_at as string | null)
    );
    await expect(round1ClosesInput).toHaveValue(
      toAdminDateTimeInputValue(round1!.closes_at as string | null)
    );
  });

  test("Open now on an e2e draft refuses while Round 1 is open, and the badge stays Draft", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, adminEmail);
    await page.goto(`/admin/rounds/${draft.roundId}`);

    await page.getByRole("button", { name: ADMIN_MESSAGES.openNow }).click();
    // Next.js's own route announcer is also role="alert" (a <div>) — scope
    // to the <p> this component renders its error into.
    await expect(page.locator('p[role="alert"]')).toHaveText(
      ADMIN_MESSAGES.anotherRoundOpen
    );
    await expect(
      page.getByText(ADMIN_MESSAGES.statusLabels.draft, { exact: true })
    ).toBeVisible();

    const admin = adminClient();
    const { data } = await admin
      .from("rounds")
      .select("opens_at")
      .eq("id", draft.roundId)
      .single();
    expect(data!.opens_at).toBeNull();
  });

  test("a closed round's page has no lifecycle controls, no schedule form, and shows the closed note", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, adminEmail);
    await page.goto(`/admin/rounds/${closedFixture.roundId}`);

    await expect(
      page.getByRole("button", { name: ADMIN_MESSAGES.openNow })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: ADMIN_MESSAGES.closeEarly })
    ).toHaveCount(0);
    await expect(page.locator('[data-slot="schedule-form"]')).toHaveCount(0);
    await expect(
      page.getByText(ADMIN_MESSAGES.roundClosedNote, { exact: true })
    ).toBeVisible();
  });

  test("Round 1's Close early dialog: Cancel leaves Round 1 untouched, with every POST blocked", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, adminEmail);

    const admin = adminClient();
    const { data: round1 } = await admin
      .from("rounds")
      .select("id, opens_at, closes_at")
      .eq("round_number", 1)
      .single();
    const round1Id = round1!.id as string;

    // Block every POST before the first click — Close round must never be
    // allowed to reach the server on this page, even if pressed by
    // mistake (it never is, below).
    await page.route("**/*", (route) => {
      if (route.request().method() === "POST") {
        return route.abort();
      }
      return route.continue();
    });

    await page.goto(`/admin/rounds/${round1Id}`);

    const closeEarlyButton = page.getByRole("button", {
      name: ADMIN_MESSAGES.closeEarly,
    });
    await expect(closeEarlyButton).toBeVisible();
    await closeEarlyButton.click();

    await expect(
      page.getByRole("heading", { name: ADMIN_MESSAGES.closeRoundTitle })
    ).toBeVisible();
    await expect(
      page.getByText(ADMIN_MESSAGES.closeRoundBody, { exact: true })
    ).toBeVisible();

    await page.getByRole("button", { name: ADMIN_MESSAGES.cancel }).click();
    await expect(
      page.getByRole("heading", { name: ADMIN_MESSAGES.closeRoundTitle })
    ).toHaveCount(0);

    await page.unroute("**/*");

    const { data: round1After } = await admin
      .from("rounds")
      .select("opens_at, closes_at")
      .eq("id", round1Id)
      .single();
    expect(round1After!.opens_at).toBe(round1!.opens_at);
    expect(round1After!.closes_at).toBe(round1!.closes_at);
    expect(await snapshotRound1()).toBe(round1SnapshotBefore);
  });
});
