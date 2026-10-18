"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { saveAnswer } from "@/lib/survey/actions";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

export type QuestionNavProps = {
  statementId: string;
  /** Always a concrete route — the first statement of a section points
   * Back at that section's own break screen (see resolveStatementNav). */
  prevHref: string;
  nextHref: string;
};

/**
 * Shared save/navigate behaviour for every question kind. Choosing an
 * option never saves; only the primary action does (Submit when something
 * is chosen, Next/Skip otherwise). A definitive "already submitted" race
 * calls onSubmittedRace so the form can revert to the last saved answer;
 * a retryable failure keeps the participant's choice on screen.
 */
export function useSaveAndAdvance({
  statementId,
  prevHref,
  nextHref,
}: QuestionNavProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const goPrev = useCallback(() => {
    startTransition(() => {
      router.push(prevHref);
    });
  }, [router, prevHref]);

  const goNext = useCallback(() => {
    startTransition(() => {
      router.push(nextHref);
    });
  }, [router, nextHref]);

  const save = useCallback(
    (
      payload: { value: number } | { choiceValues: number[] },
      onSaved: () => void,
      onSubmittedRace: () => void
    ) => {
      setError(null);
      startTransition(async () => {
        try {
          const result = await saveAnswer({ statementId, ...payload });

          if (result.ok) {
            onSaved();
            router.push(nextHref);
            return;
          }

          if (result.reason === "not-open") {
            router.replace("/");
            return;
          }

          if (result.reason === "submitted") {
            onSubmittedRace();
          }

          setError(result.error);
        } catch {
          setError(SURVEY_MESSAGES.saveFailed);
        }
      });
    },
    [router, statementId, nextHref]
  );

  return { isPending, error, setError, goPrev, goNext, save };
}

export function QuestionError({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }
  return (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );
}

/** Back on the left; optional secondary (e.g. Skip) + primary on the right. */
export function QuestionButtons({
  isPending,
  onBack,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  secondary,
}: {
  isPending: boolean;
  onBack: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  secondary?: { label: string; onClick: () => void } | null;
}) {
  return (
    <div className="flex justify-between gap-4 pt-8">
      <Button
        type="button"
        variant="outline"
        className="h-11 px-4 text-base"
        disabled={isPending}
        onClick={onBack}
      >
        {SURVEY_MESSAGES.back}
      </Button>
      <div className="flex gap-2">
        {secondary ? (
          <Button
            type="button"
            variant="ghost"
            className="h-11 px-4 text-base"
            disabled={isPending}
            onClick={secondary.onClick}
          >
            {secondary.label}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="default"
          className="h-11 px-4 text-base"
          disabled={isPending || primaryDisabled}
          onClick={onPrimary}
        >
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
}

/** The pointer-fine-only keyboard hint line. */
export function KeyboardHint({
  optionCount,
  verb,
  digitRange,
}: {
  /** null hides the digit shortcut part (e.g. prediction). */
  optionCount: number | null;
  verb: "choose" | "tick";
  /** Overrides the "1–n" text, e.g. "0–9" for the rating form. */
  digitRange?: string;
}) {
  return (
    <p className="pointer-coarse:hidden text-sm text-zinc-600 dark:text-zinc-400">
      {optionCount != null ? (
        <>
          {"Press "}
          <Kbd>{digitRange ?? `1–${optionCount}`}</Kbd>
          {` to ${verb}, `}
        </>
      ) : (
        "Press "
      )}
      <Kbd>{"Enter"}</Kbd>
      {" to submit, "}
      <Kbd>{"←"}</Kbd>
      {" "}
      <Kbd>{"→"}</Kbd>
      {" to move between questions"}
    </p>
  );
}
