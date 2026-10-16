import { test, expect } from "@playwright/test";
import {
  optionPercent,
  netAgreement,
  formatNetAgreement,
  respondentsLabel,
  canPresent,
  meanFamiliarity,
  rankByMeanFamiliarity,
  formatMean,
} from "@/lib/presentation/chart-math";
import { buildSlides } from "@/lib/presentation/build-slides";
import type { PresentationInput, OptionCount } from "@/lib/presentation/types";

/**
 * Pure maths and slide-sequencing proofs for Presentation Mode — no DB,
 * no file reads. Pins every <behavior> case from 04-01-PLAN.md Task 2,
 * including the 94-slide Round-1-shaped sequence (7 sections: section 1
 * familiarity/16 statements, sections 2-7 agreement/69 statements total).
 */

const AGREEMENT_LABELS: Record<number, string> = {
  1: "Strongly disagree",
  2: "Disagree",
  3: "Neither",
  4: "Agree",
  5: "Strongly agree",
};

const FAMILIARITY_LABELS: Record<number, string> = {
  1: "I've never heard of it",
  2: "I've heard of it but couldn't explain it",
  3: "I could explain it simply",
  4: "I understand it well and could use it in my work",
};

function agreementOptions(counts: Partial<Record<1 | 2 | 3 | 4 | 5, number>>): OptionCount[] {
  return [1, 2, 3, 4, 5].map((value) => ({
    value,
    label: AGREEMENT_LABELS[value],
    count: counts[value as 1 | 2 | 3 | 4 | 5] ?? 0,
  }));
}

