"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAnswer } from "@/lib/survey/actions";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import { QuestionButtons, QuestionError } from "./question-controls";
import { RatingScale } from "./rating-scale";

export type GroupedRatingRow = {
  statementId: string;
  textId: string;
  text: string;
  leftLabel: string;
  rightLabel: string;
  initialValue: number | null;
  optional: boolean;
};

/**
 * Question C's one-page grouped form: every row of a grouped section's
 * statements on one screen, sharing the RatingScale control, with a
 * single Continue. Choosing a value never saves — only Continue does,
 * one saveAnswer call per row whose value actually changed, in row
 * order — so answers_before_write runs exactly as it does on the
 * one-statement-per-screen path.
 *
 * Deliberately has NO document-level keyboard shortcuts and shows no
 * keyboard hint: with 7 controls on one page, digit/Enter/arrow
 * shortcuts would be ambiguous about which row they target. This page
 * relies on Tab between the radio groups and Base UI's own in-group
 * arrow-key roving focus — a deliberate simplification the brief
 * allowed, not a half-applied version of the single-statement
 * shortcuts.
 */
export function GroupedRatingForm({
  rows,
  prevHref,
  nextHref,
}: {
  rows: GroupedRatingRow[];
  prevHref: string;
  nextHref: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initialValues = Object.fromEntries(
    rows.map((row) => [
      row.statementId,
      row.initialValue != null ? String(row.initialValue) : "",
    ])
  );
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const lastSavedRef = useRef<Record<string, string>>(initialValues);

  const setRowValue = useCallback(
    (statementId: string, next: string) => {
      setError(null);
      setValues((prev) => ({ ...prev, [statementId]: next }));
    },
    []
  );

  const goPrev = useCallback(() => {
    startTransition(() => {
      router.push(prevHref);
    });
  }, [router, prevHref]);

  const remaining = rows.filter(
    (row) => !row.optional && values[row.statementId] === ""
  ).length;

  const handleContinue = useCallback(() => {
    if (isPending) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        for (const row of rows) {
          const current = values[row.statementId];
          if (current === "" || current === lastSavedRef.current[row.statementId]) {
            continue;
          }
          const result = await saveAnswer({
            statementId: row.statementId,
            value: Number(current),
          });

          if (result.ok) {
            lastSavedRef.current = {
              ...lastSavedRef.current,
              [row.statementId]: current,
            };
            continue;
          }

          if (result.reason === "not-open") {
            router.replace("/");
            return;
          }

          if (result.reason === "submitted") {
            setValues({ ...lastSavedRef.current });
            setError(result.error);
            return;
          }

          setError(result.error);
          return;
        }

        router.push(nextHref);
      } catch {
        setError(SURVEY_MESSAGES.saveFailed);
      }
    });
  }, [isPending, rows, values, router, nextHref]);

  return (
    <div className="flex flex-col gap-8">
      {rows.map((row) => (
        <div key={row.statementId} className="flex flex-col gap-3">
          <p id={row.textId} className="text-lg font-semibold leading-tight break-words">
            {row.text}
          </p>
          <RatingScale
            value={values[row.statementId]}
            onValueChange={(next) => setRowValue(row.statementId, next)}
            labelledById={row.textId}
            disabled={isPending}
            leftLabel={row.leftLabel}
            rightLabel={row.rightLabel}
          />
        </div>
      ))}
      {remaining > 0 ? (
        <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
          {SURVEY_MESSAGES.reviewRemaining(remaining)}
        </p>
      ) : null}
      <QuestionError error={error} />
      <QuestionButtons
        isPending={isPending}
        onBack={goPrev}
        primaryLabel={SURVEY_MESSAGES.continueCta}
        onPrimary={handleContinue}
        primaryDisabled={remaining > 0}
      />
    </div>
  );
}
