/**
 * Pure presentation-deck types. No imports from server modules (no
 * "server-only", no Supabase types) — these are shared between the
 * server loader, the pure slide builder, and client components.
 */

export type StatementKind =
  | "scale"
  | "choice_one"
  | "choice_multi"
  | "choice_exact"
  | "prediction"
  | "rating"
  | "two_ended"
  | "choice_up_to";

export type OptionCount = {
  value: number;
  label: string;
  count: number;
};

export type TwoEndedBucket = {
  from: number;
  to: number;
  count: number;
  percent: number;
};

export type ChoiceOptionCount = {
  value: number;
  label: string;
  exclusive: boolean;
  count: number;
  percent: number;
};

/**
 * A single term's familiarity-ranking inputs, carried through to the
 * familiarity-overview slide. sum/n let rankByMeanFamiliarity compare
 * means by exact integer cross-multiplication instead of floating point.
 * explainCount/explainPercent back the slide's displayed metric ("% who
 * could explain it", levels 3+4) and rankByExplainPercent's ordering.
 */
export type OverviewTerm = {
  statementKey: string;
  text: string;
  sortOrder: number;
  sum: number;
  n: number;
  mean: number;
  explainCount: number;
  explainPercent: number;
};

/**
 * A single rating statement's ranking inputs, carried through to the
 * rating-overview slide (261019-2w3). sum/n feed rankByMeanFamiliarity's
 * exact cross-multiplication, the same technique OverviewTerm uses.
 * average is the 1 dp mean from averageFromCounts, or null when n is 0
 * (nobody has answered that statement).
 */
export type RatingOverviewItem = {
  statementKey: string;
  text: string;
  sortOrder: number;
  sum: number;
  n: number;
  average: number | null;
};

export type Slide =
  | {
      kind: "title";
      roundTitle: string;
      respondentCount: number;
    }
  | {
      kind: "section-intro";
      label: string | null;
      parentLabel: string | null;
      parentTitle: string | null;
      sectionTitle: string;
      sectionPrompt: string;
      respondentCount: number;
    }
  | {
      kind: "statement";
      scaleKey: "agreement" | "familiarity";
      statementKey: string;
      text: string;
      sectionLabel: string | null;
      sectionTitle: string;
      questionNumber: number;
      questionTotal: number;
      isKey: boolean;
      respondentCount: number;
      options: OptionCount[];
      revealText: string | null;
    }
  | {
      kind: "choice";
      choiceKind: "choice_one" | "choice_multi" | "choice_exact" | "choice_up_to";
      statementKey: string;
      text: string;
      sectionLabel: string | null;
      sectionTitle: string;
      questionNumber: number;
      questionTotal: number;
      choiceCount: number | null;
      isKey: boolean;
      respondentCount: number;
      options: ChoiceOptionCount[];
      revealText: string | null;
    }
  | {
      kind: "rating";
      statementKey: string;
      text: string;
      /** Item sub-label, e.g. "2a". */
      itemLabel: string | null;
      /** Source line, e.g. "Shein (2023)". */
      context: string | null;
      /** The section prompt, shown above the text, when the item has no own question. */
      leadIn: string | null;
      /** Per-item question, shown below the text. */
      question: string | null;
      sectionLabel: string | null;
      sectionTitle: string;
      isKey: boolean;
      respondentCount: number;
      options: OptionCount[];
      average: number | null;
      leftLabel: string;
      rightLabel: string;
      revealText: string | null;
    }
  | {
      kind: "two-ended";
      statementKey: string;
      text: string;
      sectionLabel: string | null;
      sectionTitle: string;
      isKey: boolean;
      respondentCount: number;
      leftLabel: string;
      rightLabel: string;
      /** 0..100, 1 decimal place, or null when nobody has answered. */
      average: number | null;
      buckets: TwoEndedBucket[];
      revealText: string | null;
    }
  | {
      kind: "prediction";
      statementKey: string;
      text: string;
      targetText: string;
      sectionLabel: string | null;
      sectionTitle: string;
      isKey: boolean;
      respondentCount: number;
      guessCount: number;
      averageGuess: number | null;
      actualRespondentCount: number;
      actualAgreePercent: number | null;
    }
  | {
      kind: "discussion";
      quote: string;
      attribution: string | null;
      respondentCount: number;
    }
  | {
      kind: "familiarity-overview";
      sectionSortOrder: number;
      /** Display numbering, e.g. "A". Optional so pre-v3 fixtures keep typechecking. */
      sectionLabel?: string | null;
      respondentCount: number;
      terms: OverviewTerm[];
    }
  | {
      kind: "rating-overview";
      sectionSortOrder: number;
      /** Display numbering, e.g. "C". Optional, same convention as familiarity-overview. */
      sectionLabel?: string | null;
      /** Per-section heading text, because C and E have different titles. */
      sectionTitle: string;
      /** Section-scoped: the max n across this section's rating items. */
      respondentCount: number;
      items: RatingOverviewItem[];
    };

