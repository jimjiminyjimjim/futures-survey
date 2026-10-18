"use client";

import { useCallback, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import {
  toggleExactChoice,
  toggleMultiChoice,
  toggleUpToChoice,
  type ChoiceOption,
} from "@/lib/survey/answer-rules";
import {
  KeyboardHint,
  QuestionButtons,
  QuestionError,
  useSaveAndAdvance,
  type QuestionNavProps,
} from "./question-controls";
import { useQuestionKeyboard } from "./use-question-keyboard";

/**
 * Checkbox questions:
 *  - choice_multi: pick all that apply; an exclusive option ("None of
 *    these") clears every other pick, and picking another clears it.
 *  - choice_exact: pick exactly `choiceCount`; unchecked boxes disable once
 *    that many are chosen, and Submit is enabled only at exactly that many.
 *  - choice_up_to: pick 1..choiceCount; unticked NON-exclusive boxes
 *    disable once the limit is reached (the exclusive option, if any,
 *    stays enabled since picking it replaces everything).
 * Nothing chosen: the primary button reads Next and advances without
 * saving (same semantics as the single-choice form).
 */
export function MultiChoiceForm({
  statementId,
  labelledById,
  mode,
  options,
  choiceCount,
  initialValues,
  prevHref,
  nextHref,
}: QuestionNavProps & {
  labelledById: string;
  mode: "multi" | "exact" | "upTo";
  options: ChoiceOption[];
  /** exact / upTo modes only. */
  choiceCount: number | null;
  initialValues: number[] | null;
}) {
  const { isPending, error, setError, goPrev, goNext, save } =
    useSaveAndAdvance({ statementId, prevHref, nextHref });

  const required = mode === "exact" ? (choiceCount ?? 0) : null;
  const upToMax = mode === "upTo" ? (choiceCount ?? 0) : null;
  const [picked, setPicked] = useState<number[]>(initialValues ?? []);
  const lastSavedRef = useRef<number[]>(initialValues ?? []);

  const toggle = useCallback(
    (value: number) => {
      setError(null);
      setPicked((current) => {
        if (mode === "exact") {
          return toggleExactChoice(current, value, required ?? 0);
        }
        if (mode === "upTo") {
          return toggleUpToChoice(options, current, value, upToMax ?? 0);
        }
        return toggleMultiChoice(options, current, value);
      });
    },
    [mode, options, required, upToMax, setError]
  );

  const isComplete =
    picked.length > 0 &&
    (required == null || picked.length === required) &&
    (upToMax == null || picked.length <= upToMax);

  const handlePrimary = useCallback(() => {
    if (isPending) {
      return;
    }
    if (picked.length === 0) {
      goNext();
      return;
    }
    if (!isComplete) {
      // choice_exact with too few picks: Submit is disabled; the hint
      // below already says how many more are needed.
      return;
    }
    const chosen = [...picked];
    save(
      { choiceValues: chosen },
      () => {
        lastSavedRef.current = chosen;
      },
      () => setPicked(lastSavedRef.current)
    );
  }, [isPending, picked, isComplete, goNext, save]);

  const onDigit = useCallback(
    (n: number) => {
      if (n >= 1 && n <= options.length) {
        toggle(options[n - 1].value);
      }
    },
    [options, toggle]
  );

  useQuestionKeyboard({
    isPending,
    onPrimary: handlePrimary,
    onDigit,
    onPrev: goPrev,
    onNext: goNext,
  });

  const atLimit = required != null && picked.length >= required;
  const atUpToLimit = upToMax != null && picked.length >= upToMax;
  const hintId = `${statementId}-hint`;

  return (
    <div className="flex flex-col gap-4">
      <p id={hintId} className="text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {mode === "exact"
          ? SURVEY_MESSAGES.pickExactly(required ?? 0, picked.length)
          : mode === "upTo"
            ? SURVEY_MESSAGES.pickUpTo(upToMax ?? 0, picked.length)
            : SURVEY_MESSAGES.pickAllThatApply}
      </p>
      <div
        role="group"
        aria-labelledby={labelledById}
        aria-describedby={hintId}
        className="grid w-full gap-2"
      >
        {options.map((option) => {
          const optionLabelId = `${statementId}-option-${option.value}`;
          const checked = picked.includes(option.value);
          // choice_up_to: the limit only disables unticked NON-exclusive
          // boxes — the exclusive option stays enabled, since picking it
          // replaces the whole selection rather than adding to it.
          const disabled =
            isPending ||
            (atLimit && !checked) ||
            (atUpToLimit && !checked && !option.exclusive);
          return (
            <label
              key={option.value}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg border px-4 py-2 text-base break-words has-data-checked:border-primary has-data-checked:ring-1 has-data-checked:ring-primary has-data-disabled:opacity-60"
            >
              <Checkbox
                checked={checked}
                disabled={disabled}
                onCheckedChange={() => toggle(option.value)}
                aria-labelledby={optionLabelId}
              />
              <span id={optionLabelId} className="break-words">
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
      {required != null && picked.length > 0 && picked.length < required ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {SURVEY_MESSAGES.pickMore(required - picked.length)}
        </p>
      ) : null}
      <QuestionError error={error} />
      <QuestionButtons
        isPending={isPending}
        onBack={goPrev}
        primaryLabel={
          picked.length === 0 ? SURVEY_MESSAGES.next : SURVEY_MESSAGES.submit
        }
        primaryDisabled={picked.length > 0 && !isComplete}
        onPrimary={handlePrimary}
      />
      <KeyboardHint optionCount={options.length} verb="tick" />
    </div>
  );
}
