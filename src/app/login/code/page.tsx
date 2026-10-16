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
import { readPendingEmail } from "@/lib/auth/pending-email";
import { VerifyCodeForm } from "@/app/login/code/verify-code-form";

// This route reads cookies() on every request to decide signed-in state
// and whether a pending-email cookie exists, which alone makes it dynamic
// under next.config.ts's cacheComponents. `instant = false` only opts this
// segment out of Instant Navigation (prefetch); it has no effect on
// prerendering/caching eligibility.
export const instant = false;

export default async function VerifyCodePage() {
  await connection(); // avoid cacheComponents speculative-prerender Date.now() error
  const user = await getSignedInUser();
  if (user) {
    redirect("/");
  }

  const email = await readPendingEmail();
  if (!email) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle role="heading" aria-level={1}>
            Check your email
          </CardTitle>
          <CardDescription>
            We sent a 6-digit code to {email}. Enter it below, or click the
            sign-in link in the same email.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <VerifyCodeForm />
          <Link
            href="/login"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Use a different email
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
