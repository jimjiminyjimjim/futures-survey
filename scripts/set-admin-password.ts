// Operator-only helper: enable admin password sign-in for ONE
// public.admin_emails member, run from the repo root with the service-role
// key from .env.local. Never imported by src/ and never deployed.
//
// It enables admin password sign-in for one admin_emails member by setting
// a generated password and the service-role-only app_metadata flag
// (admin_password_login) that supabase/migrations/20261015001000's hook
// requires before any password grant can issue a session.
//
// Usage: yarn admin:set-password <admin-email>
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  console.error("Missing environment variable: NEXT_PUBLIC_SUPABASE_URL");
  process.exit(1);
}
if (!serviceRoleKey) {
  console.error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const rawInput = (process.argv[2] ?? "").trim().toLowerCase();
const EMAIL_SHAPE = /^[^\s@"]+@[^\s@"]+$/;
if (!rawInput || !EMAIL_SHAPE.test(rawInput)) {
  console.error("usage: yarn admin:set-password <admin-email>");
  process.exit(1);
}
const email = rawInput;

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// FIRST, before any Auth call: refuse any email not already on
// admin_emails, so this script can never be used to grant password
// sign-in to a non-admin.
const { data: adminRow, error: adminRowError } = await supabase
  .from("admin_emails")
  .select("email")
  .eq("email", email)
  .maybeSingle();

if (adminRowError) {
  console.error("failed:", adminRowError.code, adminRowError.message);
  process.exit(1);
}
if (!adminRow) {
  console.error(
    `Refusing: ${email} is not on admin_emails — password sign-in is admin-only. Add the email in the Supabase Table Editor first.`
  );
  process.exit(1);
}

async function findAuthUserByEmail(
  target: string
): Promise<{ id: string; app_metadata: Record<string, unknown> } | null> {
  const perPage = 200;
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      throw error;
    }

    const match = data.users.find(
      (u) => u.email?.toLowerCase() === target.toLowerCase()
    );
    if (match) {
      return { id: match.id, app_metadata: match.app_metadata ?? {} };
    }

    if (data.users.length < perPage) {
      return null;
    }
    page += 1;
  }
}

let existingUser: { id: string; app_metadata: Record<string, unknown> } | null;
try {
  existingUser = await findAuthUserByEmail(email);
} catch (err) {
  const error = err as { code?: string; message?: string };
  console.error("failed:", error.code, error.message);
  process.exit(1);
}

// 32-char random password, never taken from argv so it can never land in
// shell history.
const password = randomBytes(24).toString("base64url");

if (existingUser) {
  const { error } = await supabase.auth.admin.updateUserById(existingUser.id, {
    password,
    email_confirm: true,
    app_metadata: {
      ...existingUser.app_metadata,
      admin_password_login: true,
    },
  });
  if (error) {
    console.error("failed:", error.code, error.message);
    process.exit(1);
  }
  console.log(`Updated existing account for ${email}.`);
} else {
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { admin_password_login: true },
  });
  if (error) {
    console.error("failed:", error.code, error.message);
    process.exit(1);
  }
  console.log(`Created a new account for ${email}.`);
}

console.log(`Password: ${password}`);
console.log(
  "Sign in at /login/admin. This password is shown once — store it in a password manager. Rerun this command to rotate it."
);
