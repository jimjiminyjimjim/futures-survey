import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  adminClient,
  testEmail,
  countAuthUsersByEmail,
  deleteAuthUserByEmail,
  sweepStaleTestData,
  grantTestAdmin,
  withAdminEmailsRestore,
  signInAsTestUser,
} from "../support/supabase-admin";

function publishableClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function randomPassword(): string {
  return Array.from({ length: 24 }, () => Math.random().toString(36)[2]).join(
    ""
  );
}

test.describe("auth hooks (hosted project, before_user_created + custom_access_token)", () => {
  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test("ineligible direct OTP is rejected by the hook, twice, with no user", async () => {
    const probeEmail = testEmail("probe");
    const client = publishableClient();

    try {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const { error } = await client.auth.signInWithOtp({
          email: probeEmail,
          options: { shouldCreateUser: true },
        });

        expect(error, `attempt ${attempt} should be rejected`).toBeTruthy();
        const status = (error as { status?: number } | null)?.status;
        const message = error?.message ?? "";
        const matchesExpectedShape =
          /isn't eligible/i.test(message) || status === 403;

        // If GoTrue's observed error shape differs from what we expect,
        // this assertion documents the actual message/status for the
        // SUMMARY rather than failing silently.
        expect(
          matchesExpectedShape,
          `observed hook rejection shape: status=${status} message="${message}"`
        ).toBe(true);
      }

      const count = await countAuthUsersByEmail(probeEmail);
      expect(count).toBe(0);
    } finally {
      const count = await countAuthUsersByEmail(probeEmail);
      if (count > 0) {
        await deleteAuthUserByEmail(probeEmail);
      }
    }
  });

  test("password sign-in is refused", async () => {
    const pwEmail = testEmail("pw");
    const admin = adminClient();

    try {
      const password = Array.from({ length: 24 }, () =>
        Math.random().toString(36)[2]
      ).join("");

      const { error: createError } = await admin.auth.admin.createUser({
        email: pwEmail,
        password,
        email_confirm: true,
      });
      expect(createError).toBeNull();

      // Use the correct password so GoTrue's password-verification step
      // succeeds and the request actually reaches the custom_access_token
      // hook — a wrong password would be rejected earlier for the wrong
      // reason and wouldn't exercise the hook at all.
      const client = publishableClient();
      const { data, error } = await client.auth.signInWithPassword({
        email: pwEmail,
        password,
      });

      expect(error).toBeTruthy();
      const status = (error as { status?: number } | null)?.status;
      const message = error?.message ?? "";
      const matchesExpectedShape =
        /password sign-in/i.test(message) || status === 403;
      expect(
        matchesExpectedShape,
        `observed password refusal shape: status=${status} message="${message}"`
      ).toBe(true);
      expect(data.session).toBeNull();
    } finally {
      await deleteAuthUserByEmail(pwEmail);
    }
  });

  test("admin password sign-in is refused until the service-role flag is set, then issues an admin session", async () => {
    const email = testEmail("admin", "pwd");
    const admin = adminClient();

    try {
      await withAdminEmailsRestore(async () => {
        await grantTestAdmin(email);

        const p1 = randomPassword();
        const { data: createData, error: createError } =
          await admin.auth.admin.createUser({
            email,
            password: p1,
            email_confirm: true,
          });
        expect(createError).toBeNull();
        const user = createData.user!;

        // Flagged? No — a plain password-bearing admin account must still
        // be refused by the hook.
        const refusedClient1 = publishableClient();
        const { data: refusedData1, error: refusedError1 } =
          await refusedClient1.auth.signInWithPassword({
            email,
            password: p1,
          });
        expect(refusedError1).toBeTruthy();
        const refusedStatus1 = (refusedError1 as { status?: number } | null)
          ?.status;
        const refusedMessage1 = refusedError1?.message ?? "";
        expect(
          /password sign-in/i.test(refusedMessage1) || refusedStatus1 === 403,
          `observed refusal shape: status=${refusedStatus1} message="${refusedMessage1}"`
        ).toBe(true);
        expect(refusedData1.session).toBeNull();

        // Setting the flag also rotates the password away from p1 onto p2
        // — the operator script's defense against pre-registration.
        const p2 = randomPassword();
        const { error: updateError } = await admin.auth.admin.updateUserById(
          user.id,
          {
            password: p2,
            app_metadata: { ...user.app_metadata, admin_password_login: true },
          }
        );
        expect(updateError).toBeNull();

        // p1 must now fail — it was rotated away by the update above.
        const refusedClient2 = publishableClient();
        const { data: refusedData2, error: refusedError2 } =
          await refusedClient2.auth.signInWithPassword({
            email,
            password: p1,
          });
        expect(refusedError2).toBeTruthy();
        expect(refusedData2.session).toBeNull();

        // p2, with the flag set, must succeed and yield an admin session.
        const allowedClient = publishableClient();
        const { data: allowedData, error: allowedError } =
          await allowedClient.auth.signInWithPassword({
            email,
            password: p2,
          });
        expect(allowedError).toBeNull();
        expect(allowedData.session).not.toBeNull();
        const { data: isAdminViaPassword } =
          await allowedClient.rpc("is_admin");
        expect(isAdminViaPassword).toBe(true);

        // OTP through the same replaced hook must still issue an admin
        // session too.
        const otpClient = await signInAsTestUser(email);
        const { data: isAdminViaOtp } = await otpClient.rpc("is_admin");
        expect(isAdminViaOtp).toBe(true);
      });
    } finally {
      await deleteAuthUserByEmail(email);
    }
  });

  test("a flagged account that is not on admin_emails is refused", async () => {
    const email = testEmail("pw", "flag");
    const admin = adminClient();

    try {
      const password = randomPassword();
      const { error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { admin_password_login: true },
      });
      expect(createError).toBeNull();

      const client = publishableClient();
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });

      expect(error).toBeTruthy();
      const status = (error as { status?: number } | null)?.status;
      const message = error?.message ?? "";
      expect(
        /password sign-in/i.test(message) || status === 403,
        `observed refusal shape: status=${status} message="${message}"`
      ).toBe(true);
      expect(data.session).toBeNull();
    } finally {
      await deleteAuthUserByEmail(email);
    }
  });

  test.afterAll(async () => {
    const probeCount = await countAuthUsersByEmail(testEmail("probe"));
    const pwCount = await countAuthUsersByEmail(testEmail("pw"));
    const adminPwdCount = await countAuthUsersByEmail(testEmail("admin", "pwd"));
    const pwFlagCount = await countAuthUsersByEmail(testEmail("pw", "flag"));
    expect(probeCount).toBe(0);
    expect(pwCount).toBe(0);
    expect(adminPwdCount).toBe(0);
    expect(pwFlagCount).toBe(0);
  });
});
