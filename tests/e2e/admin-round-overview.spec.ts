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
  signInViaCodePage,
  snapshotRound1,
} from "../support/survey-fixtures";
import { formatAdminDateTime } from "../../src/lib/admin/datetime";

/**
 * ADM-01: the admin rounds dashboard shows every round's status, UK-time
 * dates and started/submitted counts; at most one row's badge ever reads
 * "Open" (RND-05). Round 1 is never modified by this spec — snapshotted
 * before and after to prove it.
 */
test.describe.serial("admin dashboard @admin-dashboard", () => {
  const adminEmail = testEmail("admin", "dash");
  const longTitleSuffix = "x".repeat(120);
  let fixtureRoundId: string;
  let closedFixtureRoundId: string;
  let closedFixtureRoundNumber: number;
  let longTitleRoundId: string;
  let round1SnapshotBefore: string;

  test.beforeAll(async () => {
    await sweepStaleTestData();
    round1SnapshotBefore = await snapshotRound1();
    await grantTestAdmin(adminEmail);
    const fixture = await createTestRound({ window: "draft" });
    fixtureRoundId = fixture.roundId;
    const closedFixture = await createTestRound({ window: "closed" });
    closedFixtureRoundId = closedFixture.roundId;
    closedFixtureRoundNumber = closedFixture.roundNumber;
    const longTitleFixture = await createTestRound({
      window: "draft",
      titleSuffix: longTitleSuffix,
    });
    longTitleRoundId = longTitleFixture.roundId;
  });

  test.afterAll(async () => {
    await deleteTestRound(fixtureRoundId).catch(() => undefined);
    await deleteTestRound(closedFixtureRoundId).catch(() => undefined);
    await deleteTestRound(longTitleRoundId).catch(() => undefined);
    await revokeTestAdmin(adminEmail);
    await deleteAuthUserByEmail(adminEmail);
    expect(await countAuthUsersByEmail(adminEmail)).toBe(0);

    const round1SnapshotAfter = await snapshotRound1();
    expect(round1SnapshotAfter).toBe(round1SnapshotBefore);
  });

  test("admin sees every round's status, UK-time dates and started/submitted counts", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, adminEmail);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/);

    await expect(
      page.getByRole("heading", { level: 1, name: "Rounds" })
    ).toBeVisible();

    const admin = adminClient();
    const { data: round1 } = await admin
      .from("rounds")
      .select("opens_at")
      .eq("round_number", 1)
      .single();
    const round1OpensDisplay = formatAdminDateTime(
      round1!.opens_at as string
    );

    const round1Row = page.getByRole("row", {
      name: /Round 1(\s|$)/,
    });
    await expect(round1Row.getByRole("link", { name: "Round 1" })).toBeVisible();
    await expect(round1Row).toContainText("Open");
    await expect(round1Row).toContainText("Until closed");
    await expect(round1Row).toContainText(
      "Round 1 · 7 sections · 85 statements"
    );
    await expect(round1Row).toContainText(round1OpensDisplay!);
    await expect(round1Row.getByText(/\d+ started · \d+ submitted/)).toBeVisible();

    // The plain draft fixture: both date cells blank, zero counts, 1
    // section / 2 statements.
    const draftRows = page.locator("tbody tr", { hasText: "e2e-" });
    const fixtureRow = draftRows.filter({ hasNotText: longTitleSuffix }).filter({
      hasNotText: "Closed",
    });
    await expect(fixtureRow).toContainText("Draft");
    await expect(fixtureRow).toContainText("0 started · 0 submitted");
    await expect(fixtureRow).toContainText("1 section · 2 statements");
    await expect(fixtureRow.getByText("Not set")).toHaveCount(2);

    // The closed fixture: status "Closed" and both of its 2001 dates
    // formatted via formatAdminDateTime (never "Until closed"/"Not set").
    const closedAdmin = adminClient();
    const { data: closedRound } = await closedAdmin
      .from("rounds")
      .select("opens_at, closes_at")
      .eq("id", closedFixtureRoundId)
      .single();
    const closedOpensDisplay = formatAdminDateTime(
      closedRound!.opens_at as string
    );
    const closedClosesDisplay = formatAdminDateTime(
      closedRound!.closes_at as string
    );
    // Scoped by the fixture's own round_number (unique in its "Round {n}
    // · ..." caption) rather than the status text "Closed" — Playwright's
    // hasText is a case-insensitive substring match, so filtering on
    // "Closed" alone would also match Round 1's "Until closed" cell.
    const closedRow = page.locator("tbody tr", {
      hasText: `Round ${closedFixtureRoundNumber} ·`,
    });
    await expect(closedRow).toContainText("Closed");
    await expect(closedRow).toContainText(closedOpensDisplay!);
    await expect(closedRow).toContainText(closedClosesDisplay!);

    // Long-title fixture: the title link's full text is visible and its
    // bounding box is contained within its own cell's bounding box (no
    // horizontal clipping/truncation).
    const longTitleLink = page.getByRole("link", {
      name: new RegExp(`e2e-.*${longTitleSuffix}`),
    });
    await expect(longTitleLink).toBeVisible();
    const linkBox = await longTitleLink.boundingBox();
    const cellBox = await longTitleLink
      .locator("xpath=ancestor::td[1]")
      .boundingBox();
    expect(linkBox).not.toBeNull();
    expect(cellBox).not.toBeNull();
    expect(linkBox!.x).toBeGreaterThanOrEqual(cellBox!.x - 1);
    expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(
      cellBox!.x + cellBox!.width + 1
    );

    // Newest-first: every e2e fixture has a far higher round_number than
    // Round 1, so every e2e row renders above Round 1's.
    const rows = page.locator("table tbody tr");
    const round1Index = await rows
      .filter({ hasText: "Round 1" })
      .first()
      .evaluate((el) => Array.from(el.parentElement!.children).indexOf(el));
    const fixtureIndex = await rows
      .filter({ hasText: "e2e-" })
      .first()
      .evaluate((el) => Array.from(el.parentElement!.children).indexOf(el));
    expect(fixtureIndex).toBeLessThan(round1Index);

    // At most one "Open" badge exists on the whole page.
    await expect(page.getByText("Open", { exact: true })).toHaveCount(1);
  });
});
