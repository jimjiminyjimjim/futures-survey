import type { OptionCount } from "@/lib/presentation/types";
import { optionPercent } from "@/lib/presentation/chart-math";

/**
 * 0–10 rating distribution: an 11-column flex row, each column a percent
 * (large, winner accented), a bar (height relative to the max percent,
 * zero counts show a thin baseline), and the value below. Same winner
 * rule as ResultRows (first max count > 0) — no legend, no colour key.
 */
export function RatingColumns({
  options,
  leftLabel,
  rightLabel,
  ariaLabel,
}: {
  options: OptionCount[];
  leftLabel: string;
  rightLabel: string;
  ariaLabel: string;
}) {
  const total = options.reduce((sum, o) => sum + o.count, 0);

  let winnerIndex = -1;
  let winnerCount = 0;
  options.forEach((o, i) => {
    if (o.count > winnerCount) {
      winnerCount = o.count;
      winnerIndex = i;
    }
  });

  const percents = options.map((o) => optionPercent(o.count, total));
  const maxPercent = Math.max(1, ...percents);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-3">
      <ul aria-label={ariaLabel} className="flex w-full items-end gap-2">
        {options.map((option, i) => {
          const isWinner = i === winnerIndex && option.count > 0;
          const percent = percents[i];
          const heightPercent = Math.max(0, Math.min(100, (percent / maxPercent) * 100));
          return (
            <li key={option.value} className="flex flex-1 flex-col items-center gap-2">
              <span
                className={
                  isWinner
                    ? "text-[22px] font-bold tabular-nums text-pres-accent"
                    : "text-[22px] tabular-nums text-pres-ink-secondary"
                }
              >
                {percent}%
              </span>
              <span className="flex h-36 w-full items-end" aria-hidden="true">
                {option.count === 0 ? (
                  <span className="h-1 w-full rounded-full bg-pres-border" />
                ) : (
                  <span
                    className={
                      isWinner
                        ? "w-full rounded-t bg-pres-accent"
                        : "w-full rounded-t bg-pres-ink/40"
                    }
                    style={{ height: `${heightPercent}%` }}
                  />
                )}
              </span>
              <span className="text-[17px] text-pres-ink-muted">{option.value}</span>
              <span className="sr-only">{`${option.value}: ${percent}%`}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-between text-[17px] text-pres-ink-muted">
        <span className="max-w-[45%]">{leftLabel}</span>
        <span className="max-w-[45%] text-right">{rightLabel}</span>
      </div>
    </div>
  );
}
