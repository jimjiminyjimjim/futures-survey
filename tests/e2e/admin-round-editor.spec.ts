import { test, expect } from "@playwright/test";
import {
  testEmail,
  adminClient,
  grantTestAdmin,
  revokeTestAdmin,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
} from "../support/supabase-admin";
import {
  createTestRound,
  deleteTestRound,
  deleteTestCreatedRound,
  signInViaCodePage,
  snapshotRound1,
  E2E_ROUND_NUMBER_MIN,
  type TestRound,
} from "../support/survey-fixtures";

/**
 * RND-01/RND-04: an admin creates the next round as an exact,
 * key-preserving copy of the most recent one. Round 1 is read-only here —
 * snapshotted before/after to prove it. admin_create_round makes a
 * REAL-numbered round (e.g. Round 2): every test here must delete what it
 * created, and afterAll sweeps anything stray left behind.
 *
 * RND-03 (editing a draft round's sections/statements) was descoped by the
 * user on 2026-10-15 — new rounds copy the previous round's questions
 * unchanged, and there is no UI to edit them. The DB-level copy and lock
 * rules still exist and are covered by tests/api/admin-content-db.spec.ts;
 * the UI-level editor spec (tests/e2e/admin-round-sections.spec.ts) was
 * deleted along with the SectionEditor/StatementList components.
 */
test.describe.serial("admin round editor @admin-round-editor", () => {
  const adminEmail = testEmail("admin", "edit");

  let round1SnapshotBefore: string;
  let testStartedAt: string;
  let source: TestRound;
  let createdRoundId: string | undefined;

  test.beforeAll(async () => {
    await sweepStaleTestData();
    round1SnapshotBefore = await snapshotRound1();
    testStartedAt = new Date().toISOString();

    await grantTestAdmin(adminEmail);

    source = await createTestRound({
      window: "draft",
      highest: true,
      sections: [
        { scaleKey: "familiarity", statementCount: 2 },
        { scaleKey: "agreement", statementCount: 3 },
        { scaleKey: "agreement", statementCount: 0 },
      ],
    });
  });

  test.afterAll(async () => {
    if (createdRoundId) {
      await deleteTestCreatedRound(createdRoundId).catch(() => undefined);
    }

    // Belt-and-braces: sweep any stray round this run may have created
    // through the dashboard button that wasn't explicitly tracked above —
    // admin_create_round makes real-numbered rounds, so Round 1 must stay
    // the only real round after this spec.
    const admin = adminClient();
    const { data: strayRounds } = await admin
      .from("rounds")
      .select("id")
      .gte("round_number", E2E_ROUND_NUMBER_MIN)
      .gte("created_at", testStartedAt)
      .is("opens_at", null);
    for (const row of strayRounds ?? []) {
      await deleteTestCreatedRound(row.id as string).catch(() => undefined);
    }

    await deleteTestRound(source.roundId).catch(() => undefined);
    await revokeTestAdmin(adminEmail);
    await deleteAuthUserByEmail(adminEmail);
    expect(await countAuthUsersByEmail(adminEmail)).toBe(0);

    const round1SnapshotAfter = await snapshotRound1();
    expect(round1SnapshotAfter).toBe(round1SnapshotBefore);
  });

  test("create", async ({ page, context }) => {
    await signInViaCodePage(page, context, adminEmail);
    await page.goto("/admin");

    await page.getByRole("button", { name: "Create new round" }).click();
    await page.waitForURL(/\/admin\/rounds\/[0-9a-f-]{36}$/);

    createdRoundId = page.url().split("/").pop();

    const expectedRoundNumber = source.roundNumber + 1;
    await expect(
      page.getByRole("heading", { level: 1, name: `Round ${expectedRoundNumber}` })
    ).toBeVisible();
    // The previous /admin dashboard route (which also lists the draft
    // `source` fixture, badge "Draft") stays mounted-but-hidden after this
    // client-side navigation — same cacheComponents/partialPrefetching
    // quirk Phase 2 documented. Filter to the one actually-visible match.
    await expect(
      page.getByText("Draft", { exact: true }).filter({ visible: true })
    ).toBeVisible();

    // Admin simplification (user decision 2026-10-15, RND-03 descoped): the
    // round page shows status/actions only — no section/statement list and
    // no statement keys — even though admin_create_round still copies the
    // previous round's content unchanged underneath (asserted via the DB
    // below).
    for (const key of source.statementKeys) {
      await expect(page.getByText(`Key ${key}`)).toHaveCount(0);
    }
    await expect(page.getByText(/^Key /)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add statement" })
    ).toHaveCount(0);

    const admin = adminClient();

    async function sectionsWithStatements(roundId: string) {
      const { data } = await admin
        .from("sections")
        .select("id, sort_order, scale_key, statements(sort_order, key, text)")
        .eq("round_id", roundId)
        .order("sort_order");
      return (data ?? []).map((section) => ({
        id: section.id as string,
        sortOrder: section.sort_order as number,
        scaleKey: section.scale_key as string,
        statements: (
          (section.statements as
            | { sort_order: number; key: string; text: string }[]
            | null) ?? []
        )
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((s) => ({ sortOrder: s.sort_order, key: s.key, text: s.text })),
      }));
    }

    const newSections = await sectionsWithStatements(createdRoundId!);
    const sourceSections = await sectionsWithStatements(source.roundId);

    const stripId = (rows: typeof newSections) =>
      rows.map((row) => ({
        sortOrder: row.sortOrder,
        scaleKey: row.scaleKey,
        statements: row.statements,
      }));
    expect(stripId(newSections)).toEqual(stripId(sourceSections));

    const sourceSectionIds = new Set(sourceSections.map((s) => s.id));
    for (const section of newSections) {
      expect(sourceSectionIds.has(section.id)).toBe(false);
    }

    const { data: newRound } = await admin
      .from("rounds")
      .select("opens_at, closes_at")
      .eq("id", createdRoundId!)
      .single();
    expect(newRound!.opens_at).toBeNull();
    expect(newRound!.closes_at).toBeNull();

    const { data: sourceAfter } = await admin
      .from("rounds")
      .select("title, opens_at, closes_at")
      .eq("id", source.roundId)
      .single();
    expect(sourceAfter!.opens_at).toBeNull();
    expect(sourceAfter!.closes_at).toBeNull();
  });
});
