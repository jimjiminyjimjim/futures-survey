import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSignedInUser, isCurrentUserAdmin } from "@/lib/auth/session";
import { SignOutButton } from "@/components/sign-out-button";
import { AdminBackLink } from "@/components/admin/admin-back-link";

// This layout reads cookies() (via getSignedInUser()) on every request,
// which alone makes it dynamic under next.config.ts's cacheComponents --
// no extra opt-out is needed for that. `instant = false` only opts this
// segment out of Instant Navigation (prefetch); it has no effect on
// prerendering/caching eligibility.
export const instant = false;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Opt the whole /admin subtree out of cacheComponents' speculative
  // prerender: the Supabase auth chain reads Date.now(), which Next.js 16
  // rejects while prerendering ("Blocking Route"). Same fix as the survey pages.
  await connection();
  const user = await getSignedInUser();
  if (!user) {
    redirect("/login");
  }

  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) {
    redirect("/");
  }

  return (
    <>
      <header className="flex items-center justify-between gap-4 border-b bg-background px-4 py-3 text-sm">
        <AdminBackLink />
        <div className="flex items-center gap-4">
          <span className="truncate text-muted-foreground">{user.email}</span>
          <SignOutButton />
        </div>
      </header>
      {children}
    </>
  );
}
