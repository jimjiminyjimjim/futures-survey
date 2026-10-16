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

const PENDING_EMAIL_COOKIE = "dfs_pending_email";

test.describe.serial("sign-in @sign-in", () => {
  const participantEmail = testEmail("participant");
  const adminEmail = testEmail("admin");

  test.beforeAll(async () => {
    await sweepStaleTestData();
    await grantTestAdmin(adminEmail);
  });

  test.afterAll(async () => {
    await revokeTestAdmin(adminEmail);
    await deleteAuthUserByEmail(participantEmail);
    await deleteAuthUserByEmail(adminEmail);

    expect(await countAuthUsersByEmail(participantEmail)).toBe(0);
    expect(await countAuthUsersByEmail(adminEmail)).toBe(0);
  });

  test("participant can sign in, reload persists, /admin bounces back, sign out works", async ({
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
    await expect(page.getByText(/Signed in as/)).toContainText(
      participantEmail
    );

    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(/Signed in as/)).toContainText(
      participantEmail
    );

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Open admin" })).toHaveCount(
      0
    );

    // Wait for hydration to attach the form action before clicking — a
    // server-rendered submit button is visible/clickable before React
    // hydrates, and clicking before hydration can race the click against
    // the action binding. Once the action is bound, useFormStatus's
    // `pending` disables the button immediately on click, so waiting for
    // "enabled" first also guards against a stale element reference from a
    // double-render.
    const signOutButton = page.getByRole("button", { name: "Sign out" });
    await expect(signOutButton).toBeEnabled();
    await signOutButton.click();
    // signOut() makes a real network round trip to Supabase Auth before
    // redirect(); the default 5s assertion timeout is tighter than this
    // hosted project's observed auth-endpoint latency, which is what made
    // this assertion flaky. Give it real headroom instead of guessing.
    await expect(page).toHaveURL(/\/login$/, { timeout: 20000 });

    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("admin can sign in, reach /admin, and sign out", async ({
    page,
    context,
  }) => {
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
    const openAdminLink = page.getByRole("link", { name: "Open admin" });
    await expect(openAdminLink).toBeVisible();

    await openAdminLink.click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", { name: "Rounds" })
    ).toBeVisible();

    const signOutButton = page.getByRole("button", { name: "Sign out" });
    await expect(signOutButton).toBeEnabled();
    await signOutButton.click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 20000 });
  });

  test("signed-out visitor to /admin is redirected to /login", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login$/);
  });
});
