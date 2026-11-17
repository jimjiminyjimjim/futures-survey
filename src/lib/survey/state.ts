/**
 * Pure participant-screen resolver and label helpers. No imports of
 * @supabase, next or react — this module must be testable with plain
 * node-side unit tests (tests/api/survey-state.spec.ts) and safe to import
 * from a server-rendered component without pulling in any request context.
 */

import { displaySectionLabel, questionGroupKey } from "@/lib/section-label";
import {
  LIVE_SURVEY_PATHS,
  reviewHref,
  sectionHref,
  statementHref,
  type SurveyPaths,
} from "@/lib/survey/paths";

export const SECONDS_PER_STATEMENT = 10;

/** '1 question' or '{n} questions'. */
/** Start screen, e.g. "Part 1 of 3 · 6 questions" (questions = the numbered
 * blocks 1, 2a, 2b … in this part). */
export function partAndQuestionsLabel(
  part: number | null,
  totalParts: number | null,
  questions: number
): string {
  const q = questions === 1 ? "1 question" : `${questions} questions`;
  return part && totalParts ? `Part ${part} of ${totalParts} · ${q}` : q;
}

export function questionCountLabel(n: number): string {
  return n === 1 ? "1 question" : `${n} questions`;
}

/** "Part 1 of 3", or null when either part isn't known. */
export function partLabel(
  part: number | null,
  totalParts: number | null
): string | null {
  return part && totalParts ? `Part ${part} of ${totalParts}` : null;
}

/**
 * Rough time estimate, rounded half up, floored at 1 minute. n=1 -> 'about
 * 1 minute', n=3 -> 'about 1 minute' (0.5 rounds up to 1 via Math.round),
 * n=9 -> 'about 2 minutes', n=85 -> 'about 14 minutes'.
 */
