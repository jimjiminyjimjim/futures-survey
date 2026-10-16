"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";

/**
 * "Back to rounds" in the admin top bar (user request 2026-10-15: move the
 * back link into the top menu). Shown on any page below /admin/rounds/;
 * hidden on the rounds list itself.
 */
export function AdminBackLink() {
  const pathname = usePathname();
  if (!pathname?.startsWith("/admin/rounds/")) {
    return <span />;
  }

  return (
    <Link
      href="/admin"
      className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      {ADMIN_MESSAGES.backToRounds}
    </Link>
  );
}
