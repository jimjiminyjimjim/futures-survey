import { test, expect } from "@playwright/test";
import {
  testEmail,
  issueEmailOtp,
  grantTestAdmin,
  revokeTestAdmin,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
} from "../support/supabase-admin";
import { AUTH_MESSAGES } from "../../src/lib/auth/messages";

const PENDING_EMAIL_COOKIE = "dfs_pending_email";

test.describe.serial("access guards @access", () => {
  const participantEmail = testEmail("participant");
  const adminEmail = testEmail("admin");

  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test.afterAll(async () => {
    await revokeTestAdmin(adminEmail).catch(() => undefined);
    await deleteAuthUserByEmail(participantEmail);
    await deleteAuthUserByEmail(adminEmail);

    expect(await countAuthUsersByEmail(participantEmail)).toBe(0);
    expect(await countAuthUsersByEmail(adminEmail)).toBe(0);
  });

  test("visiting /login/code without a pending-email cookie redirects to /login", async ({
    page,
  }) => {
    await page.goto("/login/code");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("code-format validation and rejection on /login/code", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: PENDING_EMAIL_COOKIE,
        value: encodeURIComponent(participantEmail),
        domain: "localhost",
        path: "/login",
      },
    ]);

    await page.goto("/login/code");

    const alert = page.locator('p[role="alert"]');

    await page.getByLabel("6-digit code").fill("12ab");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(alert).toHaveText(AUTH_MESSAGES.invalidCodeFormat);
    await expect(page).toHaveURL(/\/login\/code$/);

    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(alert).toHaveText(AUTH_MESSAGES.codeRejected);
    await expect(page).toHaveURL(/\/login\/code$/);
  });

  test("live admin revocation bounces the same session out of /admin", async ({
    page,
    context,
  }) => {
    await grantTestAdmin(adminEmail);
    const code = await issueEmailOtp(adminEmail);

    await context.addCookies([
      {
        name: PENDING_EMAIL_COOKIE,
        value: encodeURIComponent(adminEmail),
        domain: "localhost",
        path: "/login",
      },
    ]);

    await page.goto("/login/code");
    await page.getByLabel("6-digit code").fill(code);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Rounds" })).toBeVisible();

    await revokeTestAdmin(adminEmail);

    await page.reload();
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a signed-in participant visiting /admin/anything ends on /", async ({
    page,
    context,
  }) => {
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

    await page.goto("/admin/anything");
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