/** One step of the deck: a slide, and (for results slides) whether the
 * results area is revealed yet. */
export type DeckStep = { slideIndex: number; revealed: boolean };

/** The persistent section heading shown at the top of every non-title
 * slide, derived once per deck by buildSectionHeadings. null before the
 * first section-intro (i.e. on the title slide). */
export type DeckSectionHeading = {
  label: string | null;
  title: string;
  parentLabel: string | null;
  parentTitle: string | null;
};

// kind/options/choiceCount/isKey/predictionOf/optional and the section's
// label/parentTitle/discussionPrompt are declared optional (not just
// nullable) so that pre-existing fixtures built before Surveys v2 Part C
// (tests/api/presentation-math.spec.ts — a Playwright spec this task
// must not touch, per the "NO TESTS" rule) keep typechecking unchanged.
// buildSlides treats a missing kind as "scale" and a missing isKey/label/
// etc as its v1 default, so v1-shaped fixtures still produce the exact
// v1 slide sequence they were written to assert.
export type PresentationStatement = {
  id: string;
  key: string;
  text: string;
  sortOrder: number;
  kind?: StatementKind;
  options?: { value: number; label: string; exclusive?: boolean }[] | null;
  choiceCount?: number | null;
  isKey?: boolean;
  predictionOf?: string | null;
  optional?: boolean;
  /** Item sub-label, e.g. "2a". */
  label?: string | null;
  /** Source line, e.g. "Shein (2023)". */
  context?: string | null;
  /** Per-item question, overriding the section prompt. */
  question?: string | null;
  /** Presentation-only reveal text, shown with the results. */
  revealText?: string | null;
  /** rating/two_ended: label at the low end of the scale. */
  leftLabel?: string | null;
  /** rating/two_ended: label at the high end of the scale. */
  rightLabel?: string | null;
};

export type PresentationSection = {
  sortOrder: number;
  label?: string | null;
  parentTitle?: string | null;
  title: string;
  prompt: string;
  scaleKey: string;
  discussionPrompt?: string | null;
  /** Mirrors sections.show_overview. Presentation-only: when true,
   * buildSlides appends a trailing rating-overview slide after the
   * section's rating statements (when it has at least one). Optional so
   * pre-existing fixtures keep typechecking. */
  showOverview?: boolean;
  statements: PresentationStatement[];
};

export type PresentationInput = {
  round: {
    title: string;
    roundNumber: number;
    submittedCount: number;
  };
  sections: PresentationSection[];
  scaleOptions: Array<{
    scaleKey: string;
    value: number;
    label: string;
  }>;
  counts: Array<{
    statementId: string;
    value: number;
    count: number;
  }>;
  choiceCounts?: Array<{
    statementId: string;
    value: number;
    label: string;
    exclusive: boolean;
    answerCount: number;
    respondentCount: number;
  }>;
  predictionStats?: Array<{
    statementId: string;
    predictionOfId: string;
    guessCount: number;
    averageGuess: number | null;
    actualRespondentCount: number;
    actualAgreeCount: number;
    actualAgreePercent: number | null;
  }>;
};
