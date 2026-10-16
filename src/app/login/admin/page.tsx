import { redirect } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { getSignedInUser } from "@/lib/auth/session";
import { AdminPasswordForm } from "@/app/login/admin/admin-password-form";

// This route reads cookies() on every request to decide signed-in vs
// signed-out, which alone makes it dynamic under next.config.ts's
// cacheComponents. `instant = false` only opts this segment out of
// Instant Navigation (prefetch); it has no effect on prerendering/caching
// eligibility.
export const instant = false;

export default async function AdminLoginPage() {
  await connection(); // avoid cacheComponents speculative-prerender Date.now() error
  const user = await getSignedInUser();

  if (user) {
    // The admin layout sends non-admins on to "/", so this redirect is
    // correct for both admins and non-admins who are already signed in.
    redirect("/admin");
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle role="heading" aria-level={1}>
            Admin sign in
          </CardTitle>
          <CardDescription>
            For survey admins only. Participants sign in with an emailed
            code.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AdminPasswordForm />
          <Link
            href="/login"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            Sign in with an emailed code instead
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
