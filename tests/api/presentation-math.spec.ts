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
import { buildSlides, buildDeckSteps, buildSectionHeadings } from "@/lib/presentation/build-slides";
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

test.describe("deck steps and section headings — @static (no DB)", () => {
  // Fixture: title, intro A, stmt A1, stmt A2, familiarity-overview, intro B,
  // stmt B1 — 7 slides, indices 0-6.
  const sections: PresentationInput["sections"] = [
    {
      sortOrder: 1,
      label: "A",
      title: "Familiarity",
      prompt: "Prompt A",
      scaleKey: "familiarity",
      statements: [
        { id: "a1", key: "a1", text: "Term A1", sortOrder: 1 },
        { id: "a2", key: "a2", text: "Term A2", sortOrder: 2 },
      ],
    },
    {
      sortOrder: 2,
      label: "B",
      title: "Agreement",
      prompt: "Prompt B",
      scaleKey: "agreement",
      statements: [{ id: "b1", key: "b1", text: "Statement B1", sortOrder: 1 }],
    },
  ];

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
    round: { title: "Round", roundNumber: 1, submittedCount: 0 },
    sections,
    scaleOptions,
    counts: [],
  };

  const { slides } = buildSlides(input);

  test("buildDeckSteps: familiarity statement slides reveal in one step; every other results slide stays two-step", () => {
    expect(slides.map((s) => s.kind)).toEqual([
      "title",
      "section-intro",
      "statement",
      "statement",
      "familiarity-overview",
      "section-intro",
      "statement",
    ]);

    const steps = buildDeckSteps(slides);
    expect(steps).toHaveLength(9);

    // The two familiarity statement slides (indices 2, 3) appear exactly
    // once each, revealed: true.
    for (const familiarityIndex of [2, 3]) {
      const matching = steps.filter((st) => st.slideIndex === familiarityIndex);
      expect(matching).toEqual([{ slideIndex: familiarityIndex, revealed: true }]);
    }

    // The agreement statement slide (index 6) appears twice: false then true.
    const agreementSteps = steps.filter((st) => st.slideIndex === 6);
    expect(agreementSteps).toEqual([
      { slideIndex: 6, revealed: false },
      { slideIndex: 6, revealed: true },
    ]);

    // The familiarity-overview (index 4) appears twice: false then true.
    const overviewSteps = steps.filter((st) => st.slideIndex === 4);
    expect(overviewSteps).toEqual([
      { slideIndex: 4, revealed: false },
      { slideIndex: 4, revealed: true },
    ]);

    // title (0) and section-intro (1, 5) slides appear once each, revealed: true.
    for (const onceIndex of [0, 1, 5]) {
      const matching = steps.filter((st) => st.slideIndex === onceIndex);
      expect(matching).toEqual([{ slideIndex: onceIndex, revealed: true }]);
    }
  });

  test("buildSectionHeadings: same length as slides, title null, every other slide in a section carries that section's heading", () => {
    const headings = buildSectionHeadings(slides);
    expect(headings).toHaveLength(slides.length);
    expect(headings[0]).toBeNull();

    const headingA = {
      label: "A",
      title: "Familiarity",
      parentLabel: null,
      parentTitle: null,
    };
    for (const i of [1, 2, 3, 4]) {
      expect(headings[i]).toEqual(headingA);
    }

    const headingB = {
      label: "B",
      title: "Agreement",
      parentLabel: null,
      parentTitle: null,
    };
    for (const i of [5, 6]) {
      expect(headings[i]).toEqual(headingB);
    }
  });

  test("buildSectionHeadings: a subsection label like '2a' with a parentTitle produces parentLabel '2' on its intro and statement slides", () => {
    const subSections: PresentationInput["sections"] = [
      {
        sortOrder: 1,
        label: "2a",
        parentTitle: "What is design?",
        title: "Sub",
        prompt: "P",
        scaleKey: "agreement",
        statements: [{ id: "x1", key: "x1", text: "X1", sortOrder: 1 }],
      },
    ];
    const subInput: PresentationInput = {
      round: { title: "Round", roundNumber: 1, submittedCount: 0 },
      sections: subSections,
      scaleOptions: [1, 2, 3, 4, 5].map((v) => ({
        scaleKey: "agreement",
        value: v,
        label: AGREEMENT_LABELS[v],
      })),
      counts: [],
    };
    const { slides: subSlides } = buildSlides(subInput);
    // title, section-intro, statement
    expect(subSlides.map((s) => s.kind)).toEqual([
      "title",
      "section-intro",
      "statement",
    ]);
    const subHeadings = buildSectionHeadings(subSlides);
    const expected = {
      label: "2a",
      title: "Sub",
      parentLabel: "2",
      parentTitle: "What is design?",
    };
    expect(subHeadings[1]).toEqual(expected);
    expect(subHeadings[2]).toEqual(expected);
  });
});

