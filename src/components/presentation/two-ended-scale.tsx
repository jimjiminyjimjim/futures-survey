import type { TwoEndedBucket } from "@/lib/presentation/types";
import { PRESENTATION_MESSAGES } from "@/lib/presentation/messages";

/**
 * Two-ended (0–100) distribution: a track with an average-position marker
 * above a 10-bucket histogram, then the two end labels. No numbers shown
 * (per the clean dark presentation style) — the track position and bar
 * heights carry the story.
 */
export function TwoEndedScale({
  average,
  buckets,
  leftLabel,
  rightLabel,
  ariaLabel,
}: {
  average: number | null;
  buckets: TwoEndedBucket[];
  leftLabel: string;
  rightLabel: string;
  ariaLabel: string;
}) {
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      {average != null ? (
        <div className="relative mt-10 h-3 w-full rounded-full bg-pres-border">
          {/* Dot centred on the track; label sits above it so it never
              collides with the histogram below. */}
          <div
            className="absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${average}%` }}
          >
            <span className="block size-full rounded-full bg-pres-accent ring-4 ring-pres-page" />
            <span className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap text-[17px] text-pres-accent">
              {PRESENTATION_MESSAGES.averageMarker}
            </span>
          </div>
        </div>
      ) : null}
      <ul aria-label={ariaLabel} className="flex h-40 w-full items-end gap-1">
        {buckets.map((bucket) => {
          const isTallest = bucket.count === maxCount && bucket.count > 0;
          const heightPercent = Math.max(0, Math.min(100, (bucket.count / maxCount) * 100));
          return (
            <li key={bucket.from} className="flex h-full flex-1 items-end">
              {bucket.count === 0 ? (
                <span className="h-1 w-full rounded-full bg-pres-border" />
              ) : (
                <span
                  className={
                    isTallest
                      ? "w-full rounded-t bg-pres-accent"
                      : "w-full rounded-t bg-pres-ink/40"
                  }
                  style={{ height: `${heightPercent}%` }}
                />
              )}
              <span className="sr-only">{`${bucket.from}–${bucket.to}: ${bucket.percent}%`}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-between gap-8 text-[17px] text-pres-ink-muted">
        <span className="max-w-[45%]">{leftLabel}</span>
        <span className="max-w-[45%] text-right">{rightLabel}</span>
      </div>
    </div>
  );
}