export function roughMinutesLabel(n: number): string {
  const minutes = Math.max(
    1,
    Math.round((n * SECONDS_PER_STATEMENT) / 60)
  );
  return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** '{position} of {total}'. */
export function progressLabel(position: number, total: number): string {
  return `${position} of ${total}`;
}

/**
 * Structural shape consumed by the section-grouping helpers below.
 * Deliberately NOT imported from queries.ts's OrderedStatement — this file
 * stays free of @supabase/next/react imports so it remains importable
 * (and testable) outside a request context. Any object with these fields
 * (OrderedStatement included) satisfies it.
 */
export type SectionGroupableStatement = {
  key: string;
  sectionId: string;
  sectionTitle: string;
  sectionPrompt: string;
  /** e.g. "2a"; absent/null for unlabelled sections. */
  sectionLabel?: string | null;
  /** e.g. "What is design?" for 2a/2b. */
  sectionParentTitle?: string | null;
  /** true when every statement in this section is answered on one page
   * (sections.grouped AND every statement is kind "rating" — see
   * queries.ts). Absent/false for every other section. */
  sectionGrouped?: boolean;
};

export type SectionSummary = {
  /** 1-based position within this round (session). */
  sectionNumber: number;
  /** 1-based number of the QUESTION this section belongs to. Sections
   * labelled B1/B2 are two parts of one question, so they share a number;
   * every other section is its own question (equal to sectionNumber when
   * nothing is split, as in Session 1). */
  questionNumber: number;
  /** How many distinct questions the round has (8 for Session 2's 9
   * sections). Equals the section count when nothing is split. */
  totalQuestions: number;
  sectionId: string;
  /** Display numbering ("1", "2a", "11b"), or null. */
  label: string | null;
  parentTitle: string | null;
  title: string;
  prompt: string;
  /** Statement keys in round order, within this section only. */
  statementKeys: string[];
  /** true when this section is answered on one page, at its first key's
   * route. See resolveStatementNav/resolveSectionScreen/
   * resolveSurveyScreen for how that one route is reached. */
  grouped: boolean;
};

/** "2a. What is a designer?" — or just the title when unlabelled. */
export function sectionHeading(label: string | null, title: string): string {
  // B1 / B2 read as "B." (two parts of one question).
  const shown = displaySectionLabel(label);
  return shown ? `${shown}. ${title}` : title;
}

/** The label to show a participant: "B1" -> "B", everything else as is. */
export function displayLabel(label: string | null): string | null {
  return displaySectionLabel(label);
}

/**
 * The parent line for a subsection, e.g. label "2a" + "What is design?" ->
 * "2. What is design?". Null when there's no parent title.
 */
export function parentSectionHeading(
  label: string | null,
  parentTitle: string | null
): string | null {
  if (!parentTitle) {
    return null;
  }
  // "2a" -> "2" (numeric parent); "B1" -> "B" (a capital letter followed by
  // a digit, as in Session 2's B1/B2). A bare letter ("A") has no parent
  // number, so the title is shown alone.
  const parentNumber =
    label?.match(/^\d+/)?.[0] ?? label?.match(/^([A-Z])\d/)?.[1];
  return parentNumber ? `${parentNumber}. ${parentTitle}` : parentTitle;
}

/**
 * The section prompt to show a participant, or null when it only repeats
 * the section title (Session 2's D uses the same text for both).
 */
export function visibleSectionPrompt(
  title: string,
  prompt: string
): string | null {
  return prompt.trim() === title.trim() ? null : prompt;
}

/**
 * Groups round-ordered statements into their sections. Relies on
 * queries.ts's existing order (section sort_order, then statement
 * sort_order) to make every section's statements contiguous — this never
 * re-sorts, it only detects sectionId boundaries as they occur.
 */
export function buildSectionSummaries(
  statements: SectionGroupableStatement[]
): SectionSummary[] {
  const sections: SectionSummary[] = [];
  for (const statement of statements) {
    const current = sections[sections.length - 1];
    if (current && current.sectionId === statement.sectionId) {
      current.statementKeys.push(statement.key);
    } else {
      sections.push({
        sectionNumber: sections.length + 1,
        questionNumber: 0,
        totalQuestions: 0,
        sectionId: statement.sectionId,
        label: statement.sectionLabel ?? null,
        parentTitle: statement.sectionParentTitle ?? null,
        title: statement.sectionTitle,
        prompt: statement.sectionPrompt,
        statementKeys: [statement.key],
        grouped: statement.sectionGrouped === true,
      });
    }
  }

  // Number the questions: letter+digit parts (B1, B2) share one number.
  const questionNumberByGroup = new Map<string, number>();
  for (const section of sections) {
    const group = questionGroupKey(section.label, section.sectionId);
    let number = questionNumberByGroup.get(group);
    if (number === undefined) {
      number = questionNumberByGroup.size + 1;
      questionNumberByGroup.set(group, number);
    }
    section.questionNumber = number;
  }
  for (const section of sections) {
    section.totalQuestions = questionNumberByGroup.size;
  }
  return sections;
}

/** How many distinct questions a round's sections make up (B1/B2 count once). */
export function countQuestions(
  sections: ReadonlyArray<Pick<SectionSummary, "totalQuestions">>
): number {
  return sections[0]?.totalQuestions ?? 0;
}

/**
 * A grouped section has ONE route: its first statement key. Any other
 * key in that section canonicalises to it, so every existing link
 * (resume, section-break Back/Continue, bookmarks) still lands on the
 * grouped page. An ungrouped or unknown key returns itself unchanged.
 */
export function canonicalStatementKey(
  sections: ReadonlyArray<Pick<SectionSummary, "grouped" | "statementKeys">>,
  statementKey: string
): string {
  const section = sections.find((s) => s.statementKeys.includes(statementKey));
  if (section && section.grouped) {
    return section.statementKeys[0];
  }
  return statementKey;
}

export type StatementSectionPosition = {
  sectionNumber: number;
  totalSections: number;
  /** Question numbering (B1/B2 share one number); see SectionSummary. */
  questionNumber: number;
  totalQuestions: number;
  /** The section's display label ("2a"), or null. */
  sectionLabel: string | null;
  /** 1-based position of this statement within its own section. */
  positionInSection: number;
  /** Total statements in this statement's section. */
  countInSection: number;
};

export type StatementNav = {
  /**
   * Always a concrete route — never null. The first statement of a
   * section points Back at that section's own break screen (including
   * section 1, whose screen itself points Back at "/" — see
   * resolveSectionScreen).
   */
  prevHref: string;
  /**
   * The last statement of a section points at the next section's break
   * screen, except the last statement of the last section, which points
   * straight at the review screen.
   */
  nextHref: string;
  position: StatementSectionPosition;
};

/**
 * Resolves a statement's Back/Continue targets and section-relative
 * position from the round's section groups. Returns null only if
 * statementKey isn't present in any section (the caller's own 404 guard
 * already rules this out for a real route hit).
 */
export function resolveStatementNav(
  sections: SectionSummary[],
  statementKey: string,
  paths: SurveyPaths = LIVE_SURVEY_PATHS
): StatementNav | null {
  const sectionIndex = sections.findIndex((section) =>
    section.statementKeys.includes(statementKey)
  );
  if (sectionIndex === -1) {
    return null;
  }

  const section = sections[sectionIndex];
  const indexInSection = section.statementKeys.indexOf(statementKey);
  const isLastSection = sectionIndex === sections.length - 1;

  if (section.grouped) {
    // A grouped section is one stop: every key in it shares the same
    // nav (its own section's break screen, and the next section's break
    // screen or review), and "position" reports the whole section as
    // complete in one step.
    return {
      prevHref: sectionHref(paths, section.sectionNumber),
      nextHref: isLastSection
        ? reviewHref(paths)
        : sectionHref(paths, section.sectionNumber + 1),
      position: {
        sectionNumber: section.sectionNumber,
        totalSections: sections.length,
        questionNumber: section.questionNumber,
        totalQuestions: section.totalQuestions,
        sectionLabel: section.label,
        positionInSection: section.statementKeys.length,
        countInSection: section.statementKeys.length,
      },
    };
  }

  const isFirstInSection = indexInSection === 0;
  const isLastInSection = indexInSection === section.statementKeys.length - 1;

  const prevHref = isFirstInSection
    ? sectionHref(paths, section.sectionNumber)
    : statementHref(paths, section.statementKeys[indexInSection - 1]);

  const nextHref = !isLastInSection
    ? statementHref(paths, section.statementKeys[indexInSection + 1])
    : isLastSection
      ? reviewHref(paths)
      : sectionHref(paths, section.sectionNumber + 1);

  return {
    prevHref,
    nextHref,
    position: {
      sectionNumber: section.sectionNumber,
      totalSections: sections.length,
      questionNumber: section.questionNumber,
      totalQuestions: section.totalQuestions,
      sectionLabel: section.label,
      positionInSection: indexInSection + 1,
      countInSection: section.statementKeys.length,
    },
  };
}

export type SectionScreen = {
  sectionNumber: number;
  totalSections: number;
  questionNumber: number;
  totalQuestions: number;
  label: string | null;
  parentTitle: string | null;
  title: string;
  prompt: string;
  questionCount: number;
  continueHref: string;
  /** paths.home ("/" live) for section 1; otherwise the previous section's last statement. */
  backHref: string;
};

/**
 * Resolves the section-break interstitial's content and nav targets for a
 * 1-based sectionNumber. Returns null for anything out of range (including
 * non-integers the caller may pass before validating) so the route can
 * notFound() rather than rendering a bad screen.
 */
export function resolveSectionScreen(
  sections: SectionSummary[],
  sectionNumber: number,
  paths: SurveyPaths = LIVE_SURVEY_PATHS
): SectionScreen | null {
  if (
    !Number.isInteger(sectionNumber) ||
    sectionNumber < 1 ||
    sectionNumber > sections.length
  ) {
    return null;
  }

  const section = sections[sectionNumber - 1];
  const previousSection = sectionNumber > 1 ? sections[sectionNumber - 2] : null;

  return {
    sectionNumber: section.sectionNumber,
    totalSections: sections.length,
    questionNumber: section.questionNumber,
    totalQuestions: section.totalQuestions,
    label: section.label,
    parentTitle: section.parentTitle,
    title: section.title,
    prompt: section.prompt,
    questionCount: section.statementKeys.length,
    continueHref: statementHref(paths, section.statementKeys[0]),
    backHref: previousSection
      ? statementHref(
          paths,
          canonicalStatementKey(
            sections,
            previousSection.statementKeys[previousSection.statementKeys.length - 1]
          )
        )
      : paths.home,
  };
}

export type SurveyScreen =
  | { kind: "no-round" }
  | {
      kind: "start";
      roundTitle: string;
      questionCount: number;
      firstStatementKey: string;
    }
  | { kind: "resume"; statementKey: string }
  | { kind: "review" }
  | { kind: "thanks" };

export type ResolveSurveyScreenInput = {
  openRound: { title: string } | null;
  orderedStatementKeys: string[];
  /**
   * The non-optional subset of orderedStatementKeys, in the same order.
   * Resume/review only wait on these (an optional prediction left blank
   * never blocks review). Defaults to every key.
   */
  requiredStatementKeys?: string[];
  response: { submittedAt: string | null } | null;
  answeredKeys: ReadonlySet<string>;
  /**
   * Optional. When provided, the resume target is canonicalised through
   * canonicalStatementKey, so a grouped section's resume always lands on
   * its first key. Omitted (or empty), resume returns the raw
   * first-unanswered key — the pre-grouped-sections behaviour, kept for
   * backwards compatibility.
   */
  sections?: ReadonlyArray<Pick<SectionSummary, "grouped" | "statementKeys">>;
};

/**
 * Resolves which screen a participant should see / be redirected to.
 * Evaluated in this fixed order:
 *   1. openRound null -> no-round
 *   2. zero statements -> no-round
 *   3. response?.submittedAt non-null -> thanks
 *   4. none of the round's keys answered -> start
 *   5. otherwise the first REQUIRED key in order that is not answered -> resume
 *      (mapped through canonicalStatementKey when `sections` is given, so a
 *      key in a grouped section resumes at the section's first key)
 *   6. all required answered -> review
 *
 * `response` must always be the participant's response for the OPEN round
 * only (the caller's snapshot scopes it this way), which is what keeps a
 * response submitted in a different round from ever triggering "thanks"
 * here (SURV-08).
 */
export function resolveSurveyScreen(
  input: ResolveSurveyScreenInput
): SurveyScreen {
  const { openRound, orderedStatementKeys, response, answeredKeys } = input;
  const requiredKeys = input.requiredStatementKeys ?? orderedStatementKeys;

  if (!openRound) {
    return { kind: "no-round" };
  }
  if (orderedStatementKeys.length === 0) {
    return { kind: "no-round" };
  }
  if (response?.submittedAt != null) {
    return { kind: "thanks" };
  }

  const anyAnswered = orderedStatementKeys.some((key) =>
    answeredKeys.has(key)
  );
  if (!anyAnswered) {
    return {
      kind: "start",
      roundTitle: openRound.title,
      questionCount: orderedStatementKeys.length,
      firstStatementKey: orderedStatementKeys[0],
    };
  }

  const firstUnanswered = requiredKeys.find((key) => !answeredKeys.has(key));
  if (firstUnanswered) {
    return {
      kind: "resume",
      statementKey: canonicalStatementKey(input.sections ?? [], firstUnanswered),
    };
  }

  return { kind: "review" };
}
