import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * Top-right bar for participants (user request 2026-10-15: "a logout button
 * top right for normal users while taking the survey"). Mirrors the admin
 * top bar: signed-in email + Sign out, plus an "Open admin" link for admins.
 *
 * `variant="floating"` drops the bar chrome (border, full-width background)
 * for pages with their own full-bleed background (the black /survey
 * screens): it fixes the same controls to the top-right corner instead, so
 * there's still a way to see who's signed in and sign out without a visible
 * menu bar.
 */
export function ParticipantHeader({
  email,
  isAdmin = false,
  variant = "bar",
}: {
  email: string | null | undefined;
  isAdmin?: boolean;
  variant?: "bar" | "floating";
}) {
  return (
    <header
      className={
        variant === "floating"
          ? "fixed top-4 right-4 z-10 flex items-center gap-4 text-sm"
          : "flex w-full items-center justify-end gap-4 border-b bg-background px-4 py-3 text-sm"
      }
    >
      {isAdmin ? (
        <Link
          href="/admin"
          className={
            variant === "floating"
              ? "font-medium text-zinc-400 hover:text-white"
              : "font-medium text-muted-foreground hover:text-foreground"
          }
        >
          Open admin
        </Link>
      ) : null}
      {email ? (
        <span
          className={
            variant === "floating"
              ? "truncate text-zinc-400"
              : "truncate text-muted-foreground"
          }
        >
          {email}
        </span>
      ) : null}
      <SignOutButton />
    </header>
  );
}
