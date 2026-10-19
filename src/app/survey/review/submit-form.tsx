"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { submitResponse } from "@/lib/survey/actions";
import { optInToResults, withdrawResultsConsent } from "@/lib/survey/consent-actions";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

const OPT_IN_LABEL_ID = "results-opt-in-label";
const OPT_IN_HELP_ID = "results-opt-in-help";
const CONSENT_STATEMENT_ID = "results-consent-statement";

/**
 * The submit control for /survey/review. Never hidden or replaced after a
 * rejection — an incomplete or already-submitted response can be retried
 * (or the participant can go answer what's missing) without the button
 * disappearing. A thrown/aborted network call is caught and shown as the
 * same friendly alert as a server-reported failure.
 *
 * When `offerOptIn` is set (2026-10-19 two-button behaviour), the consent
 * statement is shown with two equal-weight buttons below it: "Submit and
 * save my responses for graduation" opts in (optInToResults) and then
 * submits; "Submit and do not save my responses" submits with no consent,
 * withdrawing any opt-in made on THIS screen first (so a retry after an
 * incomplete-submit rejection never leaves a recorded opt-in that
 * contradicts the button actually pressed). When offerOptIn is false (the
 * participant already opted in earlier), the single "Submit answers"
 * button is unchanged and never opts in.
 */
export function SubmitForm({ offerOptIn }: { offerOptIn: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // True only once optInToResults has succeeded during THIS page visit —
  // not persisted state, just enough to know whether "do not save" must
  // withdraw it before submitting.
  const [optedInHere, setOptedInHere] = useState(false);

  function submitWith(save: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        if (save) {
          const consentResult = await optInToResults();
          if (!consentResult.ok) {
            setError(SURVEY_MESSAGES.resultsConsentFailed);
            return;
          }
          setOptedInHere(true);
        } else if (optedInHere) {
          const withdrawResult = await withdrawResultsConsent();
          if (!withdrawResult.ok) {
            setError(SURVEY_MESSAGES.resultsConsentFailed);
            return;
          }
          setOptedInHere(false);
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
        <>
          <div
            id={CONSENT_STATEMENT_ID}
            className="flex flex-col gap-1 rounded-xl border-2 border-primary bg-primary/5 p-5"
          >
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
          <Button
            type="button"
            variant="default"
            className="h-auto min-h-11 w-full px-4 py-2.5 text-base whitespace-normal"
            disabled={isPending}
            aria-describedby={CONSENT_STATEMENT_ID}
            onClick={() => submitWith(true)}
          >
            {SURVEY_MESSAGES.submitAndSaveCta}
          </Button>
          <Button
            type="button"
            variant="default"
            className="h-auto min-h-11 w-full px-4 py-2.5 text-base whitespace-normal"
            disabled={isPending}
            onClick={() => submitWith(false)}
          >
            {SURVEY_MESSAGES.submitWithoutSavingCta}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="default"
          className="h-11 w-full px-4 text-base"
          disabled={isPending}
          onClick={() => submitWith(false)}
        >
          {SURVEY_MESSAGES.submitCta}
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
