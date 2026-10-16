"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { submitResponse } from "@/lib/survey/actions";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

/**
 * The submit control for /survey/review. Never hidden or replaced after a
 * rejection — an incomplete or already-submitted response can be retried
 * (or the participant can go answer what's missing) without the button
 * disappearing. A thrown/aborted network call is caught and shown as the
 * same friendly alert as a server-reported failure.
 */
export function SubmitForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await submitResponse();

        if (result.ok || result.reason === "not-open") {
          router.replace("/");
          return;
        }

        setError(result.error);
      } catch {
        setError(SURVEY_MESSAGES.submitFailed);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="default"
        className="h-11 w-full px-4 text-base"
        disabled={isPending}
        onClick={onSubmit}
      >
        {SURVEY_MESSAGES.submitCta}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
