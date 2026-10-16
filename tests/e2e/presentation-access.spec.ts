import { test, expect } from "@playwright/test";
import {
  testEmail,
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
  type TestRound,
} from "../support/survey-fixtures";

/**
 * PRES-01/02 access control for /admin/rounds/{id}/present (T-04-02,
 * T-04-04 in 04-01-PLAN.md's threat register): a signed-in participant
 * is redirected to "/", a signed-out visitor to "/login", and a
 * malformed or unknown round id 404s for an admin. admin/layout.tsx's
 * guard provides the participant/signed-out redirects; this spec proves
 * they hold for the present route specifically.
 */
test.describe.serial("presentation access @presentation-access", () => {
  const adminEmail = testEmail("admin", "pacc");
  const participantEmail = testEmail("participant", "prx");

  let round1SnapshotBefore: string;
  let R2: TestRound;

  test.beforeAll(async () => {
    await sweepStaleTestData();
    round1SnapshotBefore = await snapshotRound1();
    await grantTestAdmin(adminEmail);

    R2 = await createTestRound({
      window: "closed",
      sections: [{ scaleKey: "agreement", statementCount: 1 }],
    });
  });

  test.afterAll(async () => {
    await deleteTestRound(R2.roundId).catch(() => undefined);
    await revokeTestAdmin(adminEmail).catch(() => undefined);
    for (const email of [adminEmail, participantEmail]) {
      await deleteAuthUserByEmail(email);
      expect(await countAuthUsersByEmail(email)).toBe(0);
    }

    const round1SnapshotAfter = await snapshotRound1();
    expect(round1SnapshotAfter).toBe(round1SnapshotBefore);
  });

  test("a signed-in participant requesting the present route is redirected to /", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, participantEmail);
    await page.goto(`/admin/rounds/${R2.roundId}/present`);
    await expect(page).toHaveURL(/\/$/);
  });

  test("a signed-out visitor requesting the present route is redirected to /login", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`/admin/rounds/${R2.roundId}/present`);
      await expect(page).toHaveURL(/\/login$/);
    } finally {
      await context.close();
    }
  });

  test("a malformed round id returns 404 for an admin", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, adminEmail);
    const response = await page.goto("/admin/rounds/not-a-uuid/present");
    expect(response?.status()).toBe(404);
  });

  test("an unknown round id returns 404 for an admin", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, adminEmail);
    const response = await page.goto(
      "/admin/rounds/00000000-0000-4000-8000-000000000000/present"
    );
    expect(response?.status()).toBe(404);
  });
});
