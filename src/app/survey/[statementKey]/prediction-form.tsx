"use client";

import { useCallback, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import { PREDICTION_MAX, PREDICTION_MIN } from "@/lib/survey/answer-rules";
import {
  KeyboardHint,
  QuestionButtons,
  QuestionError,
  useSaveAndAdvance,
  type QuestionNavProps,
} from "./question-controls";
import { useQuestionKeyboard } from "./use-question-keyboard";

function clampPercent(n: number): number {
  return Math.min(PREDICTION_MAX, Math.max(PREDICTION_MIN, Math.round(n)));
}

/**
 * Optional 0–100 % guess. Untouched (no guess): the primary button reads
 * Skip and advances without saving. Once a guess is entered: Submit saves
 * and advances, and a secondary Skip still moves on without saving.
 */
export function PredictionForm({
  statementId,
  labelledById,
  initialValue,
  prevHref,
  nextHref,
}: QuestionNavProps & {
  labelledById: string;
  initialValue: number | null;
}) {
  const { isPending, error, setError, goPrev, goNext, save } =
    useSaveAndAdvance({ statementId, prevHref, nextHref });

  const [guess, setGuess] = useState<number | null>(initialValue);
  // What the number field shows while typing (may be "" or partial).
  const [text, setText] = useState<string>(
    initialValue != null ? String(initialValue) : ""
  );
  const lastSavedRef = useRef<number | null>(initialValue);

  const setFromNumber = useCallback(
    (n: number) => {
      setError(null);
      const clamped = clampPercent(n);
      setGuess(clamped);
      setText(String(clamped));
    },
    [setError]
  );

  const handlePrimary = useCallback(() => {
    if (isPending) {
      return;
    }
    if (guess == null) {
      goNext();
      return;
    }
    const chosen = guess;
    save(
      { value: chosen },
      () => {
        lastSavedRef.current = chosen;
      },
      () => {
        setGuess(lastSavedRef.current);
        setText(lastSavedRef.current != null ? String(lastSavedRef.current) : "");
      }
    );
  }, [isPending, guess, goNext, save]);

  useQuestionKeyboard({
    isPending,
    onPrimary: handlePrimary,
    onPrev: goPrev,
    onNext: goNext,
  });

  const inputId = `${statementId}-guess`;
  const hintId = `${statementId}-guess-hint`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-lg border px-4 py-4">
        <div className="flex items-center gap-3">
          <label htmlFor={inputId} className="text-base">
            {SURVEY_MESSAGES.predictionInputLabel}
          </label>
          <div className="ml-auto flex items-center gap-1">
            <Input
              id={inputId}
              type="number"
              inputMode="numeric"
              min={PREDICTION_MIN}
              max={PREDICTION_MAX}
              step={1}
              value={text}
              disabled={isPending}
              aria-describedby={hintId}
              className="h-11 w-20 text-right text-base"
              onChange={(event) => {
                const raw = event.target.value;
                setError(null);
                setText(raw);
                if (raw.trim() === "") {
                  setGuess(null);
                  return;
                }
                const n = Number(raw);
                if (Number.isFinite(n)) {
                  setGuess(clampPercent(n));
                }
              }}
              onBlur={() => {
                if (guess != null) {
                  setText(String(guess));
                }
              }}
            />
            <span aria-hidden="true" className="text-base">
              %
            </span>
          </div>
        </div>
        <Slider
          value={guess ?? 50}
          min={PREDICTION_MIN}
          max={PREDICTION_MAX}
          step={1}
          disabled={isPending}
          aria-labelledby={labelledById}
          className={guess == null ? "opacity-50" : undefined}
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
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
      <p id={hintId} className="text-sm text-zinc-600 dark:text-zinc-400">
        {guess == null
          ? `${SURVEY_MESSAGES.predictionUnset} ${SURVEY_MESSAGES.predictionOptional}`
          : SURVEY_MESSAGES.predictionOptional}
      </p>
      <QuestionError error={error} />
      <QuestionButtons
        isPending={isPending}
        onBack={goPrev}
        primaryLabel={guess == null ? SURVEY_MESSAGES.skip : SURVEY_MESSAGES.submit}
        onPrimary={handlePrimary}
        secondary={
          guess == null ? null : { label: SURVEY_MESSAGES.skip, onClick: goNext }
        }
      />
      <KeyboardHint optionCount={null} verb="choose" />
    </div>
  );
}
