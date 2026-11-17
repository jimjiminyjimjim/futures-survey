import { test, expect } from "@playwright/test";
import {
  meanRank,
  rankScorePercent,
  rankPoints,
  rankByMeanRank,
  rankPositions,
} from "@/lib/presentation/chart-math";
import {
  buildSlides,
  buildDeckSteps,
  buildSectionHeadings,
} from "@/lib/presentation/build-slides";
import type {
  PresentationInput,
  PresentationSection,
  PresentationStatement,
  Slide,
} from "@/lib/presentation/types";
import { QUESTION_KINDS, type QuestionKind } from "@/lib/survey/answer-rules";
import { toRoundCsv } from "@/lib/admin/csv";
import {
  hasParticipantAnswer,
  pivotResponses,
  type ParticipantResponse,
} from "@/lib/admin/responses";

/**
 * Pure proofs for Session 2's presentation, CSV and responses-table support
 * (quick task 261117-eak). No DB. The Session 1 byte-identity proof lives in
 * session-1-regression.spec.ts.
 */

const AGREEMENT = [1, 2, 3, 4, 5].map((value) => ({
  scaleKey: "agreement",
  value,
  label: `Agreement ${value}`,
}));
const IMPORTANCE = [
  "Much less important",
  "Less important",
  "About the same",
  "More important",
  "Much more important than today",
].map((label, i) => ({ scaleKey: "importance_change", value: i + 1, label }));

const RANK_OPTIONS = [
  { value: 1, label: "Alpha" },
  { value: 2, label: "Beta" },
  { value: 3, label: "Gamma" },
];

function rankingStatement(id: string, key: string): PresentationStatement {
  return {
    id,
    key,
    text: "Rank from most to least important.",
    sortOrder: 1,
    kind: "ranking",
    options: RANK_OPTIONS,
  };
}

/**
 * 3 respondents ranked Alpha/Beta/Gamma: orders [1,2,3], [1,3,2], [2,1,3].
 * Alpha: positions 1,1,2 (sum 4); Beta: 2,3,1 (sum 6); Gamma: 3,2,3 (sum 8).
 */
function rankStatsFor(statementId: string) {
  return [
    { value: 1, label: "Alpha", rankSum: 4, firstCount: 2 },
    { value: 2, label: "Beta", rankSum: 6, firstCount: 1 },
    { value: 3, label: "Gamma", rankSum: 8, firstCount: 0 },
  ].map((r) => ({
    statementId,
    respondentCount: 3,
    rankedCount: 3,
    ...r,
  }));
}

function rankingInput(showOverview: boolean): PresentationInput {
  const sections: PresentationSection[] = [
    {
      sortOrder: 1,
      label: "A",
      title: "What do employers value?",
      prompt: "Rank from most to least important.",
      scaleKey: "agreement",
      showOverview,
      statements: [rankingStatement("r1", "s2_a_01")],
    },
  ];
  return {
    round: { title: "Session 2", roundNumber: 2, submittedCount: 3 },
    sections,
    scaleOptions: AGREEMENT,
    counts: [],
    rankStats: rankStatsFor("r1"),
  };
}

