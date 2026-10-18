"use client";

import { useCallback, useRef, useState } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import type { ChoiceOption } from "@/lib/survey/answer-rules";
import {
  KeyboardHint,
  QuestionButtons,
  QuestionError,
  useSaveAndAdvance,
  type QuestionNavProps,
} from "./question-controls";
import { useQuestionKeyboard } from "./use-question-keyboard";

/**
 * Single-answer questions: `scale` (the section scale's Likert options) and
 * `choice_one` (the statement's own options). Choosing only updates local
 * selection; the primary button reads Submit when something is chosen
 * (saves, then advances) and Next otherwise (advances without saving).
 */
export function StatementForm({
  statementId,
  labelledById,
  options,
  initialValue,
  prevHref,
  nextHref,
}: QuestionNavProps & {
  labelledById: string;
  options: ChoiceOption[];
  initialValue: number | null;
}) {
  const { isPending, error, setError, goPrev, goNext, save } =
    useSaveAndAdvance({ statementId, prevHref, nextHref });

  // Always a defined string (never undefined) so RadioGroup stays
  // controlled for the component's entire lifetime — switching between
  // controlled and uncontrolled left base-ui's internal selection stuck on
  // the last choice instead of clearing it. "" is not a valid option
  // value, so it renders as "nothing selected."
  const initialValueStr = initialValue != null ? String(initialValue) : "";
  const [value, setValue] = useState<string>(initialValueStr);
  // The most recently confirmed-saved value; restored only on the
  // definitive "already submitted" race.
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
      if (n >= 1 && n <= options.length) {
        selectOption(String(options[n - 1].value));
      }
    },
    [options, selectOption]
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
      <RadioGroup
        value={value}
        onValueChange={(next) => selectOption(String(next))}
        aria-labelledby={labelledById}
        disabled={isPending}
      >
        {options.map((option) => {
          const optionLabelId = `${statementId}-option-${option.value}`;
          return (
            <label
              key={option.value}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg border px-4 py-2 text-base break-words has-data-checked:border-primary has-data-checked:ring-1 has-data-checked:ring-primary"
            >
              <RadioGroupItem
                value={String(option.value)}
                aria-labelledby={optionLabelId}
              />
              <span id={optionLabelId} className="break-words">
                {option.label}
              </span>
            </label>
          );
        })}
      </RadioGroup>
      <QuestionError error={error} />
      <QuestionButtons
        isPending={isPending}
        onBack={goPrev}
        primaryLabel={value === "" ? SURVEY_MESSAGES.next : SURVEY_MESSAGES.submit}
        onPrimary={handlePrimary}
      />
      <KeyboardHint optionCount={options.length} verb="choose" />
    </div>
  );
}
