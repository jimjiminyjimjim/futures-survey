import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  adminClient,
  testEmail,
  testDomain,
  grantTestAdmin,
  revokeTestAdmin,
  revokeTestDomain,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
  signInAsTestUser,
  snapshotAccessLists,
  withAdminEmailsRestore,
} from "../support/supabase-admin";
import { adminErrorMessage } from "../../src/lib/admin/messages";

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * AUTH-07's admin UI was descoped by the user (2026-10-15): admins manage
 * admin_emails/allowed_domains directly in the Supabase Table Editor, not
 * through an app screen. The DB-level "never remove the last admin"
 * guarantee (admin_emails_keep_one trigger, migration 20261015000900) is
 * retained and proven here regardless — it protects the table no matter
 * who or what writes to it.
 */
test.describe("admin access — @static (no DB)", () => {
  test("adminErrorMessage maps last_admin to the friendly copy", () => {
    expect(adminErrorMessage({ code: "23514", hint: "last_admin" })).toBe(
      "Can't remove the last admin — add another admin first."
    );
  });
});

/**
 * AUTH-07's DB proofs: write RLS for participant/anon, admin add/remove
 * with the live is_admin()/is_email_eligible() effect, the normalisation
 * backstop, and the atomic last-admin refusal. The real admin emails
 * (rhodes.james@gmail.com, james.carrigan@network.rca.ac.uk) and the real
 * domain (network.rca.ac.uk) are only ever read here, via
 * withAdminEmailsRestore for the one statement that targets every row.
 */