test.describe("rating overview — @static (no DB)", () => {
  // Plain rating-statement fixture helper. Rating statements read counts
  // from `counts`, not scale_options, so no options array is needed.
  function ratingStatement(
    key: string,
    sortOrder: number
  ): PresentationInput["sections"][number]["statements"][number] {
    return { id: key, key, text: `Statement ${key}`, sortOrder, kind: "rating" };
  }

  test("buildSlides: show_overview section produces a ranked rating-overview slide after its rating statements", () => {
    const sections: PresentationInput["sections"] = [
      {
        sortOrder: 3,
        label: "C",
        title: "When trust is broken",
        prompt: "P",
        scaleKey: "agreement",
        showOverview: true,
        statements: [
          ratingStatement("r1", 1),
          ratingStatement("r2", 2),
          ratingStatement("r3", 3),
          ratingStatement("r4", 4),
          ratingStatement("r5", 5),
          ratingStatement("r6", 6),
        ],
      },
    ];
    const input: PresentationInput = {
      round: { title: "R", roundNumber: 1, submittedCount: 0 },
      sections,
      scaleOptions: [],
      counts: [
        { statementId: "r1", value: 2, count: 2 },
        { statementId: "r2", value: 8, count: 1 },
        { statementId: "r2", value: 9, count: 1 },
        { statementId: "r3", value: 0, count: 3 },
        { statementId: "r5", value: 4, count: 1 },
        { statementId: "r6", value: 4, count: 2 },
      ],
    };
    const { slides } = buildSlides(input);
    expect(slides.map((s) => s.kind)).toEqual([
      "title",
      "section-intro",
      "rating",
      "rating",
      "rating",
      "rating",
      "rating",
      "rating",
      "rating-overview",
    ]);
    const overview = slides[slides.length - 1];
    if (overview.kind !== "rating-overview") {
      throw new Error("expected a trailing rating-overview slide");
    }
    expect(overview.items.map((i) => i.statementKey)).toEqual([
      "r2",
      "r5",
      "r6",
      "r1",
      "r3",
      "r4",
    ]);
    expect(overview.items.map((i) => i.average)).toEqual([8.5, 4, 4, 2, 0, null]);
    expect(overview.items.map((i) => i.n)).toEqual([2, 1, 2, 2, 3, 0]);
    expect(overview.sectionLabel).toBe("C");
    expect(overview.sectionTitle).toBe("When trust is broken");
    expect(overview.sectionSortOrder).toBe(3);
    expect(overview.respondentCount).toBe(3);

    // Every item's average equals the average on its own rating slide.
    const ratingSlides = slides.filter((s) => s.kind === "rating");
    for (const item of overview.items) {
      const own = ratingSlides.find(
        (s) => s.kind === "rating" && s.statementKey === item.statementKey
      );
      expect(own && own.kind === "rating" ? own.average : undefined).toBe(
        item.average
      );
    }
  });

  test("buildSlides: no showOverview flag (absent or false) produces no rating-overview slide", () => {
    const baseSection = {
      sortOrder: 3,
      label: "C",
      title: "When trust is broken",
      prompt: "P",
      scaleKey: "agreement",
      statements: [ratingStatement("r1", 1)],
    };
    const inputAbsent: PresentationInput = {
      round: { title: "R", roundNumber: 1, submittedCount: 0 },
      sections: [baseSection],
      scaleOptions: [],
      counts: [],
    };
    expect(
      buildSlides(inputAbsent).slides.some((s) => s.kind === "rating-overview")
    ).toBe(false);

    const inputFalse: PresentationInput = {
      round: { title: "R", roundNumber: 1, submittedCount: 0 },
      sections: [{ ...baseSection, showOverview: false }],
      scaleOptions: [],
      counts: [],
    };
    expect(
      buildSlides(inputFalse).slides.some((s) => s.kind === "rating-overview")
    ).toBe(false);
  });

  test("buildSlides: showOverview gates are independent per scale and ignore non-rating statements", () => {
    const familiaritySection: PresentationInput["sections"][number] = {
      sortOrder: 1,
      label: "A",
      title: "Familiarity",
      prompt: "P",
      scaleKey: "familiarity",
      showOverview: true,
      statements: [
        { id: "f1", key: "f1", text: "Term 1", sortOrder: 1 },
        { id: "f2", key: "f2", text: "Term 2", sortOrder: 2 },
      ],
    };
    const familiarityScaleOptions: PresentationInput["scaleOptions"] = [1, 2, 3, 4].map(
      (v) => ({ scaleKey: "familiarity", value: v, label: FAMILIARITY_LABELS[v] })
    );
    const familiarityInput: PresentationInput = {
      round: { title: "R", roundNumber: 1, submittedCount: 0 },
      sections: [familiaritySection],
      scaleOptions: familiarityScaleOptions,
      counts: [],
    };
    const familiarityResult = buildSlides(familiarityInput);
    expect(
      familiarityResult.slides.filter((s) => s.kind === "familiarity-overview")
    ).toHaveLength(1);
    expect(
      familiarityResult.slides.filter((s) => s.kind === "rating-overview")
    ).toHaveLength(0);

    const mixedSection: PresentationInput["sections"][number] = {
      sortOrder: 3,
      label: "C",
      title: "When trust is broken",
      prompt: "P",
      scaleKey: "agreement",
      showOverview: true,
      statements: [
        ratingStatement("r1", 1),
        ratingStatement("r2", 2),
        {
          id: "c1",
          key: "c1",
          text: "Choice",
          sortOrder: 3,
          kind: "choice_one",
          options: [{ value: 1, label: "Yes" }],
        },
      ],
    };
    const mixedInput: PresentationInput = {
      round: { title: "R", roundNumber: 1, submittedCount: 0 },
      sections: [mixedSection],
      scaleOptions: [],
      counts: [],
      choiceCounts: [],
    };
    const mixedResult = buildSlides(mixedInput);
    const mixedOverview = mixedResult.slides.find(
      (s) => s.kind === "rating-overview"
    );
    if (!mixedOverview || mixedOverview.kind !== "rating-overview") {
      throw new Error("expected a rating-overview slide");
    }
    expect(mixedOverview.items.map((i) => i.statementKey)).toEqual(["r1", "r2"]);
  });

  test("buildSlides: an all-zero-respondent show_overview section shows every item at n 0 / average null, in sortOrder, independent of other sections' answers", () => {
    const sectionB: PresentationInput["sections"][number] = {
      sortOrder: 2,
      label: "B",
      title: "Section B",
      prompt: "P",
      scaleKey: "agreement",
      statements: [ratingStatement("b1", 1)],
    };
    const sectionE: PresentationInput["sections"][number] = {
      sortOrder: 5,
      label: "E",
      title: "How scepticism affects me",
      prompt: "P",
      scaleKey: "agreement",
      showOverview: true,
      statements: [
        ratingStatement("e1", 1),
        ratingStatement("e2", 2),
        ratingStatement("e3", 3),
      ],
    };
    const input: PresentationInput = {
      round: { title: "R", roundNumber: 1, submittedCount: 0 },
      sections: [sectionB, sectionE],
      scaleOptions: [],
      counts: [{ statementId: "b1", value: 7, count: 4 }],
    };
    const { slides } = buildSlides(input);
    const titleSlide = slides[0];
    if (titleSlide.kind !== "title") {
      throw new Error("expected a title slide");
    }
    expect(titleSlide.respondentCount).toBe(4);

    const overview = slides.find((s) => s.kind === "rating-overview");
    if (!overview || overview.kind !== "rating-overview") {
      throw new Error("expected a rating-overview slide for E");
    }
    expect(overview.respondentCount).toBe(0);
    expect(overview.items.map((i) => i.statementKey)).toEqual(["e1", "e2", "e3"]);
    expect(overview.items.every((i) => i.n === 0)).toBe(true);
    expect(overview.items.every((i) => i.average === null)).toBe(true);
  });

  test("buildDeckSteps/buildSectionHeadings: the rating-overview slide stays two-step and inherits its section's heading", () => {
    const sections: PresentationInput["sections"] = [
      {
        sortOrder: 3,
        label: "C",
        title: "When trust is broken",
        prompt: "P",
        scaleKey: "agreement",
        showOverview: true,
        statements: [
          ratingStatement("r1", 1),
          ratingStatement("r2", 2),
          ratingStatement("r3", 3),
          ratingStatement("r4", 4),
          ratingStatement("r5", 5),
          ratingStatement("r6", 6),
        ],
      },
    ];
    const input: PresentationInput = {
      round: { title: "R", roundNumber: 1, submittedCount: 0 },
      sections,
      scaleOptions: [],
      counts: [
        { statementId: "r1", value: 2, count: 2 },
        { statementId: "r2", value: 8, count: 1 },
        { statementId: "r2", value: 9, count: 1 },
        { statementId: "r3", value: 0, count: 3 },
        { statementId: "r5", value: 4, count: 1 },
        { statementId: "r6", value: 4, count: 2 },
      ],
    };
    const { slides } = buildSlides(input);
    const overviewIndex = slides.findIndex((s) => s.kind === "rating-overview");
    expect(overviewIndex).toBeGreaterThan(-1);

    const steps = buildDeckSteps(slides);
    const overviewSteps = steps.filter((st) => st.slideIndex === overviewIndex);
    expect(overviewSteps).toEqual([
      { slideIndex: overviewIndex, revealed: false },
      { slideIndex: overviewIndex, revealed: true },
    ]);
    for (let i = 2; i <= 7; i += 1) {
      const ratingSteps = steps.filter((st) => st.slideIndex === i);
      expect(ratingSteps).toEqual([
        { slideIndex: i, revealed: false },
        { slideIndex: i, revealed: true },
      ]);
    }

    const headings = buildSectionHeadings(slides);
    expect(headings[overviewIndex]).toEqual({
      label: "C",
      title: "When trust is broken",
      parentLabel: null,
      parentTitle: null,
    });
  });
});
