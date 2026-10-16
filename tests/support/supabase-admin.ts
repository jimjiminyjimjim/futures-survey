import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role test helpers for the hosted (dev == live) Supabase project.
 *
 * Every mutating helper calls `assertTestIdentity()` first so a real admin
 * email or the real network.rca.ac.uk domain can never be touched by a test
 * run, even accidentally.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name} for tests`);
  }
  return value;
}

export const RUN_ID = (
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
).toLowerCase();

const TEST_EMAIL_PATTERN =
  /^e2e-(participant|admin|pw)-[0-9a-z]+@network\.rca\.ac\.uk$/;
// The probe address is ineligible but has a real MX record (hotmail.com — gmail.com
// became an allowed domain on 2026-10-15), so
// GoTrue's address validation passes and only the before_user_created hook
// can reject it.
const PROBE_EMAIL_PATTERN = /^dfs\.e2e\.probe\.[0-9a-z]+@hotmail\.com$/;

export const TEST_DOMAIN_PATTERN = /^e2e-[0-9a-z]+\.invalid$/;

export function assertTestDomain(domain: string): void {
  if (!TEST_DOMAIN_PATTERN.test(domain)) {
    throw new Error(
      `Refusing to operate on a non-test domain in the live project: ${domain}`
    );
  }
}

export function assertTestIdentity(email: string): void {
  if (!TEST_EMAIL_PATTERN.test(email) && !PROBE_EMAIL_PATTERN.test(email)) {
    throw new Error(
      `Refusing to operate on a non-test identity in the live project: ${email}`
    );
  }
}

const VARIANT_PATTERN = /^[a-z0-9]{1,8}$/;

export function testEmail(
  kind: "participant" | "admin" | "pw" | "probe",
  variant?: string
): string {
  if (variant !== undefined && !VARIANT_PATTERN.test(variant)) {
    throw new Error(
      `Invalid testEmail variant "${variant}" — must match ${VARIANT_PATTERN}`
    );
  }

  if (kind === "probe") {
    return `dfs.e2e.probe.${RUN_ID}${variant ?? ""}@hotmail.com`;
  }
  return `e2e-${kind}-${RUN_ID}${variant ?? ""}@network.rca.ac.uk`;
}

export function testDomain(variant?: string): string {
  if (variant !== undefined && !VARIANT_PATTERN.test(variant)) {
    throw new Error(
      `Invalid testDomain variant "${variant}" — must match ${VARIANT_PATTERN}`
    );
  }
  return `e2e-${RUN_ID}${variant ?? ""}.invalid`;
}

export function adminClient() {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function issueEmailOtp(email: string): Promise<string> {
  assertTestIdentity(email);
  const client = adminClient();

  const { data, error } = await client.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error || !data?.properties?.email_otp) {
    throw new Error(
      `Failed to issue an OTP for ${email}: ${error?.message ?? "no email_otp in response"}`
    );
  }

  return data.properties.email_otp;
}

export async function grantTestAdmin(email: string): Promise<void> {
  assertTestIdentity(email);
  const client = adminClient();

  const { error } = await client
    .from("admin_emails")
    .insert({ email })
    .select();

  if (error) {
    throw error;
  }
}

export async function revokeTestAdmin(email: string): Promise<void> {
  assertTestIdentity(email);
  const client = adminClient();

  const { error } = await client
    .from("admin_emails")
    .delete()
    .eq("email", email);

  if (error) {
    throw error;
  }
}

export async function revokeTestDomain(domain: string): Promise<void> {
  assertTestDomain(domain);
  const client = adminClient();

  const { error } = await client
    .from("allowed_domains")
    .delete()
    .eq("domain", domain);

  if (error) {
    throw error;
  }
}

/**
 * Service-role snapshot of both access lists, sorted so two snapshots of
 * the same content always compare equal regardless of insert order.
 */
export async function snapshotAccessLists(): Promise<string> {
  const client = adminClient();

  const [adminResult, domainResult] = await Promise.all([
    client.from("admin_emails").select("email"),
    client.from("allowed_domains").select("domain"),
  ]);
  if (adminResult.error) {
    throw adminResult.error;
  }
  if (domainResult.error) {
    throw domainResult.error;
  }

  const adminEmails = (adminResult.data ?? [])
    .map((row) => row.email as string)
    .sort();
  const domains = (domainResult.data ?? [])
    .map((row) => row.domain as string)
    .sort();

  return JSON.stringify({ adminEmails, domains });
}

/**
 * Runs `fn`, then restores admin_emails to its pre-`fn` row set no matter
 * what `fn` did (including the single atomic last-admin probe, which the
 * database must have refused). Used for the one test that deliberately
 * attempts to delete every admin_emails row in one statement — the only
 * place in this phase's tests that gets near the real admin rows.
 */
export async function withAdminEmailsRestore(
  fn: () => Promise<void>
): Promise<void> {
  const client = adminClient();

  const { data: snapshotRows, error: snapshotError } = await client
    .from("admin_emails")
    .select("email, created_at");
  if (snapshotError) {
    throw snapshotError;
  }
  const snapshot = (snapshotRows ?? []) as {
    email: string;
    created_at: string;
  }[];

  try {
    await fn();
  } finally {
    const { data: currentRows, error: currentError } = await client
      .from("admin_emails")
      .select("email");
    if (currentError) {
      throw currentError;
    }
    const currentEmails = new Set(
      (currentRows ?? []).map((row) => row.email as string)
    );
    const missing = snapshot.filter((row) => !currentEmails.has(row.email));
    if (missing.length > 0) {
      const { error: upsertError } = await client
        .from("admin_emails")
        .upsert(missing, { onConflict: "email", ignoreDuplicates: true });
      if (upsertError) {
        throw upsertError;
      }
    }

    const nonTest = (email: string) =>
      !TEST_EMAIL_PATTERN.test(email) && !PROBE_EMAIL_PATTERN.test(email);

    const { data: finalRows, error: finalError } = await client
      .from("admin_emails")
      .select("email");
    if (finalError) {
      throw finalError;
    }
    const finalNonTestEmails = (finalRows ?? [])
      .map((row) => row.email as string)
      .filter(nonTest)
      .sort();
    const snapshotNonTestEmails = snapshot
      .map((row) => row.email)
      .filter(nonTest)
      .sort();

    const unchanged =
      finalNonTestEmails.length === snapshotNonTestEmails.length &&
      finalNonTestEmails.every(
        (email, index) => email === snapshotNonTestEmails[index]
      );
    if (!unchanged) {
      throw new Error(
        "withAdminEmailsRestore: real admin emails changed after restore"
      );
    }
  }
}

async function findAuthUserByEmail(
  email: string
): Promise<{ id: string } | null> {
  const client = adminClient();
  const perPage = 200;
  let page = 1;

  while (true) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      throw error;
    }

    const match = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );
    if (match) {
      return { id: match.id };
    }

    if (data.users.length < perPage) {
      return null;
    }
    page += 1;
  }
}

export async function authUserIdByEmail(
  email: string
): Promise<string | null> {
  assertTestIdentity(email);
  const match = await findAuthUserByEmail(email);
  return match?.id ?? null;
}

export async function deleteAuthUserByEmail(email: string): Promise<void> {
  assertTestIdentity(email);
  const client = adminClient();

  const match = await findAuthUserByEmail(email);
  if (!match) {
    return;
  }

  const { error } = await client.auth.admin.deleteUser(match.id);
  if (error) {
    throw error;
  }
}

export async function countAuthUsersByEmail(email: string): Promise<number> {
  assertTestIdentity(email);
  const client = adminClient();
  const perPage = 200;
  let page = 1;
  let count = 0;

  while (true) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      throw error;
    }

    count += data.users.filter(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    ).length;

    if (data.users.length < perPage) {
      return count;
    }
    page += 1;
  }
}

export async function sweepStaleTestData(): Promise<void> {
  const client = adminClient();

  const { data: adminRows, error: adminError } = await client
    .from("admin_emails")
    .select("email");
  if (adminError) {
    throw adminError;
  }
  for (const row of adminRows ?? []) {
    const email = row.email as string;
    if (TEST_EMAIL_PATTERN.test(email) || PROBE_EMAIL_PATTERN.test(email)) {
      await revokeTestAdmin(email);
    }
  }

  const { data: domainRows, error: domainError } = await client
    .from("allowed_domains")
    .select("domain");
  if (domainError) {
    throw domainError;
  }
  for (const row of domainRows ?? []) {
    const domain = row.domain as string;
    if (TEST_DOMAIN_PATTERN.test(domain)) {
      await revokeTestDomain(domain);
    }
  }

  const perPage = 200;
  let page = 1;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      throw error;
    }

    for (const user of data.users) {
      const email = user.email;
      if (
        email &&
        (TEST_EMAIL_PATTERN.test(email) || PROBE_EMAIL_PATTERN.test(email))
      ) {
        await client.auth.admin.deleteUser(user.id);
      }
    }

    if (data.users.length < perPage) {
      break;
    }
    page += 1;
  }

  // Stale e2e rounds created directly (test-fixture rounds, never Round 1):
  // title starts with "e2e-" AND round_number >= 900000 — both conditions
  // are required so a real round can never be matched by accident.
  const { data: staleRounds, error: staleRoundsError } = await client
    .from("rounds")
    .select("id, title, round_number")
    .gte("round_number", 900000)
    .like("title", "e2e-%");
  if (staleRoundsError) {
    throw staleRoundsError;
  }
  for (const round of staleRounds ?? []) {
    const roundId = round.id as string;
    const { error: deleteAnswersError } = await client
      .from("answers")
      .delete()
      .eq("round_id", roundId);
    if (deleteAnswersError) {
      throw deleteAnswersError;
    }
    const { error: deleteResponsesError } = await client
      .from("responses")
      .delete()
      .eq("round_id", roundId);
    if (deleteResponsesError) {
      throw deleteResponsesError;
    }
    const { error: deleteRoundError } = await client
      .from("rounds")
      .delete()
      .eq("id", roundId);
    if (deleteRoundError) {
      throw deleteRoundError;
    }
  }
}

export async function signInAsTestUser(email: string) {
  assertTestIdentity(email);
  const token = await issueEmailOtp(email);

  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  const client = createSupabaseClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) {
    throw error;
  }

  return client;
}