test.describe("presentation maths — @static (no DB)", () => {
  test("optionPercent: half-up rounding, zero total, no cross-option adjustment", () => {
    expect(optionPercent(1, 3)).toBe(33);
    expect(optionPercent(2, 3)).toBe(67);
    expect(optionPercent(1, 8)).toBe(13);
    expect(optionPercent(0, 0)).toBe(0);
    expect(optionPercent(5, 5)).toBe(100);
    // Three equal thirds: 33 + 33 + 33 = 99, never adjusted to sum to 100.
    const third = optionPercent(1, 3);
    expect(third + third + third).toBe(99);
  });

  test("netAgreement: rounding half-away-from-zero, boundaries, never -0, null at zero total", () => {
    expect(netAgreement(agreementOptions({ 1: 1, 4: 1, 5: 1 }), 3)).toBe(33);
    expect(netAgreement(agreementOptions({ 2: 1, 3: 2 }), 3)).toBe(-33);
    expect(netAgreement(agreementOptions({ 2: 2, 3: 3, 4: 3 }), 8)).toBe(13);
    expect(netAgreement(agreementOptions({ 2: 3, 3: 2, 4: 2 }), 8)).toBe(-13);
    expect(netAgreement(agreementOptions({ 3: 4 }), 4)).toBe(0);
    expect(netAgreement(agreementOptions({ 2: 1, 4: 1 }), 2)).toBe(0);
    expect(netAgreement(agreementOptions({ 5: 7 }), 7)).toBe(100);
    expect(netAgreement(agreementOptions({ 1: 7 }), 7)).toBe(-100);
    expect(netAgreement(agreementOptions({}), 0)).toBeNull();
    expect(Object.is(netAgreement(agreementOptions({ 2: 1, 4: 1 }), 2), -0)).toBe(
      false
    );
  });

  test("formatNetAgreement: signed with U+2212 minus, zero has no sign", () => {
    expect(formatNetAgreement(33)).toBe("+33 net agreement");
    expect(formatNetAgreement(-13)).toBe("−13 net agreement");
    expect(formatNetAgreement(0)).toBe("0 net agreement");
  });

  test("respondentsLabel: singular/plural, explicit zero", () => {
    expect(respondentsLabel(0)).toBe("0 respondents");
    expect(respondentsLabel(1)).toBe("1 respondent");
    expect(respondentsLabel(2)).toBe("2 respondents");
  });

  test("canPresent: true for open/closed only, never a date comparison", () => {
    expect(canPresent("open")).toBe(true);
    expect(canPresent("closed")).toBe(true);
    expect(canPresent("draft")).toBe(false);
    expect(canPresent("scheduled")).toBe(false);
  });

  test("meanFamiliarity: weighted mean, zero when no answers", () => {
    expect(
      meanFamiliarity([
        { value: 1, label: FAMILIARITY_LABELS[1], count: 1 },
        { value: 4, label: FAMILIARITY_LABELS[4], count: 1 },
      ])
    ).toBe(2.5);
    expect(
      meanFamiliarity([
        { value: 1, label: FAMILIARITY_LABELS[1], count: 0 },
        { value: 2, label: FAMILIARITY_LABELS[2], count: 0 },
      ])
    ).toBe(0);
  });

  test("rankByMeanFamiliarity: descending by exact cross-multiplication, ties keep sortOrder, single term returns itself", () => {
    const terms = [
      { statementKey: "a", text: "A", sortOrder: 1, sum: 4, n: 2, mean: 2 },
      { statementKey: "b", text: "B", sortOrder: 2, sum: 9, n: 3, mean: 3 },
      { statementKey: "c", text: "C", sortOrder: 3, sum: 1, n: 1, mean: 1 },
    ];
    expect(rankByMeanFamiliarity(terms).map((t) => t.statementKey)).toEqual([
      "b",
      "a",
      "c",
    ]);

    // Equal means (including all-zero / no respondents) keep sortOrder.
    const tied = [
      { statementKey: "z", text: "Z", sortOrder: 3, sum: 0, n: 0, mean: 0 },
      { statementKey: "y", text: "Y", sortOrder: 1, sum: 0, n: 0, mean: 0 },
      { statementKey: "x", text: "X", sortOrder: 2, sum: 0, n: 0, mean: 0 },
    ];
    expect(rankByMeanFamiliarity(tied).map((t) => t.statementKey)).toEqual([
      "y",
      "x",
      "z",
    ]);

    const single = [
      { statementKey: "solo", text: "Solo", sortOrder: 1, sum: 3, n: 1, mean: 3 },
    ];
    expect(rankByMeanFamiliarity(single).map((t) => t.statementKey)).toEqual([
      "solo",
    ]);
  });

  test("formatMean: one decimal place always", () => {
    expect(formatMean(2.5)).toBe("2.5");
    expect(formatMean(3)).toBe("3.0");
    expect(formatMean(0)).toBe("0.0");
  });

  test("buildSlides: Round-1-shaped input (7 sections, familiarity section 1 x16, agreement sections 2-7 totalling 69) -> 94 slides", () => {
    const sections: PresentationInput["sections"] = [];
    // Section 1: familiarity, 16 statements.
    sections.push({
      sortOrder: 1,
      title: "Section 1",
      prompt: "Prompt 1",
      scaleKey: "familiarity",
      statements: Array.from({ length: 16 }, (_, i) => ({
        id: `s1-${i}`,
        key: `s1_${i}`,
        text: `Term ${i}`,
        sortOrder: i + 1,
      })),
    });
    // Sections 2-7: agreement, totalling 69 statements (e.g. 12,12,12,11,11,11).
    const counts6 = [12, 12, 12, 11, 11, 11];
    for (let s = 0; s < 6; s += 1) {
      const n = counts6[s];
      sections.push({
        sortOrder: s + 2,
        title: `Section ${s + 2}`,
        prompt: `Prompt ${s + 2}`,
        scaleKey: "agreement",
        statements: Array.from({ length: n }, (_, i) => ({
          id: `s${s + 2}-${i}`,
          key: `s${s + 2}_${i}`,
          text: `Statement ${i}`,
          sortOrder: i + 1,
        })),
      });
    }
    expect(
      sections.reduce((sum, s) => sum + s.statements.length, 0)
    ).toBe(85);

    const scaleOptions: PresentationInput["scaleOptions"] = [
      ...[1, 2, 3, 4].map((v) => ({
        scaleKey: "familiarity",
        value: v,
        label: FAMILIARITY_LABELS[v],
      })),
      ...[1, 2, 3, 4, 5].map((v) => ({
        scaleKey: "agreement",
        value: v,
        label: AGREEMENT_LABELS[v],
      })),
    ];

    const input: PresentationInput = {
      round: { title: "Round 1", roundNumber: 1, submittedCount: 0 },
      sections,
      scaleOptions,
      counts: [],
    };

    const { slides } = buildSlides(input);
    expect(slides).toHaveLength(94);
    expect(slides[0].kind).toBe("title");
    expect(slides[1].kind).toBe("section-intro");
    for (let i = 2; i <= 17; i += 1) {
      expect(slides[i].kind).toBe("statement");
    }
    expect(slides[18].kind).toBe("familiarity-overview");
    expect(slides[19].kind).toBe("section-intro");
  });

  test("buildSlides: zero sections -> one title slide using round.submittedCount", () => {
    const input: PresentationInput = {
      round: { title: "Empty", roundNumber: 2, submittedCount: 5 },
      sections: [],
      scaleOptions: [],
      counts: [],
    };
    const { slides, respondentCount } = buildSlides(input);
    expect(slides).toHaveLength(1);
    expect(slides[0]).toMatchObject({ kind: "title", respondentCount: 5 });
    expect(respondentCount).toBe(5);
  });

  test("buildSlides: a zero-statement section gets its intro immediately followed by the next intro, no overview for an empty familiarity section", () => {
    const input: PresentationInput = {
      round: { title: "R", roundNumber: 3, submittedCount: 0 },
      sections: [
        { sortOrder: 1, title: "Empty familiarity", prompt: "P1", scaleKey: "familiarity", statements: [] },
        {
          sortOrder: 2,
          title: "Agreement",
          prompt: "P2",
          scaleKey: "agreement",
          statements: [{ id: "a1", key: "a1", text: "A1", sortOrder: 1 }],
        },
      ],
      scaleOptions: [
        { scaleKey: "agreement", value: 1, label: AGREEMENT_LABELS[1] },
        { scaleKey: "agreement", value: 2, label: AGREEMENT_LABELS[2] },
        { scaleKey: "agreement", value: 3, label: AGREEMENT_LABELS[3] },
        { scaleKey: "agreement", value: 4, label: AGREEMENT_LABELS[4] },
        { scaleKey: "agreement", value: 5, label: AGREEMENT_LABELS[5] },
      ],
      counts: [],
    };
    const { slides } = buildSlides(input);
    // title, intro1(0 statements), intro2, statement
    expect(slides.map((s) => s.kind)).toEqual([
      "title",
      "section-intro",
      "section-intro",
      "statement",
    ]);
    expect(slides[1]).toMatchObject({ kind: "section-intro", statementCount: 0 });
  });

  test("buildSlides: an agreement-only round has no overview slide", () => {
    const input: PresentationInput = {
      round: { title: "R", roundNumber: 4, submittedCount: 0 },
      sections: [
        {
          sortOrder: 1,
          title: "Agreement",
          prompt: "P",
          scaleKey: "agreement",
          statements: [{ id: "a1", key: "a1", text: "A1", sortOrder: 1 }],
        },
      ],
      scaleOptions: [
        { scaleKey: "agreement", value: 1, label: AGREEMENT_LABELS[1] },
        { scaleKey: "agreement", value: 2, label: AGREEMENT_LABELS[2] },
        { scaleKey: "agreement", value: 3, label: AGREEMENT_LABELS[3] },
        { scaleKey: "agreement", value: 4, label: AGREEMENT_LABELS[4] },
        { scaleKey: "agreement", value: 5, label: AGREEMENT_LABELS[5] },
      ],
      counts: [],
    };
    const { slides } = buildSlides(input);
    expect(slides.some((s) => s.kind === "familiarity-overview")).toBe(false);
  });

  test("buildSlides: consistent counts/zero-filled options/determinism", () => {
    const sections: PresentationInput["sections"] = [
      {
        sortOrder: 1,
        title: "Agreement",
        prompt: "P",
        scaleKey: "agreement",
        statements: [
          { id: "a1", key: "a1", text: "A1", sortOrder: 1 },
          { id: "a2", key: "a2", text: "A2", sortOrder: 2 },
        ],
      },
    ];
    const scaleOptions: PresentationInput["scaleOptions"] = [1, 2, 3, 4, 5].map(
      (v) => ({ scaleKey: "agreement", value: v, label: AGREEMENT_LABELS[v] })
    );

    const withCounts: PresentationInput = {
      round: { title: "R", roundNumber: 5, submittedCount: 0 },
      sections,
      scaleOptions,
      counts: [
        { statementId: "a1", value: 1, count: 3 },
        { statementId: "a2", value: 2, count: 2 },
        { statementId: "a2", value: 3, count: 1 },
      ],
    };
    const result1 = buildSlides(withCounts);
    expect(result1.slides.every((s) => s.respondentCount === 3)).toBe(true);
    const statementSlide = result1.slides.find((s) => s.kind === "statement");
    expect(statementSlide && statementSlide.kind === "statement" && statementSlide.options).toHaveLength(5);

    const withoutCounts: PresentationInput = { ...withCounts, counts: [] };
    const result2 = buildSlides(withoutCounts);
    expect(result2.slides.every((s) => s.respondentCount === 0)).toBe(true);

    // Determinism: same input twice -> deep-equal output.
    const resultA = buildSlides(withCounts);
    const resultB = buildSlides(withCounts);
    expect(resultA).toEqual(resultB);
  });
});
