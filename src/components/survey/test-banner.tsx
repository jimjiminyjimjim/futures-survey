"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { resetMyTestAnswers } from "@/lib/admin/test-actions";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";

/**
 * Deletes the admin's own test response on the draft and goes back to the
 * test start page. Shared by the banner ("Start again") and the test
 * thanks card ("Answer again").
 */
export function TestRestartButton({
  roundId,
  homeHref,
  label,
  variant = "outline",
  className,
}: {
  roundId: string;
  homeHref: string;
  label: string;
  variant?: "outline" | "default";
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function restart() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await resetMyTestAnswers({ roundId });
        if (!result.ok) {
          setError(ADMIN_MESSAGES.testActionFailed);
          return;
        }
        router.replace(homeHref);
        router.refresh();
      } catch {
        setError(ADMIN_MESSAGES.testActionFailed);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        className={className ?? "h-9 px-3 text-sm"}
        disabled={isPending}
        onClick={restart}
      >
        {label}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The strip under the admin header on every test-mode screen: says these
 * are test answers, offers Start again and a way back to the round page.
 */
export function TestBanner({
  roundId,
  homeHref,
}: {
  roundId: string;
  homeHref: string;
}) {
  return (
    <div
      data-slot="test-banner"
      className="border-b border-amber-300 bg-amber-100 px-4 py-3 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-60 text-sm font-medium">
          {ADMIN_MESSAGES.testBanner}
        </p>
        <div className="flex flex-wrap items-start gap-2">
          <TestRestartButton
            roundId={roundId}
            homeHref={homeHref}
            label={ADMIN_MESSAGES.testStartAgainCta}
          />
          <Link
            href={`/admin/rounds/${roundId}`}
            className="inline-flex h-9 items-center rounded-lg border border-amber-400 bg-background px-3 text-sm font-medium text-foreground hover:bg-muted"
          >
            {ADMIN_MESSAGES.testExitCta}
          </Link>
        </div>
      </div>
    </div>
  );
}
