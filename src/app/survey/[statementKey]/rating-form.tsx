"use client";

import { useCallback, useRef, useState } from "react";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import {
  KeyboardHint,
  QuestionButtons,
  QuestionError,
  useSaveAndAdvance,
  type QuestionNavProps,
} from "./question-controls";
import { useQuestionKeyboard } from "./use-question-keyboard";
import { RatingScale } from "./rating-scale";

/**
 * The `rating` question kind: an 11-point 0–10 selector with end labels.
 * Same Submit/Next semantics as StatementForm — choosing only updates
 * local selection, and the primary button saves + advances only once
 * something is chosen.
 */
export function RatingForm({
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

  // Always a defined string (never undefined) so RadioGroup stays
  // controlled for the component's entire lifetime (same reasoning as
  // StatementForm). "" means no selection; "0" is itself a valid value.
  const initialValueStr = initialValue != null ? String(initialValue) : "";
  const [value, setValue] = useState<string>(initialValueStr);
  const lastSavedValueRef = useRef<string>(initialValueStr);

  const selectOption = useCallback(
    (next: string) => {
      setError(null);
      setValue(next);
    },
    [setError]
  );

  const handlePrimary = useCallback(() => {
    if (isPending) {
      return;
    }
    if (value === "") {
      goNext();
      return;
    }
    const chosen = value;
    save(
      { value: Number(chosen) },
      () => {
        lastSavedValueRef.current = chosen;
      },
      () => setValue(lastSavedValueRef.current)
    );
  }, [isPending, value, goNext, save]);

  const onDigit = useCallback(
    (n: number) => {
      if (n >= 0 && n <= 10) {
        selectOption(String(n));
      }
    },
    [selectOption]
  );

  useQuestionKeyboard({
    isPending,
    onPrimary: handlePrimary,
    onDigit,
    onPrev: goPrev,
    onNext: goNext,
  });

  return (
    <div className="flex flex-col gap-4">
      <RatingScale
        value={value}
        onValueChange={(next) => selectOption(next)}
        labelledById={labelledById}
        disabled={isPending}
        leftLabel={leftLabel}
        rightLabel={rightLabel}
      />
      <QuestionError error={error} />
      <QuestionButtons
        isPending={isPending}
        onBack={goPrev}
        primaryLabel={value === "" ? SURVEY_MESSAGES.next : SURVEY_MESSAGES.submit}
        onPrimary={handlePrimary}
      />
      <KeyboardHint optionCount={11} verb="choose" digitRange="0–9" />
    </div>
  );
}
