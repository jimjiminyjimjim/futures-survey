import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  testEmail,
  countAuthUsersByEmail,
  deleteAuthUserByEmail,
  sweepStaleTestData,
} from "../support/supabase-admin";

function publishableClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function randomPassword(): string {
  return Array.from({ length: 24 }, () =>
    Math.random().toString(36)[2]
  ).join("");
}

function matchesHookRejection(error: { status?: number; message?: string } | null): boolean {
  if (!error) return false;
  const status = error.status;
  const message = error.message ?? "";
  return status === 403 || /isn't eligible/i.test(message);
}

test.describe("auth bypass attempts (hosted project, publishable key) @auth-bypass", () => {
  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test("password signUp for an ineligible email is rejected by the hook", async () => {
    const probeEmail = testEmail("probe");
    const client = publishableClient();

    try {
      const { data, error } = await client.auth.signUp({
        email: probeEmail,
        password: randomPassword(),
      });

      expect(error, "signUp should be rejected for an ineligible email").toBeTruthy();
      expect(
        matchesHookRejection(error as { status?: number; message?: string } | null),
        `observed signUp rejection shape: status=${(error as { status?: number } | null)?.status} message="${error?.message}"`
      ).toBe(true);
      expect(data.user).toBeNull();

      expect(await countAuthUsersByEmail(probeEmail)).toBe(0);
    } finally {
      const count = await countAuthUsersByEmail(probeEmail);
      if (count > 0) {
        await deleteAuthUserByEmail(probeEmail);
      }
    }
  });

  test("parallel OTP probes for the same ineligible email are all rejected", async () => {
    const probeEmail = testEmail("probe");
    const client = publishableClient();

    try {
      const [first, second] = await Promise.all([
        client.auth.signInWithOtp({
          email: probeEmail,
          options: { shouldCreateUser: true },
        }),
        client.auth.signInWithOtp({
          email: probeEmail,
          options: { shouldCreateUser: true },
        }),
      ]);

      for (const [index, result] of [first, second].entries()) {
        expect(
          result.error,
          `parallel call ${index + 1} should be rejected`
        ).toBeTruthy();
        expect(
          matchesHookRejection(
            result.error as { status?: number; message?: string } | null
          ),
          `observed parallel rejection shape ${index + 1}: status=${(result.error as { status?: number } | null)?.status} message="${result.error?.message}"`
        ).toBe(true);
      }

      expect(await countAuthUsersByEmail(probeEmail)).toBe(0);
    } finally {
      const count = await countAuthUsersByEmail(probeEmail);
      if (count > 0) {
        await deleteAuthUserByEmail(probeEmail);
      }
    }
  });

  test.afterAll(async () => {
    const probeCount = await countAuthUsersByEmail(testEmail("probe"));
    expect(probeCount).toBe(0);
  });
});
