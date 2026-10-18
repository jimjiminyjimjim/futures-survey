/**
 * Pure presentation maths: percentages, net agreement, respondent copy,
 * and the launch-visibility predicate. No imports beyond ./types and
 * ./messages — every function here is a @static-tested pure function
 * (tests/api/presentation-math.spec.ts).
 */
import { PRESENTATION_MESSAGES } from "./messages";
import type { OptionCount, TwoEndedBucket } from "./types";

/** Half-up (round-half-away-from-zero for non-negative inputs) integer
 * percentage. 0 when total is 0. Options are never adjusted to sum to
 * 100 — each is computed independently. */
export function optionPercent(count: number, total: number): number {
  if (total === 0) {
    return 0;
  }
  return Math.round((100 * count) / total);
}

/** Exact, unrounded share — used for bar geometry so segment widths never
 * drift from the true proportion the rounded percentage labels describe. */
export function optionShare(count: number, total: number): number {
  if (total === 0) {
    return 0;
  }
  return (100 * count) / total;
}

/**
 * Net agreement = 100 × ((count4 + count5) − (count1 + count2)) / total,
 * rounded half-away-from-zero, normalising -0 to 0. null when total is 0.
 * options must be in value order (1..5); any missing value is treated as
 * count 0.
 */
export function netAgreement(
  options: OptionCount[],
  total: number
): number | null {
  if (total === 0) {
    return null;
  }
  const byValue = new Map(options.map((o) => [o.value, o.count]));
  const count1 = byValue.get(1) ?? 0;
  const count2 = byValue.get(2) ?? 0;
  const count4 = byValue.get(4) ?? 0;
  const count5 = byValue.get(5) ?? 0;

  const x = (100 * (count4 + count5 - (count1 + count2))) / total;
  const result = Math.sign(x) * Math.round(Math.abs(x));
  return result === 0 ? 0 : result;
}

export function formatNetAgreement(n: number): string {
  if (n > 0) {
    return `+${n} net agreement`;
  }
  if (n < 0) {
    return `−${Math.abs(n)} net agreement`;
  }
  return "0 net agreement";
}

export function respondentsLabel(n: number): string {
  return PRESENTATION_MESSAGES.respondents(n);
}

export function canPresent(status: string): boolean {
  return status === "open" || status === "closed";
}

/** Weighted mean of a familiarity statement's option counts (Sigma value x
 * count / Sigma count). 0 when nobody has answered. */
export function meanFamiliarity(options: OptionCount[]): number {
  let sum = 0;
  let n = 0;
  for (const o of options) {
    sum += o.value * o.count;
    n += o.count;
  }
  return n === 0 ? 0 : sum / n;
}

export type FamiliarityTerm = {
  statementKey: string;
  sortOrder: number;
  sum: number;
  n: number;
};

/**
 * Ranks familiarity terms by mean descending, comparing means by exact
 * integer cross-multiplication (a.sum * b.n vs b.sum * a.n) rather than
 * floating-point division, so equal means are never nudged apart by
 * rounding. Ties keep ascending sortOrder. Stable (Array.prototype.sort
 * is a stable sort per spec).
 */
export function rankByMeanFamiliarity<T extends FamiliarityTerm>(
  terms: T[]
): T[] {
  return [...terms].sort((a, b) => {
    const aZero = a.n === 0;
    const bZero = b.n === 0;
    // Familiarity option values are always >= 1, so n > 0 implies a
    // strictly positive mean — a zero-n term never needs the cross
    // multiplication below (which assumes both n's are non-zero) to
    // know it ranks below any answered term.
    let cross: number;
    if (aZero && bZero) {
      cross = 0;
    } else if (aZero) {
      cross = 1; // a (mean 0) ranks after b (mean > 0)
    } else if (bZero) {
      cross = -1; // b (mean 0) ranks after a (mean > 0)
    } else {
      cross = b.sum * a.n - a.sum * b.n;
    }
    if (cross !== 0) {
      return cross;
    }
    return a.sortOrder - b.sortOrder;
  });
}

export function formatMean(n: number): string {
  return n.toFixed(1);
}

/** 11 OptionCounts for a 0–10 rating, values 0..10, label String(value),
 * zeros included for values with no answers. */
