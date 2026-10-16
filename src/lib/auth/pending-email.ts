import "server-only";
import { cookies } from "next/headers";

/**
 * Holds the email a visitor just requested a code for, between
 * requestCode() redirecting to /login/code and verifyCode() reading it back.
 * Never put the email in a URL/query string — AUTH-01 privacy requirement.
 */
export const PENDING_EMAIL_COOKIE = "dfs_pending_email";

export async function setPendingEmail(email: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(PENDING_EMAIL_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/login",
    maxAge: 900,
  });
}

export async function readPendingEmail(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(PENDING_EMAIL_COOKIE)?.value ?? null;
}

export async function clearPendingEmail(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete({ name: PENDING_EMAIL_COOKIE, path: "/login" });
}
