import type { ReactNode } from "react";

export type ResultRow = {
  key: string;
  label: string;
  count: number;
  percent: number;
  /** Pre-formatted text shown instead of the percentage (for example a
   * 0-10 average "7.2") — used by the rating overview (261019-2w3).
   * `percent` still drives the bar width and `count` still picks the
   * accented row. */
  displayValue?: string;
};

/**
 * The one results layout for every presentation slide that shows answer
 * shares (scale statements, choice questions, familiarity overview, and
 * the rating overview, which passes `displayValue` instead of a percent).
 *
 * Each answer is a block: label on the left and its percentage (large) on
 * the right of ONE line, with a thick bar underneath — so long labels never
 * push bars out of line and the eye can scan straight down the numbers.
 * No legend, no colour key: every row is neutral except the top answer,
 * which takes the single accent colour (label, number and bar).
 * `maxPercent` lets pick-many questions (percentages can sum past 100)
 * stretch the scale so no bar clips.
 */
export function ResultRows({
  rows,
  ariaLabel,
  maxPercent = 100,
  note,
}: {
  rows: ResultRow[];
  ariaLabel: string;
  maxPercent?: number;
  note?: ReactNode;
}) {
  let winnerIndex = -1;
  let winnerCount = 0;
  rows.forEach((row, i) => {
    if (row.count > winnerCount) {
      winnerCount = row.count;
      winnerIndex = i;
    }
  });

  const scale = Math.max(maxPercent, 100);
  // Long option lists (e.g. D's seven reasons) tighten up so the whole
  // slide still fits a laptop-height screen.
  const compact = rows.length > 5;
  // Very long lists (A's 13 terms) flow into two columns, read top to
  // bottom then left to right, so nothing is cut off.
  const twoColumn = rows.length > 8;
  const percentSize = compact ? "text-[26px]" : "text-[34px]";
  const labelSize = compact ? "text-[19px]" : "text-[22px]";
  const barHeight = compact ? "h-2.5" : "h-3.5";

  return (
    <div className={twoColumn ? "flex w-full flex-col gap-4" : "flex w-full max-w-5xl flex-col gap-4"}>
      <ul
        aria-label={ariaLabel}
        className={
          twoColumn
            ? "columns-2 gap-x-14 [&>li]:mb-3 [&>li]:break-inside-avoid"
            : compact
              ? "flex flex-col gap-2"
              : "flex flex-col gap-4"
        }
      >
        {rows.map((row, i) => {
          const isWinner = i === winnerIndex && row.count > 0;
          const width = Math.max(0, Math.min(100, (row.percent / scale) * 100));
          return (
            <li key={row.key} className={compact ? "flex flex-col gap-0.5" : "flex flex-col gap-1.5"}>
              <div className="flex items-baseline justify-between gap-6">
                <span
                  className={
                    isWinner
                      ? `${labelSize} leading-[1.25] font-semibold text-pres-accent`
                      : `${labelSize} leading-[1.25] text-pres-ink-secondary`
                  }
                >
                  {row.label}
                </span>
                <span
                  className={
                    isWinner
                      ? `shrink-0 tabular-nums ${percentSize} leading-none font-bold text-pres-accent`
                      : `shrink-0 tabular-nums ${percentSize} leading-none font-normal text-pres-ink-secondary`
                  }
                >
                  {row.displayValue !== undefined ? row.displayValue : `${row.percent}%`}
                </span>
              </div>
              <span
                className={`${barHeight} w-full overflow-hidden rounded-full bg-pres-border`}
                aria-hidden="true"
              >
                <span
                  className={
                    isWinner
                      ? "block h-full rounded-full bg-pres-accent"
                      : "block h-full rounded-full bg-pres-ink/40"
                  }
                  style={{ width: `${width}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>
      {note ? <p className="text-[17px] text-pres-ink-muted">{note}</p> : null}
    </div>
  );
}
