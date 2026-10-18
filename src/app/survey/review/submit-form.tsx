"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { submitResponse } from "@/lib/survey/actions";
import { optInToResults } from "@/lib/survey/consent-actions";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

const OPT_IN_LABEL_ID = "results-opt-in-label";
const OPT_IN_HELP_ID = "results-opt-in-help";

/**
 * The submit control for /survey/review. Never hidden or replaced after a
 * rejection — an incomplete or already-submitted response can be retried
 * (or the participant can go answer what's missing) without the button
 * disappearing. A thrown/aborted network call is caught and shown as the
 * same friendly alert as a server-reported failure.
 *
 * When `offerOptIn` is set, a large, unticked-by-default opt-in checkbox
 * is shown above the submit button. Submitting works whether or not it's
 * ticked. If ticked, optInToResults() runs first — on failure, the
 * participant can retry or untick and submit anyway.
 */
export function SubmitForm({ offerOptIn }: { offerOptIn: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optedIn, setOptedIn] = useState(false);

  function onSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        if (optedIn) {
          const consentResult = await optInToResults();
          if (!consentResult.ok) {
            setError(SURVEY_MESSAGES.resultsConsentFailed);
            return;
          }
        }

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
    <div className="flex flex-col gap-4">
      {offerOptIn ? (
        <label className="has-data-checked:bg-primary/10 flex items-start gap-4 rounded-xl border-2 border-primary bg-primary/5 p-5">
          <Checkbox
            checked={optedIn}
            disabled={isPending}
            onCheckedChange={(checked) => setOptedIn(checked === true)}
            className="mt-0.5 size-6 [&_svg]:size-4"
            aria-labelledby={OPT_IN_LABEL_ID}
            aria-describedby={OPT_IN_HELP_ID}
          />
          <div className="flex flex-col gap-1">
            <span id={OPT_IN_LABEL_ID} className="text-lg font-semibold">
              {SURVEY_MESSAGES.resultsOptInLabel}
            </span>
            <span
              id={OPT_IN_HELP_ID}
              className="text-base text-zinc-600 dark:text-zinc-400"
            >
              {SURVEY_MESSAGES.resultsOptInHelp}
            </span>
          </div>
        </label>
      ) : null}
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
