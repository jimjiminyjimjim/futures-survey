import { test, expect } from "@playwright/test";
import {
  QUESTION_KINDS,
  isListKind,
  isRankingKind,
  storesChoiceValues,
  normaliseAnswer,
  toggleRank,
  moveRank,
  type AnswerRuleQuestion,
  type ChoiceOption,
} from "@/lib/survey/answer-rules";
import {
  buildSectionSummaries,
  countQuestions,
  displayLabel,
  parentSectionHeading,
  resolveSectionScreen,
  resolveStatementNav,
  sectionHeading,
  visibleSectionPrompt,
} from "@/lib/survey/state";

/**
 * Pure proofs for the participant side of the Session 2 ranking kind
 * (quick task 261117-eak): the answer rules, the tap/move helpers and the
 * small state helpers used by the section/statement pages. No DB.
 */

const OPTIONS: ChoiceOption[] = [1, 2, 3].map((value) => ({
  value,
  label: `Item ${value}`,
  exclusive: false,
}));

const RANKING: AnswerRuleQuestion = {
  kind: "ranking",
  options: OPTIONS,
  choiceCount: null,
};

test.describe("session 2 ranking — @static (no DB)", () => {
  test("QUESTION_KINDS includes ranking; it stores choice values but is not a sorted list kind", () => {
    expect(QUESTION_KINDS).toContain("ranking");
    expect(isRankingKind("ranking")).toBe(true);
    expect(isListKind("ranking")).toBe(false);
    expect(storesChoiceValues("ranking")).toBe(true);
    expect(storesChoiceValues("choice_multi")).toBe(true);
    expect(storesChoiceValues("choice_exact")).toBe(true);
    expect(storesChoiceValues("choice_up_to")).toBe(true);
    expect(storesChoiceValues("scale")).toBe(false);
    expect(storesChoiceValues("rating")).toBe(false);
  });

  test("normaliseAnswer keeps a full ranking in the participant's order (never sorted)", () => {
    expect(normaliseAnswer(RANKING, { choiceValues: [3, 1, 2] })).toEqual({
      value: null,
      choiceValues: [3, 1, 2],
    });
    expect(normaliseAnswer(RANKING, { choiceValues: [1, 2, 3] })).toEqual({
      value: null,
      choiceValues: [1, 2, 3],
    });
  });

  test("normaliseAnswer refuses partial, duplicate, unknown, value and empty rankings", () => {
    expect(normaliseAnswer(RANKING, { choiceValues: [3, 1] })).toBeNull();
    expect(normaliseAnswer(RANKING, { choiceValues: [1, 1, 2] })).toBeNull();
    expect(normaliseAnswer(RANKING, { choiceValues: [1, 2, 9] })).toBeNull();
    expect(normaliseAnswer(RANKING, { value: 2 })).toBeNull();
    expect(
      normaliseAnswer(RANKING, { value: 2, choiceValues: [1, 2, 3] })
    ).toBeNull();
    expect(normaliseAnswer(RANKING, { choiceValues: [] })).toBeNull();
    expect(normaliseAnswer(RANKING, {})).toBeNull();
    expect(normaliseAnswer(RANKING, { choiceValues: [1, 2, 3, 3] })).toBeNull();
  });

  test("the list kinds still sort (ranking's no-sort rule did not leak into them)", () => {
    const multi: AnswerRuleQuestion = {
      kind: "choice_multi",
      options: OPTIONS,
      choiceCount: null,
    };
    expect(normaliseAnswer(multi, { choiceValues: [3, 1] })).toEqual({
      value: null,
      choiceValues: [1, 3],
    });
  });

  test("toggleRank: tap ranks next, tap again removes and later ranks close up", () => {
    expect(toggleRank([], 2)).toEqual([2]);
    expect(toggleRank([2], 3)).toEqual([2, 3]);
    expect(toggleRank([2, 3], 2)).toEqual([3]);
    expect(toggleRank([1, 2, 3], 2)).toEqual([1, 3]);
  });

  test("moveRank: swaps with the neighbour, no-op at the edges or when unranked", () => {
    expect(moveRank([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveRank([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    expect(moveRank([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
    expect(moveRank([1, 2, 3], 3, 1)).toEqual([1, 2, 3]);
    expect(moveRank([1, 2], 3, 1)).toEqual([1, 2]);
    // Never mutates its input.
    const input = [1, 2, 3];
    moveRank(input, 2, -1);
    expect(input).toEqual([1, 2, 3]);
  });

  test("parentSectionHeading: numeric parents, letter+digit parents, bare letters, no parent title", () => {
    expect(parentSectionHeading("B1", "In a world of AI")).toBe(
      "B. In a world of AI"
    );
    expect(parentSectionHeading("B2", "In a world of AI")).toBe(
      "B. In a world of AI"
    );
    expect(parentSectionHeading("11a", "X")).toBe("11. X");
    expect(parentSectionHeading("2a", "What is design?")).toBe(
      "2. What is design?"
    );
    expect(parentSectionHeading("A", "X")).toBe("X");
    expect(parentSectionHeading(null, "X")).toBe("X");
    expect(parentSectionHeading("B1", null)).toBeNull();
    expect(parentSectionHeading("11a", null)).toBeNull();
    expect(parentSectionHeading(null, null)).toBeNull();
  });

  test("visibleSectionPrompt: hides a prompt that only repeats the title", () => {
    expect(
      visibleSectionPrompt("Hard to focus", "  Hard to focus ")
    ).toBeNull();
    expect(
      visibleSectionPrompt("Grades, learning and me", "How much do you agree?")
    ).toBe("How much do you agree?");
  });

  test("sectionHeading / displayLabel: B1 and B2 both read as 'B.'; other labels unchanged", () => {
    expect(sectionHeading("B1", "In a world of AI, what will matter most for designers?")).toBe(
      "B. In a world of AI, what will matter most for designers?"
    );
    expect(sectionHeading("B2", "Learning for a world with AI")).toBe(
      "B. Learning for a world with AI"
    );
    expect(sectionHeading("A", "T")).toBe("A. T");
    expect(sectionHeading("2a", "T")).toBe("2a. T");
    expect(sectionHeading(null, "T")).toBe("T");
    expect(displayLabel("B1")).toBe("B");
    expect(displayLabel("C")).toBe("C");
    expect(displayLabel(null)).toBeNull();
  });

  test("question numbering: B1 and B2 are one question (8 questions for Session 2's 9 sections)", () => {
    const labels = ["A", "B1", "B2", "C", "D", "E", "F", "G", "H"];
    const statements = labels.map((label) => ({
      key: `k_${label}`,
      sectionId: `sec-${label}`,
      sectionTitle: `Title ${label}`,
      sectionPrompt: `Prompt ${label}`,
      sectionLabel: label,
    }));
    const sections = buildSectionSummaries(statements);
    expect(sections).toHaveLength(9);
    expect(sections.map((s) => s.questionNumber)).toEqual([1, 2, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(sections.map((s) => s.totalQuestions))).toEqual(new Set([8]));
    expect(countQuestions(sections)).toBe(8);

    // The section-break eyebrow data: B1 and B2 both "Question 2 of 8".
    const b1 = resolveSectionScreen(sections, 2)!;
    const b2 = resolveSectionScreen(sections, 3)!;
    expect([b1.questionNumber, b1.totalQuestions]).toEqual([2, 8]);
    expect([b2.questionNumber, b2.totalQuestions]).toEqual([2, 8]);
    expect(b2.sectionNumber).toBe(3); // navigation still steps through every section
    const nav = resolveStatementNav(sections, "k_B2")!;
    expect([nav.position.questionNumber, nav.position.totalQuestions]).toEqual([2, 8]);
    expect(nav.position.totalSections).toBe(9);
  });

  test("question numbering is unchanged where nothing is split (Session 1 style, numeric 2a/2b, unlabelled)", () => {
    const make = (labels: (string | null)[]) =>
      buildSectionSummaries(
        labels.map((label, i) => ({
          key: `k${i}`,
          sectionId: `s${i}`,
          sectionTitle: "T",
          sectionPrompt: "P",
          sectionLabel: label,
        }))
      );
    for (const labels of [
      ["A", "B", "C", "D", "E", "F"],
      ["1", "2a", "2b", "3"],
      [null, null, null],
    ]) {
      const sections = make(labels);
      expect(sections.map((s) => s.questionNumber)).toEqual(
        sections.map((s) => s.sectionNumber)
      );
      expect(countQuestions(sections)).toBe(labels.length);
    }
  });
});