test.describe.serial("admin access DB — @admin-access-db", () => {
  const participantEmail = testEmail("participant", "adb");
  const dbAdmin = testEmail("admin", "adb");

  let before: string;

  test.beforeAll(async () => {
    await sweepStaleTestData();
    before = await snapshotAccessLists();
    await grantTestAdmin(dbAdmin);
  });

  test.afterAll(async () => {
    await sweepStaleTestData();
    expect(await countAuthUsersByEmail(dbAdmin)).toBe(0);
    expect(await countAuthUsersByEmail(participantEmail)).toBe(0);
    const after = await snapshotAccessLists();
    expect(after).toBe(before);
  });

  test("participant and anon cannot write; cannot delete a target admin row or test domain", async () => {
    const targetAdminEmail = testEmail("admin", "tgt");
    const targetDomain = testDomain("t");
    await grantTestAdmin(targetAdminEmail);
    const admin = adminClient();
    await admin.from("allowed_domains").insert({ domain: targetDomain });

    const participant = await signInAsTestUser(participantEmail);
    const anon = anonClient();

    for (const client of [participant, anon]) {
      const { error: adminInsertError } = await client
        .from("admin_emails")
        .insert({ email: testEmail("admin", "hack") });
      expect(adminInsertError).toBeTruthy();

      const { error: domainInsertError } = await client
        .from("allowed_domains")
        .insert({ domain: testDomain("hack") });
      expect(domainInsertError).toBeTruthy();

      const { data: adminDeleteRows } = await client
        .from("admin_emails")
        .delete()
        .eq("email", targetAdminEmail)
        .select("email");
      expect(adminDeleteRows ?? []).toEqual([]);

      const { data: domainDeleteRows } = await client
        .from("allowed_domains")
        .delete()
        .eq("domain", targetDomain)
        .select("domain");
      expect(domainDeleteRows ?? []).toEqual([]);
    }

    const { data: adminStillThere } = await admin
      .from("admin_emails")
      .select("email")
      .eq("email", targetAdminEmail)
      .maybeSingle();
    expect(adminStillThere?.email).toBe(targetAdminEmail);

    const { data: domainStillThere } = await admin
      .from("allowed_domains")
      .select("domain")
      .eq("domain", targetDomain)
      .maybeSingle();
    expect(domainStillThere?.domain).toBe(targetDomain);

    await revokeTestAdmin(targetAdminEmail);
    await revokeTestDomain(targetDomain);
  });

  test("admin add/remove flips is_admin() live, is idempotent, and the normalisation check backstops a direct uppercase insert", async () => {
    const dbClient = await signInAsTestUser(dbAdmin);
    const xEmail = testEmail("admin", "x1");

    const { error: insertError } = await dbClient
      .from("admin_emails")
      .insert({ email: xEmail });
    expect(insertError).toBeNull();

    const xClient = await signInAsTestUser(xEmail);
    const { data: isAdminBefore } = await xClient.rpc("is_admin");
    expect(isAdminBefore).toBe(true);

    const { error: deleteError } = await dbClient
      .from("admin_emails")
      .delete()
      .eq("email", xEmail);
    expect(deleteError).toBeNull();

    const { data: isAdminAfter } = await xClient.rpc("is_admin");
    expect(isAdminAfter).toBe(false);

    // Idempotent: deleting the same (already-gone) row again is not an
    // error.
    const { error: secondDeleteError } = await dbClient
      .from("admin_emails")
      .delete()
      .eq("email", xEmail);
    expect(secondDeleteError).toBeNull();

    // Normalisation backstop: a direct, uppercase insert (bypassing the
    // app's own .trim().toLowerCase()) is refused by the DB's own check
    // constraint, not by this trigger.
    const { error: upperError } = await adminClient()
      .from("admin_emails")
      .insert({ email: xEmail.toUpperCase() });
    expect(upperError?.code).toBe("23514");

    await deleteAuthUserByEmail(xEmail);
  });

  test("admin add/remove flips is_email_eligible() live for a domain", async () => {
    const dbClient = await signInAsTestUser(dbAdmin);
    const dDomain = testDomain("d1");
    const probeEmail = `x@${dDomain}`;

    const { error: insertError } = await dbClient
      .from("allowed_domains")
      .insert({ domain: dDomain });
    expect(insertError).toBeNull();

    const { data: eligibleBefore } = await dbClient.rpc(
      "is_email_eligible",
      { p_email: probeEmail }
    );
    expect(eligibleBefore).toBe(true);

    const { error: deleteError } = await dbClient
      .from("allowed_domains")
      .delete()
      .eq("domain", dDomain);
    expect(deleteError).toBeNull();

    const { data: eligibleAfter } = await dbClient.rpc("is_email_eligible", {
      p_email: probeEmail,
    });
    expect(eligibleAfter).toBe(false);
  });

  test("the last admin can never be removed, even by a single statement deleting every row", async () => {
    await withAdminEmailsRestore(async () => {
      const admin = adminClient();
      const { error } = await admin
        .from("admin_emails")
        .delete()
        .neq("email", "");

      expect(error?.code).toBe("23514");
      expect(error?.hint).toBe("last_admin");
    });
  });

  test("a multi-row delete that is NOT the last admins succeeds, real admins remain", async () => {
    const m1 = testEmail("admin", "m1");
    const m2 = testEmail("admin", "m2");
    await grantTestAdmin(m1);
    await grantTestAdmin(m2);

    const dbClient = await signInAsTestUser(dbAdmin);
    const { error } = await dbClient
      .from("admin_emails")
      .delete()
      .in("email", [m1, m2]);
    expect(error).toBeNull();

    const admin = adminClient();
    const { data: rows } = await admin
      .from("admin_emails")
      .select("email")
      .in("email", [m1, m2]);
    expect(rows ?? []).toEqual([]);

    const { data: realAdmins } = await admin
      .from("admin_emails")
      .select("email")
      .in("email", [
        "rhodes.james@gmail.com",
        "james.carrigan@network.rca.ac.uk",
      ]);
    expect((realAdmins ?? []).length).toBe(2);

    await deleteAuthUserByEmail(m1);
    await deleteAuthUserByEmail(m2);
  });
});
