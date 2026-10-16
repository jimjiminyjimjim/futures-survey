"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AuthFormState } from "@/lib/auth/actions";

// Admin-only password sign-in, deliberately separate from
// src/lib/auth/actions.ts (OTP) and src/lib/auth/messages.ts (which belongs
// to the OTP flow). Keep messages module-private: a "use server" file may
// only export async functions.
const ADMIN_PASSWORD_MESSAGES = {
  invalid: "Enter your email address and password.",
  rejected: "That email and password didn't work.",
  rateLimited: "Too many sign-in attempts. Wait a few minutes, then try again.",
} as const;

const EmailSchema = z.email();
const PasswordSchema = z.string().min(1).max(256);

export async function signInWithAdminPassword(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const rawEmail = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  // Do NOT trim the password — whitespace may be a deliberate part of it.
  const rawPassword = String(formData.get("password") ?? "");

  const emailParsed = EmailSchema.safeParse(rawEmail);
  const passwordParsed = PasswordSchema.safeParse(rawPassword);
  if (!emailParsed.success || !passwordParsed.success) {
    return { error: ADMIN_PASSWORD_MESSAGES.invalid };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: emailParsed.data,
    password: passwordParsed.data,
  });

  if (error) {
    const status = (error as { status?: number }).status;
    // Log only status and message, never the email, password or any form
    // value — this path is a security gate, not a diagnostic oracle.
    console.error("admin sign-in failed:", { status, message: error.message });
    if (status === 429) {
      return { error: ADMIN_PASSWORD_MESSAGES.rateLimited };
    }
    // Every other failure (wrong password, no password set, the hook's 403
    // refusal, an unconfirmed email, network errors) gets the same generic
    // message, so this page is never an admin-or-account oracle.
    return { error: ADMIN_PASSWORD_MESSAGES.rejected };
  }

  redirect("/admin");
}
