"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import {
  moveRank,
  normaliseAnswer,
  toggleRank,
  type ChoiceOption,
} from "@/lib/survey/answer-rules";
import { cn } from "@/lib/utils";
import {
  KeyboardHint,
  QuestionButtons,
  QuestionError,
  useSaveAndAdvance,
  type QuestionNavProps,
} from "./question-controls";
import { useQuestionKeyboard } from "./use-question-keyboard";

/**
 * Ranking questions: the participant ranks EVERY item, most important
 * first.
 *  - Items are always listed in the fixed order they were written in and
 *    nothing is ranked on a first visit.
 *  - Tapping an unranked item gives it the next number; tapping a ranked
 *    item removes it and the later numbers close up.
 *  - Ranked items also get Move up / Move down buttons, which swap rank
 *    numbers with the neighbouring rank (an accessible alternative to
 *    drag-and-drop, which is deliberately not offered).
 *  - Continue stays disabled until every item is ranked, and saves the
 *    whole ranking in rank order.
 * There is no digit-key shortcut here (there are too many ways to read
 * "press 3"); Enter and the arrow keys behave as on the other forms.
 */
export function RankingForm({
  statementId,
  labelledById,
  options,
  initialValues,
  prevHref,
  nextHref,
}: QuestionNavProps & {
  labelledById: string;
  options: ChoiceOption[];
  initialValues: number[] | null;
}) {
  const { isPending, error, setError, goPrev, goNext, save } =
    useSaveAndAdvance({ statementId, prevHref, nextHref });

  // A saved ranking is only restored when it is a full, valid ranking of
  // these options; anything else starts the question fresh.
  const restored =
    initialValues &&
    normaliseAnswer(
      { kind: "ranking", options, choiceCount: null },
      { choiceValues: initialValues }
    )
      ? [...initialValues]
      : [];
  const [ranked, setRanked] = useState<number[]>(restored);
  const lastSavedRef = useRef<number[]>(restored);

  const total = options.length;
  const isComplete = ranked.length === total;

  const toggle = useCallback(
    (value: number) => {
      setError(null);
      setRanked((current) => toggleRank(current, value));
    },
    [setError]
  );

  const move = useCallback(
    (value: number, direction: -1 | 1) => {
      setError(null);
      setRanked((current) => moveRank(current, value, direction));
    },
    [setError]
  );

  const handlePrimary = useCallback(() => {
    if (isPending || !isComplete) {
      return;
    }
    const chosen = [...ranked];
    save(
      { choiceValues: chosen },
      () => {
        lastSavedRef.current = chosen;
      },
      () => setRanked(lastSavedRef.current)
    );
  }, [isPending, isComplete, ranked, save]);

  useQuestionKeyboard({
    isPending,
    onPrimary: handlePrimary,
    onPrev: goPrev,
    onNext: goNext,
  });

  const hintId = `${statementId}-hint`;

  return (
    <div className="flex flex-col gap-4">
      <p id={hintId} className="text-sm text-zinc-600 dark:text-zinc-400">
        {SURVEY_MESSAGES.rankingHint}
      </p>
      <p
        className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
        aria-live="polite"
      >
        {SURVEY_MESSAGES.rankingProgress(ranked.length, total)}
      </p>
      <ul
        aria-labelledby={labelledById}
        aria-describedby={hintId}
        className="grid w-full gap-2"
      >
        {options.map((option) => {
          const rankIndex = ranked.indexOf(option.value);
          const rank = rankIndex + 1;
          const isRanked = rankIndex !== -1;
          const atTop = rank === 1;
          const atBottom = rank === ranked.length;
          return (
            <li
              key={option.value}
              className="flex flex-col gap-1 min-[480px]:flex-row min-[480px]:items-stretch min-[480px]:gap-2"
            >
              <button
                type="button"
                aria-pressed={isRanked}
                aria-label={
                  isRanked
                    ? SURVEY_MESSAGES.rankingItemRanked(option.label, rank, total)
                    : SURVEY_MESSAGES.rankingItemUnranked(option.label)
                }
                disabled={isPending}
                onClick={() => toggle(option.value)}
                className={cn(
                  "flex min-h-11 w-full min-w-0 flex-1 items-center gap-3 rounded-lg border px-3 py-2 text-left text-base break-words outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                  isRanked && "border-primary ring-1 ring-primary"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                    isRanked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-dashed"
                  )}
                >
                  {isRanked ? rank : null}
                </span>
                <span className="min-w-0 break-words">{option.label}</span>
              </button>
              {isRanked ? (
                <div className="flex shrink-0 justify-end gap-1 min-[480px]:gap-2">
                  <button
                    type="button"
                    aria-label={SURVEY_MESSAGES.rankingMoveUp(option.label)}
                    aria-disabled={isPending || atTop}
                    onClick={() => {
                      if (!isPending && !atTop) {
                        move(option.value, -1);
                      }
                    }}
                    className={cn(
                      "flex size-11 items-center justify-center rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      (isPending || atTop) && "opacity-40"
                    )}
                  >
                    <ChevronUp aria-hidden="true" className="size-5" />
                  </button>
                  <button
                    type="button"
                    aria-label={SURVEY_MESSAGES.rankingMoveDown(option.label)}
                    aria-disabled={isPending || atBottom}
                    onClick={() => {
                      if (!isPending && !atBottom) {
                        move(option.value, 1);
                      }
                    }}
                    className={cn(
                      "flex size-11 items-center justify-center rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      (isPending || atBottom) && "opacity-40"
                    )}
                  >
                    <ChevronDown aria-hidden="true" className="size-5" />
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <QuestionError error={error} />
      <QuestionButtons
        isPending={isPending}
        onBack={goPrev}
        primaryLabel={SURVEY_MESSAGES.continueCta}
        primaryDisabled={!isComplete}
        onPrimary={handlePrimary}
      />
      <KeyboardHint optionCount={null} verb="choose" />
    </div>
  );
}
