import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * Top-right bar for participants (user request 2026-10-15: "a logout button
 * top right for normal users while taking the survey"). Mirrors the admin
 * top bar: signed-in email + Sign out, plus an "Open admin" link for admins.
 */
export function ParticipantHeader({
  email,
  isAdmin = false,
}: {
  email: string | null | undefined;
  isAdmin?: boolean;
}) {
  return (
    <header className="flex w-full items-center justify-end gap-4 border-b bg-background px-4 py-3 text-sm">
      {isAdmin ? (
        <Link
          href="/admin"
          className="font-medium text-muted-foreground hover:text-foreground"
        >
          Open admin
        </Link>
      ) : null}
      {email ? (
        <span className="truncate text-muted-foreground">{email}</span>
      ) : null}
      <SignOutButton />
    </header>
  );
}
