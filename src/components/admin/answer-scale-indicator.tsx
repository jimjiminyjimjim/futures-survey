import { cn } from "cn";

/**
 * A compact segmented indicator for a single Likert-style answer: one dot
 * per scale option, filled up to the chosen value. Filled dots use the
 * same colour as the chosen option in Presentation mode (user request
 * 2026-10-15) — the pres-agreement-N palette for 5-point agreement scales
 * and pres-familiarity-N for 4-point familiarity scales (both defined in
 * globals.css). Purely decorative (aria-hidden) — the numeric value is
 * exposed to screen readers via `srLabel`.
 */
function chosenColour(value: number, total: number): string | undefined {
  if (total === 5) return `var(--pres-agreement-${value})`;
  if (total === 4) return `var(--pres-familiarity-${value})`;
  return undefined;
}

export function AnswerScaleIndicator({
  value,
  total,
  srLabel,
}: {
  value: number | undefined;
  total: number;
  srLabel?: string;
}) {
  const filled = value ?? 0;
  const colour = value ? chosenColour(value, total) : undefined;

  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "size-2.5 rounded-full",
              i < filled
                ? colour
                  ? undefined
                  : "bg-foreground"
                : "bg-muted-foreground/25"
            )}
            style={i < filled && colour ? { backgroundColor: colour } : undefined}
          />
        ))}
      </span>
      {srLabel ? <span className="sr-only">{srLabel}</span> : null}
    </span>
  );
}
