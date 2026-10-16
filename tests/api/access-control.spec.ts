import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  testEmail,
  grantTestAdmin,
  revokeTestAdmin,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
  signInAsTestUser,
} from "../support/supabase-admin";

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe.serial("admin table RLS + live revocation @access-control", () => {
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

  test("anon reads zero rows and cannot insert", async () => {
    const client = anonClient();

    const { data: adminRows, error: adminError } = await client
      .from("admin_emails")
      .select("email");
    if (adminError) {
      expect(adminError).toBeTruthy();
    } else {
      expect(adminRows).toEqual([]);
    }

    const { data: domainRows, error: domainError } = await client
      .from("allowed_domains")
      .select("domain");
    if (domainError) {
      expect(domainError).toBeTruthy();
    } else {
      expect(domainRows).toEqual([]);
    }

    const { error: insertError } = await client
      .from("allowed_domains")
      .insert({ domain: "evil.example.com" });
    expect(insertError).toBeTruthy();
  });

  test("participant reads zero rows, cannot insert, is_admin is false", async () => {
    const client = await signInAsTestUser(participantEmail);

    const { data: adminRows, error: adminError } = await client
      .from("admin_emails")
      .select("email");
    if (adminError) {
      expect(adminError).toBeTruthy();
    } else {
      expect(adminRows).toEqual([]);
    }

    const { data: domainRows, error: domainError } = await client
      .from("allowed_domains")
      .select("domain");
    if (domainError) {
      expect(domainError).toBeTruthy();
    } else {
      expect(domainRows).toEqual([]);
    }

    const { error: insertError } = await client
      .from("allowed_domains")
      .insert({ domain: "evil.example.com" });
    expect(insertError).toBeTruthy();

    const { data: isAdmin, error: isAdminError } =
      await client.rpc("is_admin");
    expect(isAdminError).toBeNull();
    expect(isAdmin).toBe(false);
  });

  test("admin reads the seeded rows and is_admin is true, then live revocation flips it to false in the same session", async () => {
    await grantTestAdmin(adminEmail);
    const client = await signInAsTestUser(adminEmail);

    const { data: isAdminBefore, error: isAdminBeforeError } =
      await client.rpc("is_admin");
    expect(isAdminBeforeError).toBeNull();
    expect(isAdminBefore).toBe(true);

    const { data: adminRows, error: adminError } = await client
      .from("admin_emails")
      .select("email");
    expect(adminError).toBeNull();
    const adminEmails = (adminRows ?? []).map((r) => r.email as string);
    expect(adminEmails).toContain("rhodes.james@gmail.com");
    expect(adminEmails).toContain("james.carrigan@network.rca.ac.uk");

    const { data: domainRows, error: domainError } = await client
      .from("allowed_domains")
      .select("domain");
    expect(domainError).toBeNull();
    const domains = (domainRows ?? []).map((r) => r.domain as string);
    expect(domains).toContain("network.rca.ac.uk");

    // Live revocation: same signed-in client, no re-login.
    await revokeTestAdmin(adminEmail);

    const { data: isAdminAfter, error: isAdminAfterError } =
      await client.rpc("is_admin");
    expect(isAdminAfterError).toBeNull();
    expect(isAdminAfter).toBe(false);
  });
});
