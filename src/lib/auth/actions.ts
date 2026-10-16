"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { AUTH_MESSAGES } from "@/lib/auth/messages";
import {
  setPendingEmail,
  readPendingEmail,
  clearPendingEmail,
} from "@/lib/auth/pending-email";

export type AuthFormState = { error: string | null };

const EmailSchema = z.email();
const CodeSchema = z.string().regex(/^\d{6}$/);

// Derives the origin for the email-link redirect from the inbound request
// headers (works behind Vercel/any reverse proxy), falling back to
// NEXT_PUBLIC_SITE_URL when the headers aren't trustworthy (e.g. local
// tooling that omits x-forwarded-proto).
async function siteOrigin(): Promise<string> {
  const fallback = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  const headerStore = await headers();
  const host = headerStore.get("host");
  if (!host) {
    if (fallback) {
      return fallback;
    }
    throw new Error(
      "Could not determine site origin: no host header and NEXT_PUBLIC_SITE_URL is unset"
    );
  }
  const proto = headerStore.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function requestCode(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const rawEmail = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  const parsed = EmailSchema.safeParse(rawEmail);
  if (!parsed.success) {
    return { error: AUTH_MESSAGES.invalidEmail };
  }
  const email = parsed.data;

  const supabase = await createClient();

  // Layer 1 (UX, fast fail): check eligibility before calling Supabase Auth
  // at all. Layer 2 (authoritative) is the before_user_created DB hook,
  // which re-checks the same public.is_email_eligible function and cannot
  // be bypassed by calling Supabase directly.
  const { data: eligible, error: eligibleError } = await supabase.rpc(
    "is_email_eligible",
    { p_email: email }
  );
  if (eligibleError) {
    // Log the failure for diagnosis; never log the email or any secret.
    console.error("is_email_eligible RPC failed:", eligibleError.message);
    return { error: AUTH_MESSAGES.sendFailed };
  }
  if (eligible !== true) {
    return { error: AUTH_MESSAGES.ineligible };
  }

  // One success path for every eligible caller: no admin-specific branch,
  // wording, or redirect (AUTH-02 prohibition — no eligibility oracle).
  const origin = await siteOrigin();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${origin}/auth/confirm`,
    },
  });

  if (error) {
    const status = (error as { status?: number }).status;
    if (status === 429) {
      return { error: AUTH_MESSAGES.rateLimited };
    }
    if (status === 403) {
      return { error: AUTH_MESSAGES.ineligible };
    }
    return { error: AUTH_MESSAGES.sendFailed };
  }

  await setPendingEmail(email);
  redirect("/login/code");
}

export async function verifyCode(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const rawCode = String(formData.get("code") ?? "").trim();

  const parsedCode = CodeSchema.safeParse(rawCode);
  if (!parsedCode.success) {
    return { error: AUTH_MESSAGES.invalidCodeFormat };
  }

  const email = await readPendingEmail();
  if (!email) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token: parsedCode.data,
    type: "email",
  });

  if (error) {
    const status = (error as { status?: number }).status;
    // Log the failure for diagnosis; never log the OTP code itself.
    console.error("verifyOtp failed:", { status, message: error.message });
    if (status === 429) {
      return { error: AUTH_MESSAGES.rateLimited };
    }
    return { error: AUTH_MESSAGES.codeRejected };
  }

  await clearPendingEmail();
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
