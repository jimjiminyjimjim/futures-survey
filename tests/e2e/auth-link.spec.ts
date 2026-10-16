import { test, expect } from "@playwright/test";
import {
  testEmail,
  adminClient,
  assertTestIdentity,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
} from "../support/supabase-admin";
import { AUTH_MESSAGES } from "../../src/lib/auth/messages";

/**
 * Covers the email-link sign-in path added alongside the 6-digit code:
 * /auth/confirm exchanging a Supabase magic-link token_hash for a session,
 * and the expired/invalid-link fallback to /login.
 */
test.describe.serial("auth email-link sign-in @auth-link", () => {
  const participantEmail = testEmail("participant", "lnk");

  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test.afterAll(async () => {
    await deleteAuthUserByEmail(participantEmail);
    expect(await countAuthUsersByEmail(participantEmail)).toBe(0);
  });

  test("a valid magic link signs the user in and lands at /", async ({
    page,
  }) => {
    assertTestIdentity(participantEmail);
    const client = adminClient();

    const { data, error } = await client.auth.admin.generateLink({
      type: "magiclink",
      email: participantEmail,
    });

    if (error || !data?.properties) {
      throw new Error(
        `Failed to generate a magic link for ${participantEmail}: ${
          error?.message ?? "no properties in response"
        }`
      );
    }

    const { hashed_token, verification_type } = data.properties;

    await page.goto(
      `/auth/confirm?token_hash=${hashed_token}&type=${verification_type}`
    );

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(/Signed in as/)).toContainText(
      participantEmail
    );
  });

  test("an invalid/already-used token lands on /login with the expired-link message", async ({
    page,
  }) => {
    await page.goto(
      "/auth/confirm?token_hash=not-a-real-token-hash&type=magiclink"
    );

    await expect(page).toHaveURL(/\/login\?error=link$/);
    // Next's own route announcer (#__next-route-announcer__) also carries
    // role="alert" with empty text, so scope to the page's error paragraph.
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toHaveText(AUTH_MESSAGES.linkExpired);
  });
});
