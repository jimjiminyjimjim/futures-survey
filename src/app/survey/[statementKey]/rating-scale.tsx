"use client";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

export const RATING_VALUES = Array.from({ length: 11 }, (_, i) => i); // 0..10

/**
 * The shared 0-10 rating control: an 11-point selector with end labels.
 * Used by both RatingForm (one statement per screen) and
 * GroupedRatingForm (every row of a grouped section on one page). Purely
 * presentational + value plumbing — saving/advancing stays with the
 * caller.
 */
export function RatingScale({
  value,
  onValueChange,
  labelledById,
  disabled,
  leftLabel,
  rightLabel,
}: {
  value: string;
  onValueChange: (next: string) => void;
  labelledById: string;
  disabled?: boolean;
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <RadioGroup
        value={value}
        onValueChange={(next) => onValueChange(String(next))}
        aria-labelledby={labelledById}
        disabled={disabled}
        className="grid grid-cols-6 gap-1.5 pointer-fine:grid-cols-11"
      >
        {RATING_VALUES.map((n) => (
          <label
            key={n}
            className="relative flex min-h-11 items-center justify-center rounded-lg border text-base has-data-checked:border-primary has-data-checked:bg-primary has-data-checked:text-primary-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring/50"
          >
            {/* Stretched over the button and transparent: still the focusable,
                clickable radio, but takes no space so the number stays centred. */}
            <RadioGroupItem
              value={String(n)}
              className="absolute inset-0 size-full rounded-lg border-0 opacity-0"
            />
            <span aria-hidden="true">{n}</span>
          </label>
        ))}
      </RadioGroup>
      <div className="flex justify-between text-sm text-zinc-600 dark:text-zinc-400">
        <span>{SURVEY_MESSAGES.ratingEnd(0, leftLabel)}</span>
        <span>{SURVEY_MESSAGES.ratingEnd(10, rightLabel)}</span>
      </div>
    </div>
  );
}
