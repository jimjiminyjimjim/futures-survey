import { test, expect } from "@playwright/test";
import {
  testEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
} from "../support/supabase-admin";
import { AUTH_MESSAGES } from "../../src/lib/auth/messages";

const PENDING_EMAIL_COOKIE = "dfs_pending_email";

test.describe("eligibility gate (UI) @eligibility", () => {
  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test("ineligible email is refused in the UI", async ({ page, context }) => {
    const probeEmail = testEmail("probe");

    await page.goto("/login");
    await page.getByLabel("Email address").fill(probeEmail);
    await page.getByRole("button", { name: "Send me a code" }).click();

    // Next's own route announcer (#__next-route-announcer__) also carries
    // role="alert" with empty text, so scope to the form's error paragraph.
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toHaveText(AUTH_MESSAGES.ineligible);

    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(page.url()).not.toContain("@");
    expect(page.url()).not.toContain("%40");

    const cookies = await context.cookies();
    expect(
      cookies.find((c) => c.name === PENDING_EMAIL_COOKIE)
    ).toBeUndefined();

    expect(await countAuthUsersByEmail(probeEmail)).toBe(0);
  });

  test("malformed input is refused without ever requesting a code", async ({
    page,
  }) => {
    const cases: Array<{ input: string; expectInvalidEmail: boolean }> = [
      { input: "", expectInvalidEmail: true },
      { input: "   ", expectInvalidEmail: true },
      { input: "not-an-email", expectInvalidEmail: true },
      { input: "a@b@network.rca.ac.uk", expectInvalidEmail: false },
    ];

    for (const { input, expectInvalidEmail } of cases) {
      await page.goto("/login");
      await page.getByLabel("Email address").fill(input);
      await page.getByRole("button", { name: "Send me a code" }).click();

      // Next's own route announcer (#__next-route-announcer__) also carries
      // role="alert" with empty text, so scope to the form's error paragraph.
      const alert = page.locator('p[role="alert"]');
      await expect(alert).toBeVisible();

      if (expectInvalidEmail) {
        await expect(alert).toHaveText(AUTH_MESSAGES.invalidEmail);
      } else {
        const text = await alert.textContent();
        expect(
          text === AUTH_MESSAGES.invalidEmail ||
            text === AUTH_MESSAGES.ineligible,
          `unexpected message for "${input}": "${text}"`
        ).toBe(true);
      }

      const url = new URL(page.url());
      expect(url.pathname, `must not redirect for input "${input}"`).toBe(
        "/login"
      );
    }
  });
});
