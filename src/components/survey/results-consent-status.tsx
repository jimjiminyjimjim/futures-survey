"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { withdrawResultsConsent } from "@/lib/survey/consent-actions";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

/**
 * Shown wherever an opted-in participant should see their status (the
 * thanks screen, the review screen). `afterWithdraw` controls what happens
 * on a successful withdrawal:
 *  - "refresh": the review screen re-renders with the opt-in checkbox
 *    (router.refresh() re-runs the server component with the new state).
 *  - "message": swap in-place to the withdrawn confirmation text.
 */
export function ResultsConsentStatus({
  afterWithdraw,
}: {
  afterWithdraw: "refresh" | "message";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<"opted-in" | "withdrawn" | "failed">(
    "opted-in"
  );

  function onWithdraw() {
    startTransition(async () => {
      try {
        const result = await withdrawResultsConsent();
        if (!result.ok) {
          setState("failed");
          return;
        }
        if (afterWithdraw === "refresh") {
          router.refresh();
          return;
        }
        setState("withdrawn");
      } catch {
        setState("failed");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border px-4 py-3">
      <p className="text-sm">
        {state === "withdrawn"
          ? SURVEY_MESSAGES.resultsWithdrawn
          : SURVEY_MESSAGES.resultsOptedIn}
      </p>
      {state !== "withdrawn" ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-fit px-4 text-base"
          disabled={isPending}
          onClick={onWithdraw}
        >
          {SURVEY_MESSAGES.resultsWithdraw}
        </Button>
      ) : null}
      {state === "failed" ? (
        <p role="alert" className="text-sm text-destructive">
          {SURVEY_MESSAGES.resultsConsentFailed}
        </p>
      ) : null}
    </div>
  );
}
