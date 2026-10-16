/**
 * Pure presentation maths: percentages, net agreement, respondent copy,
 * and the launch-visibility predicate. No imports beyond ./types and
 * ./messages — every function here is a @static-tested pure function
 * (tests/api/presentation-math.spec.ts).
 */
import { PRESENTATION_MESSAGES } from "./messages";
import type { OptionCount } from "./types";

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
