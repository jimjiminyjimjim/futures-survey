import { redirect } from "next/navigation";
import { connection } from "next/server";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { getSignedInUser } from "@/lib/auth/session";
import { AUTH_MESSAGES } from "@/lib/auth/messages";
import { RequestCodeForm } from "@/app/login/request-code-form";

// This route reads cookies() on every request to decide signed-in vs
// signed-out, which alone makes it dynamic under next.config.ts's
// cacheComponents. `instant = false` only opts this segment out of
// Instant Navigation (prefetch); it has no effect on prerendering/caching
// eligibility.
export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await connection(); // avoid cacheComponents speculative-prerender Date.now() error
  const user = await getSignedInUser();

  if (user) {
    redirect("/");
  }

  const { error } = await searchParams;
  const linkExpired = error === "link";

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle role="heading" aria-level={1}>
            Sign in
          </CardTitle>
          <CardDescription>
            Enter your email and we&apos;ll send you a 6-digit code.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {linkExpired ? (
            <p role="alert" className="text-sm text-destructive">
              {AUTH_MESSAGES.linkExpired}
            </p>
          ) : null}
          <RequestCodeForm />
        </CardContent>
      </Card>
    </div>
  );
}