test.describe("session 2 presentation — @static (no DB)", () => {
  test("meanRank / rankScorePercent / rankPoints", () => {
    expect(meanRank(7, 3)).toBe(2.3);
    expect(meanRank(0, 0)).toBeNull();
    // Everyone ranked it first (n respondents, m items): 100. Last: 0.
    expect(rankScorePercent(5, 5, 4)).toBe(100);
    expect(rankScorePercent(4 * 5, 5, 4)).toBe(0);
    expect(rankScorePercent(0, 0, 4)).toBe(0);
    expect(rankScorePercent(3, 3, 1)).toBe(0);
    expect(rankPoints(4, 3, 3)).toBe(5);
  });

  test("rankByMeanRank: exact tie handling, first-place then value tiebreak, unranked last", () => {
    // 7/3 and 14/6 are the same mean: a floating-point compare could split them.
    const items = [
      { value: 3, rankSum: 14, rankedCount: 6, firstCount: 1 },
      { value: 4, rankSum: 0, rankedCount: 0, firstCount: 0 },
      { value: 2, rankSum: 7, rankedCount: 3, firstCount: 2 },
      { value: 1, rankSum: 7, rankedCount: 3, firstCount: 2 },
      { value: 5, rankSum: 5, rankedCount: 3, firstCount: 0 },
    ];
    expect(rankByMeanRank(items).map((i) => i.value)).toEqual([5, 1, 2, 3, 4]);
    // Input is not mutated.
    expect(items.map((i) => i.value)).toEqual([3, 4, 2, 1, 5]);
  });

  test("ranking in a non-overview section gives one 'bars' slide with ranked aggregate items", () => {
    const { slides, respondentCount } = buildSlides(rankingInput(false));
    expect(respondentCount).toBe(3);
    const ranking = slides.filter((s) => s.kind === "ranking");
    expect(ranking).toHaveLength(1);
    const slide = ranking[0] as Extract<Slide, { kind: "ranking" }>;
    expect(slide.display).toBe("bars");
    expect(slide.statementKey).toBe("s2_a_01");
    expect(slide.respondentCount).toBe(3);
    expect(slide.items.map((i) => i.label)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(slide.items[0]).toMatchObject({
      value: 1,
      meanRank: 1.3,
      firstCount: 2,
      firstPercent: 67,
      points: 5,
      scorePercent: 83,
    });
    // The title slide's count comes from the ranking's respondents.
    expect(slides[0]).toMatchObject({ kind: "title", respondentCount: 3 });
  });

  test("ranking in a show_overview section gives display 'list'", () => {
    const { slides } = buildSlides(rankingInput(true));
    const slide = slides.find((s) => s.kind === "ranking") as Extract<
      Slide,
      { kind: "ranking" }
    >;
    expect(slide.display).toBe("list");
    // No rating-overview slide: the section has no rating statements.
    expect(slides.some((s) => s.kind === "rating-overview")).toBe(false);
  });

  test("ranking items carry aggregate fields only (no respondent or ordering data)", () => {
    const { slides } = buildSlides(rankingInput(false));
    const slide = slides.find((s) => s.kind === "ranking") as Extract<
      Slide,
      { kind: "ranking" }
    >;
    for (const item of slide.items) {
      expect(Object.keys(item).sort()).toEqual(
        [
          "firstCount",
          "firstPercent",
          "label",
          "meanRank",
          "points",
          "position",
          "rankSum",
          "rankedCount",
          "scorePercent",
          "value",
        ].sort()
      );
    }
    expect(JSON.stringify(slide)).not.toMatch(/user|email|response_id/i);
  });

  test("a ranking slide is two-step and inherits its section's heading", () => {
    const { slides } = buildSlides(rankingInput(false));
    const steps = buildDeckSteps(slides);
    const index = slides.findIndex((s) => s.kind === "ranking");
    expect(steps.filter((s) => s.slideIndex === index)).toEqual([
      { slideIndex: index, revealed: false },
      { slideIndex: index, revealed: true },
    ]);
    const headings = buildSectionHeadings(slides);
    expect(headings[index]).toMatchObject({
      label: "A",
      title: "What do employers value?",
    });
  });

  test("a ranking with no stats loaded falls back to its own options at zero", () => {
    const input = rankingInput(false);
    delete input.rankStats;
    const { slides, respondentCount } = buildSlides(input);
    const slide = slides.find((s) => s.kind === "ranking") as Extract<
      Slide,
      { kind: "ranking" }
    >;
    expect(respondentCount).toBe(0);
    expect(slide.respondentCount).toBe(0);
    expect(slide.items).toHaveLength(3);
    expect(slide.items.every((i) => i.meanRank === null)).toBe(true);
  });

  test("importance_change sections give two-step statement slides with the 5 options in value order", () => {
    const input: PresentationInput = {
      round: { title: "Session 2", roundNumber: 2, submittedCount: 4 },
      sections: [
        {
          sortOrder: 1,
          label: "B2",
          parentTitle: "In a world of AI",
          title: "Learning for a world with AI",
          prompt: "How important will it be to learn each of these?",
          scaleKey: "importance_change",
          statements: [
            { id: "b1", key: "s2_b2_01", text: "Imagination", sortOrder: 1, kind: "scale" },
            { id: "b2", key: "s2_b2_02", text: "Responsibility", sortOrder: 2, kind: "scale" },
          ],
        },
      ],
      // Deliberately out of value order.
      scaleOptions: [...IMPORTANCE].reverse(),
      counts: [
        { statementId: "b1", value: 4, count: 3 },
        { statementId: "b1", value: 5, count: 1 },
      ],
    };
    const { slides } = buildSlides(input);
    const statements = slides.filter((s) => s.kind === "statement") as Extract<
      Slide,
      { kind: "statement" }
    >[];
    expect(statements).toHaveLength(2);
    expect(statements[0].scaleKey).toBe("importance_change");
    expect(statements[0].options.map((o) => o.value)).toEqual([1, 2, 3, 4, 5]);
    expect(statements[0].options.map((o) => o.label)).toEqual(
      IMPORTANCE.map((o) => o.label)
    );
    expect(statements[0].respondentCount).toBe(4);
    const steps = buildDeckSteps(slides);
    const idx = slides.indexOf(statements[0]);
    expect(steps.filter((s) => s.slideIndex === idx).map((s) => s.revealed)).toEqual([
      false,
      true,
    ]);
    const headings = buildSectionHeadings(slides);
    // B2 reads as "B" (two parts of one question); the parent line still
    // works for content that has a parent title.
    expect(headings[idx]).toMatchObject({
      label: "B",
      parentLabel: "B",
      parentTitle: "In a world of AI",
    });
  });

  test("an unknown scale key still throws", () => {
    const input = rankingInput(false);
    input.sections[0].scaleKey = "mystery";
    expect(() => buildSlides(input)).toThrow(/unknown scale key "mystery"/);
  });

  test("a section whose prompt only repeats its title gives its rating slides no lead-in", () => {
    const input: PresentationInput = {
      round: { title: "Session 2", roundNumber: 2, submittedCount: 1 },
      sections: [
        {
          sortOrder: 1,
          label: "D",
          title: "What makes it hard to focus on the learning?",
          prompt: "What makes it hard to focus on the learning?",
          scaleKey: "agreement",
          showOverview: true,
          statements: [
            {
              id: "d1",
              key: "s2_d_01",
              text: "Chasing the grade",
              sortOrder: 1,
              kind: "rating",
              leftLabel: "Does not affect me",
              rightLabel: "Affects me",
            },
          ],
        },
        {
          sortOrder: 2,
          label: "F",
          title: "When I don’t know what to do",
          prompt: "You’re working on a project… How do you usually respond?",
          scaleKey: "agreement",
          statements: [
            {
              id: "f1",
              key: "s2_f_01",
              text: "I keep researching",
              sortOrder: 1,
              kind: "rating",
              leftLabel: "I tend not to do this",
              rightLabel: "I tend to do this",
            },
          ],
        },
      ],
      scaleOptions: AGREEMENT,
      counts: [],
    };
    const { slides } = buildSlides(input);
    const ratings = slides.filter((s) => s.kind === "rating") as Extract<
      Slide,
      { kind: "rating" }
    >[];
    expect(ratings.find((s) => s.statementKey === "s2_d_01")?.leadIn).toBeNull();
    expect(ratings.find((s) => s.statementKey === "s2_f_01")?.leadIn).toBe(
      "You’re working on a project… How do you usually respond?"
    );
    // D is show_overview: it still gets its rating-overview slide.
    expect(slides.some((s) => s.kind === "rating-overview")).toBe(true);
  });

  test("one statement of every QUESTION_KINDS kind gives at least one slide per statement", () => {
    const kinds = [...QUESTION_KINDS] as QuestionKind[];
    const statements: PresentationStatement[] = kinds.map((kind, i) => {
      const base: PresentationStatement = {
        id: `id-${kind}`,
        key: `k_${kind}`,
        text: `A ${kind} statement`,
        sortOrder: i + 1,
        kind,
      };
      if (kind === "rating" || kind === "two_ended") {
        return { ...base, leftLabel: "Low", rightLabel: "High" };
      }
      if (
        kind === "choice_one" ||
        kind === "choice_multi" ||
        kind === "choice_exact" ||
        kind === "choice_up_to" ||
        kind === "ranking"
      ) {
        return {
          ...base,
          options: RANK_OPTIONS,
          choiceCount: kind === "choice_exact" || kind === "choice_up_to" ? 2 : null,
        };
      }
      return base;
    });
    const input: PresentationInput = {
      round: { title: "All kinds", roundNumber: 9, submittedCount: 0 },
      sections: [
        {
          sortOrder: 1,
          label: "A",
          title: "Everything",
          prompt: "Everything",
          scaleKey: "agreement",
          statements,
        },
      ],
      scaleOptions: AGREEMENT,
      counts: [],
    };
    const { slides } = buildSlides(input);
    for (const statement of statements) {
      const covered = slides.some(
        (s) => "statementKey" in s && s.statementKey === statement.key
      );
      expect(covered, `${statement.kind} has a slide`).toBe(true);
    }
  });

  test("CSV: a ranking cell is '1. X > 2. Y > 3. Z' in stored order; blank when unanswered", () => {
    const rows = [
      {
        response_id: "r1",
        user_email: "a@example.test",
        started_at: "2026-11-20T10:00:00.000Z",
        submitted_at: "2026-11-20T10:05:00.000Z",
        statement_key: "s2_a_01",
        value: null,
        choice_values: [3, 1, 2],
      },
      {
        response_id: "r2",
        user_email: "b@example.test",
        started_at: "2026-11-20T10:00:00.000Z",
        submitted_at: null,
        statement_key: null,
        value: null,
        choice_values: null,
      },
    ];
    const participants = pivotResponses(rows);
    // Stored order survives the pivot.
    expect(participants[0].choiceAnswers?.s2_a_01).toEqual([3, 1, 2]);
    const csv = toRoundCsv(participants, [
      {
        key: "s2_a_01",
        kind: "ranking",
        options: [
          { value: 1, label: "X", exclusive: false },
          { value: 2, label: "Y", exclusive: false },
          { value: 3, label: "Z", exclusive: false },
        ],
      },
    ]);
    expect(csv).toBe(
      [
        "email,started_at,submitted_at,s2_a_01",
        "a@example.test,2026-11-20T10:00:00.000Z,2026-11-20T10:05:00.000Z,1. Z > 2. X > 3. Y",
        "b@example.test,2026-11-20T10:00:00.000Z,,",
        "",
      ].join("\r\n")
    );
    // An unknown option value falls back to the raw number.
    const odd = toRoundCsv(
      pivotResponses([{ ...rows[0], choice_values: [9, 1] }]),
      [{ key: "s2_a_01", kind: "ranking", options: [{ value: 1, label: "X", exclusive: false }] }]
    );
    expect(odd).toContain("1. 9 > 2. X");
  });

  test("responses table: a non-empty ranking counts as answered", () => {
    const participant: ParticipantResponse = {
      responseId: "r1",
      email: "a@example.test",
      startedAt: "2026-11-20T10:00:00.000Z",
      submittedAt: null,
      answers: {},
      choiceAnswers: { s2_a_01: [2, 1, 3] },
      answeredCount: 1,
    };
    expect(hasParticipantAnswer(participant, { key: "s2_a_01", kind: "ranking" })).toBe(true);
    expect(hasParticipantAnswer(participant, { key: "s2_h_01", kind: "ranking" })).toBe(false);
    expect(hasParticipantAnswer(participant, { key: "s2_a_01", kind: "choice_multi" })).toBe(true);
    expect(hasParticipantAnswer(participant, { key: "s2_e_01", kind: "scale" })).toBe(false);
  });

  test("section labels: B1 and B2 both read as 'B' in the deck; other labels are unchanged", () => {
    const section = (sortOrder: number, label: string): PresentationSection => ({
      sortOrder,
      label,
      title: `Title ${label}`,
      prompt: `Prompt ${label}`,
      scaleKey: "agreement",
      statements: [
        { id: `id-${label}`, key: `k_${label}`, text: "T", sortOrder: 1, kind: "scale" },
      ],
    });
    const { slides } = buildSlides({
      round: { title: "R", roundNumber: 2, submittedCount: 0 },
      sections: [section(1, "A"), section(2, "B1"), section(3, "B2"), section(4, "2a")],
      scaleOptions: AGREEMENT,
      counts: [],
    });
    const intros = slides.filter((s) => s.kind === "section-intro") as Extract<
      Slide,
      { kind: "section-intro" }
    >[];
    expect(intros.map((s) => s.label)).toEqual(["A", "B", "B", "2a"]);
    const statementSlides = slides.filter((s) => s.kind === "statement") as Extract<
      Slide,
      { kind: "statement" }
    >[];
    expect(statementSlides.map((s) => s.sectionLabel)).toEqual(["A", "B", "B", "2a"]);
  });

  test("rankPositions: exactly tied items share a position (1, 1, 3); unranked items tie last", () => {
    // Alpha and Beta: identical mean (7/3 == 14/6) and identical first count.
    const items = rankByMeanRank([
      { value: 1, rankSum: 7, rankedCount: 3, firstCount: 1 },
      { value: 2, rankSum: 14, rankedCount: 6, firstCount: 1 },
      { value: 3, rankSum: 9, rankedCount: 3, firstCount: 0 },
      { value: 4, rankSum: 0, rankedCount: 0, firstCount: 0 },
      { value: 5, rankSum: 0, rankedCount: 0, firstCount: 0 },
    ]);
    expect(items.map((i) => i.value)).toEqual([1, 2, 3, 4, 5]);
    expect(rankPositions(items)).toEqual([1, 1, 3, 4, 4]);
    // Same mean but a different first-place count is NOT a tie.
    const notTied = rankByMeanRank([
      { value: 1, rankSum: 7, rankedCount: 3, firstCount: 2 },
      { value: 2, rankSum: 7, rankedCount: 3, firstCount: 1 },
    ]);
    expect(rankPositions(notTied)).toEqual([1, 2]);
  });

  test("a ranking slide gives tied items the same position and the list/bars share it", () => {
    const input = rankingInput(true);
    // Alpha and Beta exactly tied (same sum, same first count), Gamma last.
    input.rankStats = [
      { statementId: "r1", value: 1, label: "Alpha", respondentCount: 4, rankedCount: 4, rankSum: 6, firstCount: 2 },
      { statementId: "r1", value: 2, label: "Beta", respondentCount: 4, rankedCount: 4, rankSum: 6, firstCount: 2 },
      { statementId: "r1", value: 3, label: "Gamma", respondentCount: 4, rankedCount: 4, rankSum: 12, firstCount: 0 },
    ];
    const { slides } = buildSlides(input);
    const slide = slides.find((s) => s.kind === "ranking") as Extract<
      Slide,
      { kind: "ranking" }
    >;
    expect(slide.items.map((i) => [i.label, i.position])).toEqual([
      ["Alpha", 1],
      ["Beta", 1],
      ["Gamma", 3],
    ]);
    expect(slide.items[0].points).toBe(slide.items[1].points);
  });
});
