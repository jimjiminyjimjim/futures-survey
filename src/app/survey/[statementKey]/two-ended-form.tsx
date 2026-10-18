"use client";

import { useCallback, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import { TWO_ENDED_MAX, TWO_ENDED_MIN } from "@/lib/survey/answer-rules";
import {
  KeyboardHint,
  QuestionButtons,
  QuestionError,
  useSaveAndAdvance,
  type QuestionNavProps,
} from "./question-controls";
import { useQuestionKeyboard } from "./use-question-keyboard";

function clampValue(n: number): number {
  return Math.min(TWO_ENDED_MAX, Math.max(TWO_ENDED_MIN, Math.round(n)));
}

/**
 * The `two_ended` question kind: a slider between two labelled ends,
 * stored as 0–100. Required (unlike prediction) — untouched shows Next
 * (advances without saving), moved shows Submit.
 */
export function TwoEndedForm({
  statementId,
  labelledById,
  leftLabel,
  rightLabel,
  initialValue,
  prevHref,
  nextHref,
}: QuestionNavProps & {
  labelledById: string;
  leftLabel: string;
  rightLabel: string;
  initialValue: number | null;
}) {
  const { isPending, error, setError, goPrev, goNext, save } =
    useSaveAndAdvance({ statementId, prevHref, nextHref });

  const [value, setValue] = useState<number | null>(initialValue);
  const lastSavedRef = useRef<number | null>(initialValue);

  const setFromNumber = useCallback(
    (n: number) => {
      setError(null);
      setValue(clampValue(n));
    },
    [setError]
  );

  const handlePrimary = useCallback(() => {
    if (isPending) {
      return;
    }
    if (value == null) {
      goNext();
      return;
    }
    const chosen = value;
    save(
      { value: chosen },
      () => {
        lastSavedRef.current = chosen;
      },
      () => setValue(lastSavedRef.current)
    );
  }, [isPending, value, goNext, save]);

  useQuestionKeyboard({
    isPending,
    onPrimary: handlePrimary,
    onPrev: goPrev,
    onNext: goNext,
  });

  const hintId = `${statementId}-two-ended-hint`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-lg border px-4 py-4">
        <Slider
          value={value ?? 50}
          min={TWO_ENDED_MIN}
          max={TWO_ENDED_MAX}
          step={1}
          disabled={isPending}
          aria-labelledby={labelledById}
          aria-describedby={hintId}
          className={value == null ? "opacity-50" : undefined}
          onValueChange={(next) => {
            const n = Array.isArray(next) ? next[0] : next;
            if (typeof n === "number") {
              setFromNumber(n);
            }
          }}
        />
        <div
          aria-hidden="true"
          className="flex justify-between text-sm text-zinc-600 dark:text-zinc-400"
        >
          <span className="max-w-[45%] break-words">{leftLabel}</span>
          <span className="max-w-[45%] break-words text-right">{rightLabel}</span>
        </div>
      </div>
      {value == null ? (
        <p id={hintId} className="text-sm text-zinc-600 dark:text-zinc-400">
          {SURVEY_MESSAGES.twoEndedUnset}
        </p>
      ) : (
        <span id={hintId} className="sr-only">
          {SURVEY_MESSAGES.twoEndedUnset}
        </span>
      )}
      <QuestionError error={error} />
      <QuestionButtons
        isPending={isPending}
        onBack={goPrev}
        primaryLabel={value == null ? SURVEY_MESSAGES.next : SURVEY_MESSAGES.submit}
        onPrimary={handlePrimary}
      />
      <KeyboardHint optionCount={null} verb="choose" />
    </div>
  );
}
