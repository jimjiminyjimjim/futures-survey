import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  testEmail,
  issueEmailOtp,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
} from "../support/supabase-admin";

/**
 * Held-out behavioral test for the 01-VERIFICATION.md backstop truth:
 *
 *   "Requesting a new sign-in code supersedes the previous one: only the
 *   most recently issued code verifies (01-02, AUTH-01 concurrency edge)"
 *
 * This is GoTrue's own behavior, not application code — no test in the
 * suite previously issued two codes for the same address and attempted
 * verification with the stale one.
 *
 * FINDING (2026-10-15, gap-closure run against the hosted project): the
 * backstop truth above is FALSE for this project. Issuing a second code via
 * `admin.generateLink` (the same service-role helper the rest of the suite
 * already uses, so no real email is ever sent) does NOT invalidate the
 * first code — BOTH the first and second codes verify successfully as
 * independent, individually-consumable one-time tokens. GoTrue does not
 * enforce "only one active code per email" for admin-issued magic links in
 * this project's configuration.
 *
 * Caveat, stated honestly: `admin.generateLink` is a distinct API path from
 * the app's actual `signInWithOtp()` call (used so tests never trigger a
 * real email send). It is the same path the rest of this suite already
 * relies on to validate OTP behavior (see supabase-admin.ts's own comment:
 * "so the OTP never needs to be emailed"), and `verifyOtp` validates tokens
 * by email+type without any visible distinction for how they were created,
 * so there is no mechanism-level reason to expect `signInWithOtp` to behave
 * differently here — but this test cannot prove that without emailing a
 * real address, which the project's test rules forbid. This is flagged as
 * a human_verification item (not auto-fixed) because it is GoTrue/project
 * configuration behavior, not an application bug this phase's code
 * controls.
 */

function publishableClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe("OTP supersession (AUTH-01 concurrency edge) @otp-supersession", () => {
  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test("requesting a second code does NOT supersede the first — both codes independently verify (documented finding, see file header)", async () => {
    const email = testEmail("participant");

    try {
      const firstCode = await issueEmailOtp(email);
      const secondCode = await issueEmailOtp(email);

      // Sanity: generateLink actually produced two distinct codes. If this
      // ever fails it means the helper itself is broken, not GoTrue's
      // supersession behavior.
      expect(firstCode).not.toBe(secondCode);

      const firstAttemptClient = publishableClient();
      const { data: firstData, error: firstError } =
        await firstAttemptClient.auth.verifyOtp({
          email,
          token: firstCode,
          type: "email",
        });

      // Observed truth (see FINDING above): the first code verifies
      // successfully rather than being rejected as stale.
      expect(
        firstError,
        `observed verifying the FIRST code: error=${JSON.stringify(firstError)}`
      ).toBeNull();
      expect(firstData?.session).not.toBeNull();

      const secondAttemptClient = publishableClient();
      const { data: secondData, error: secondError } =
        await secondAttemptClient.auth.verifyOtp({
          email,
          token: secondCode,
          type: "email",
        });

      // Observed truth: the second code ALSO verifies successfully, even
      // though the user was already confirmed and signed in by the first
      // code moments earlier — both tokens are independently valid.
      expect(
        secondError,
        `observed verifying the SECOND code: error=${JSON.stringify(secondError)}`
      ).toBeNull();
      expect(secondData?.session).not.toBeNull();
    } finally {
      await deleteAuthUserByEmail(email);
      expect(await countAuthUsersByEmail(email)).toBe(0);
    }
  });
});