export function ratingOptionCounts(byValue: Map<number, number>): OptionCount[] {
  return Array.from({ length: 11 }, (_, value) => ({
    value,
    label: String(value),
    count: byValue.get(value) ?? 0,
  }));
}

/** 1 dp weighted average of a set of option counts, or null when the
 * total is 0. */
export function averageFromCounts(options: OptionCount[]): number | null {
  let sum = 0;
  let n = 0;
  for (const o of options) {
    sum += o.value * o.count;
    n += o.count;
  }
  return n === 0 ? null : Math.round((sum / n) * 10) / 10;
}

/** 10 buckets 0–9, 10–19, … 90–100 (the last includes 100) for a 0..100
 * two_ended distribution. percent via optionPercent (half-up, 0 on an
 * empty total). */
export function twoEndedBuckets(byValue: Map<number, number>): TwoEndedBucket[] {
  const counts = Array.from({ length: 10 }, () => 0);
  let total = 0;
  for (const [value, count] of byValue) {
    const idx = value >= 100 ? 9 : Math.floor(value / 10);
    counts[idx] += count;
    total += count;
  }
  return counts.map((count, i) => ({
    from: i * 10,
    to: i === 9 ? 100 : i * 10 + 9,
    count,
    percent: optionPercent(count, total),
  }));
}

/** Count of respondents who chose agreement levels 4 (Agree) or 5
 * (Strongly agree). options must be in value order; missing values
 * treated as count 0. */
export function agreeCount(options: OptionCount[]): number {
  const byValue = new Map(options.map((o) => [o.value, o.count]));
  return (byValue.get(4) ?? 0) + (byValue.get(5) ?? 0);
}

/** Count of respondents who chose agreement levels 1 (Strongly
 * disagree) or 2 (Disagree). */
export function disagreeCount(options: OptionCount[]): number {
  const byValue = new Map(options.map((o) => [o.value, o.count]));
  return (byValue.get(1) ?? 0) + (byValue.get(2) ?? 0);
}

/** % of total who agreed (levels 4+5). Half-up rounded, 0 when total is
 * 0 (callers gate the "No respondents yet" empty state separately). */
export function agreePercent(options: OptionCount[], total: number): number {
  return optionPercent(agreeCount(options), total);
}

/** % of total who disagreed (levels 1+2). */
export function disagreePercent(options: OptionCount[], total: number): number {
  return optionPercent(disagreeCount(options), total);
}

/** Plain-words agreement headline: "68% agree · 18% disagree". */
export function formatAgreeDisagree(agree: number, disagree: number): string {
  return `${agree}% agree · ${disagree}% disagree`;
}

/** Count of respondents who could explain a familiarity term — levels 3
 * ("I could explain it simply") or 4 ("...use it in my work"). */
export function explainCount(options: OptionCount[]): number {
  const byValue = new Map(options.map((o) => [o.value, o.count]));
  return (byValue.get(3) ?? 0) + (byValue.get(4) ?? 0);
}

/** % of total who could explain the term (levels 3+4). */
export function explainPercent(options: OptionCount[], total: number): number {
  return optionPercent(explainCount(options), total);
}

/** Plain-words familiarity headline: "54% could explain it". */
export function formatExplainHeadline(percent: number): string {
  return `${percent}% could explain it`;
}

export type ExplainTerm = {
  statementKey: string;
  sortOrder: number;
  explainCount: number;
  n: number;
};

/**
 * Ranks familiarity-overview terms by % who could explain the term
 * (explainCount / n) descending, comparing by exact integer
 * cross-multiplication (same technique as rankByMeanFamiliarity) so
 * equal percentages are never nudged apart by floating-point rounding.
 * A zero-respondent term always ranks last. Ties keep ascending
 * sortOrder. Stable (Array.prototype.sort is a stable sort per spec).
 */
export function rankByExplainPercent<T extends ExplainTerm>(terms: T[]): T[] {
  return [...terms].sort((a, b) => {
    const aZero = a.n === 0;
    const bZero = b.n === 0;
    let cross: number;
    if (aZero && bZero) {
      cross = 0;
    } else if (aZero) {
      cross = 1;
    } else if (bZero) {
      cross = -1;
    } else {
      cross = b.explainCount * a.n - a.explainCount * b.n;
    }
    if (cross !== 0) {
      return cross;
    }
    return a.sortOrder - b.sortOrder;
  });
}
