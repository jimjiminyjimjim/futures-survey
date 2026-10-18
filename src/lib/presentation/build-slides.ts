/**
 * Pure slide sequencing: title -> per section (section-intro, then one
 * slide per statement in section order, by kind — scale/choice/
 * prediction — then a discussion slide if the section has one, then a
 * trailing familiarity-overview slide for any familiarity section with
 * at least one scale statement). Deterministic: the same input always
 * produces the same slide array.
 */
import {
  rankByExplainPercent,
  meanFamiliarity,
  explainCount as explainCountOf,
  explainPercent as explainPercentOf,
  optionPercent,
  ratingOptionCounts,
  averageFromCounts,
  twoEndedBuckets,
} from "./chart-math";
import type {
  PresentationInput,
  PresentationStatement,
  Slide,
  OptionCount,
  DeckStep,
} from "./types";

export type BuildSlidesResult = {
  slides: Slide[];
  respondentCount: number;
};

/** "2a" -> "2"; "11b" -> "11"; "4" -> "4". Used to render the small
 * parent line ("2. What is design?") above a subsection's own heading. */
function parentLabelOf(label: string | null): string | null {
  if (!label) {
    return null;
  }
  return label.match(/^[0-9]+/)?.[0] ?? null;
}

/** Splits a discussion_prompt like
 * `"It is the quality of our relationships…" (Esther Perel)` into its
 * quote and trailing-parenthetical attribution. Falls back to treating
 * the whole string as the quote when no attribution is present. */
function splitQuote(discussionPrompt: string): {
  quote: string;
  attribution: string | null;
} {
  const match = discussionPrompt.match(/^(.*)\s\(([^()]+)\)$/);
  if (!match) {
    return { quote: discussionPrompt, attribution: null };
  }
  return { quote: match[1].trim(), attribution: match[2].trim() };
}

export function buildSlides(input: PresentationInput): BuildSlidesResult {
  const { round, sections, scaleOptions, counts } = input;
  const choiceCounts = input.choiceCounts ?? [];
  const predictionStats = input.predictionStats ?? [];

  const scaleCountsByStatement = new Map<string, Map<number, number>>();
  for (const c of counts) {
    const byValue = scaleCountsByStatement.get(c.statementId) ?? new Map();
    byValue.set(c.value, c.count);
    scaleCountsByStatement.set(c.statementId, byValue);
  }

  const choiceCountsByStatement = new Map<string, typeof choiceCounts>();
  for (const c of choiceCounts) {
    const list = choiceCountsByStatement.get(c.statementId) ?? [];
    list.push(c);
    choiceCountsByStatement.set(c.statementId, list);
  }

  const predictionByStatement = new Map(
    predictionStats.map((p) => [p.statementId, p])
  );

  const statementTextById = new Map<string, string>();
  for (const section of sections) {
    for (const statement of section.statements) {
      statementTextById.set(statement.id, statement.text);
    }
  }

  const optionsByScale = new Map<string, { value: number; label: string }[]>();
  for (const o of scaleOptions) {
    const list = optionsByScale.get(o.scaleKey) ?? [];
    list.push({ value: o.value, label: o.label });
    optionsByScale.set(o.scaleKey, list);
  }
  for (const list of optionsByScale.values()) {
    list.sort((a, b) => a.value - b.value);
  }

  const sortedSections = [...sections].sort(
    (a, b) => a.sortOrder - b.sortOrder
  );

  // Per-scale-statement options/totals, computed once up front so
  // respondentCount (the max across every statement in the round) and
  // each statement slide can both read from the same pass.
  let maxStatementTotal = 0;
  const scaleStatementData = new Map<
    string,
    { options: OptionCount[]; total: number }
  >();

  for (const section of sortedSections) {
    if (section.scaleKey !== "agreement" && section.scaleKey !== "familiarity") {
      throw new Error(`buildSlides: unknown scale key "${section.scaleKey}"`);
    }
    const scaleOpts = optionsByScale.get(section.scaleKey) ?? [];
    for (const statement of section.statements) {
      const kind = statement.kind ?? "scale";
      if (kind === "scale") {
        const byValue = scaleCountsByStatement.get(statement.id) ?? new Map();
        const options: OptionCount[] = scaleOpts.map((o) => ({
          value: o.value,
          label: o.label,
          count: byValue.get(o.value) ?? 0,
        }));
        const total = options.reduce((sum, o) => sum + o.count, 0);
        scaleStatementData.set(statement.id, { options, total });
        maxStatementTotal = Math.max(maxStatementTotal, total);
      } else if (
        kind === "choice_one" ||
        kind === "choice_multi" ||
        kind === "choice_exact" ||
        kind === "choice_up_to"
      ) {
        const rows = choiceCountsByStatement.get(statement.id) ?? [];
        const respondentTotal = rows[0]?.respondentCount ?? 0;
        maxStatementTotal = Math.max(maxStatementTotal, respondentTotal);
      } else if (kind === "rating" || kind === "two_ended") {
        // rating/two_ended totals come from the same widened
        // admin_statement_answer_counts aggregate as scale, but their
        // value ranges (0..10 / 0..100) aren't scale_options rows, so
        // they're summed directly from the raw byValue counts.
        const byValue = scaleCountsByStatement.get(statement.id) ?? new Map();
        const total = [...byValue.values()].reduce((sum, n) => sum + n, 0);
        maxStatementTotal = Math.max(maxStatementTotal, total);
      }
    }
  }

  const hasAnyStatements = sortedSections.some((s) => s.statements.length > 0);
  const respondentCount = hasAnyStatements
    ? maxStatementTotal
    : round.submittedCount;

  const slides: Slide[] = [
    {
      kind: "title",
      roundTitle: round.title,
      respondentCount,
    },
  ];

  for (const section of sortedSections) {
    const label = section.label ?? null;
    const parentTitle = section.parentTitle ?? null;
    const parentLabel = parentTitle ? parentLabelOf(label) : null;

    slides.push({
      kind: "section-intro",
      label,
      parentLabel,
      parentTitle,
      sectionTitle: section.title,
      sectionPrompt: section.prompt,
      respondentCount,
    });

    const sortedStatements: PresentationStatement[] = [...section.statements].sort(
      (a, b) => a.sortOrder - b.sortOrder
    );
    const questionTotal = sortedStatements.length;

    sortedStatements.forEach((statement, idx) => {
      const questionNumber = idx + 1;
      const kind = statement.kind ?? "scale";
      const isKey = statement.isKey ?? false;

      if (kind === "scale") {
        const data = scaleStatementData.get(statement.id)!;
        slides.push({
          kind: "statement",
          scaleKey: section.scaleKey as "agreement" | "familiarity",
          statementKey: statement.key,
          text: statement.text,
          sectionLabel: label,
          sectionTitle: section.title,
          questionNumber,
          questionTotal,
          isKey,
          respondentCount: data.total,
          options: data.options,
          revealText: statement.revealText ?? null,
        });
        return;
      }

      if (
        kind === "choice_one" ||
        kind === "choice_multi" ||
        kind === "choice_exact" ||
        kind === "choice_up_to"
      ) {
        const rows = [...(choiceCountsByStatement.get(statement.id) ?? [])].sort(
          (a, b) => b.answerCount - a.answerCount
        );
        const respondentTotal = rows[0]?.respondentCount ?? 0;
        slides.push({
          kind: "choice",
          choiceKind: kind,
          statementKey: statement.key,
          text: statement.text,
          sectionLabel: label,
          sectionTitle: section.title,
          questionNumber,
          questionTotal,
          choiceCount: statement.choiceCount ?? null,
          isKey,
          respondentCount: respondentTotal,
          options: rows.map((r) => ({
            value: r.value,
            label: r.label,
            exclusive: r.exclusive,
            count: r.answerCount,
            percent: optionPercent(r.answerCount, r.respondentCount),
          })),
          revealText: statement.revealText ?? null,
        });
        return;
      }

      if (kind === "rating") {
        const byValue = scaleCountsByStatement.get(statement.id) ?? new Map();
        const options = ratingOptionCounts(byValue);
        const total = options.reduce((sum, o) => sum + o.count, 0);
        slides.push({
          kind: "rating",
          statementKey: statement.key,
          text: statement.text,
          itemLabel: statement.label ?? null,
          context: statement.context ?? null,
          leadIn: statement.question ? null : section.prompt,
          question: statement.question ?? null,
          sectionLabel: label,
          sectionTitle: section.title,
          isKey,
          respondentCount: total,
          options,
          average: averageFromCounts(options),
          leftLabel: statement.leftLabel ?? "",
          rightLabel: statement.rightLabel ?? "",
          revealText: statement.revealText ?? null,
        });
        return;
      }

      if (kind === "two_ended") {
        const byValue = scaleCountsByStatement.get(statement.id) ?? new Map();
        const options = Array.from(byValue.entries()).map(([value, count]) => ({
          value,
          label: String(value),
          count,
        }));
        const total = options.reduce((sum, o) => sum + o.count, 0);
        slides.push({
          kind: "two-ended",
          statementKey: statement.key,
          text: statement.text,
          sectionLabel: label,
          sectionTitle: section.title,
          isKey,
          respondentCount: total,
          leftLabel: statement.leftLabel ?? "",
          rightLabel: statement.rightLabel ?? "",
          average: averageFromCounts(options),
          buckets: twoEndedBuckets(byValue),
          revealText: statement.revealText ?? null,
        });
        return;
      }

      if (kind === "prediction") {
        const stats = predictionByStatement.get(statement.id);
        const targetText = stats
          ? statementTextById.get(stats.predictionOfId) ?? ""
          : "";
        slides.push({
          kind: "prediction",
          statementKey: statement.key,
          text: statement.text,
          targetText,
          sectionLabel: label,
          sectionTitle: section.title,
          isKey,
          respondentCount,
          guessCount: stats?.guessCount ?? 0,
          averageGuess: stats?.averageGuess ?? null,
          actualRespondentCount: stats?.actualRespondentCount ?? 0,
          actualAgreePercent: stats?.actualAgreePercent ?? null,
        });
      }
    });

    const discussionPrompt = section.discussionPrompt ?? null;
    if (discussionPrompt) {
      const { quote, attribution } = splitQuote(discussionPrompt);
      slides.push({
        kind: "discussion",
        quote,
        attribution,
        respondentCount,
      });
    }

    const scaleStatements = sortedStatements.filter(
      (s) => (s.kind ?? "scale") === "scale"
    );
    if (section.scaleKey === "familiarity" && scaleStatements.length > 0) {
      const terms = scaleStatements.map((statement) => {
        const data = scaleStatementData.get(statement.id)!;
        const sum = data.options.reduce((s, o) => s + o.value * o.count, 0);
        const n = data.total;
        return {
          statementKey: statement.key,
          text: statement.text,
          sortOrder: statement.sortOrder,
          sum,
          n,
          mean: meanFamiliarity(data.options),
          explainCount: explainCountOf(data.options),
          explainPercent: explainPercentOf(data.options, n),
        };
      });
      slides.push({
        kind: "familiarity-overview",
        sectionSortOrder: section.sortOrder,
        ...(section.label !== undefined ? { sectionLabel: section.label } : {}),
        respondentCount,
        terms: rankByExplainPercent(terms),
      });
    }
  }

  return { slides, respondentCount };
}

const RESULTS_SLIDE_KINDS = new Set<Slide["kind"]>([
  "statement",
  "choice",
  "rating",
  "two-ended",
  "prediction",
  "familiarity-overview",
]);

/**
 * Expands a slide array into deck steps: every results slide (statement,
 * choice, rating, two-ended, prediction, familiarity-overview) gives two
 * steps — revealed: false then revealed: true — so the first advance onto
 * it shows the question only and the next reveals the results. Every
 * other slide (title, section-intro, discussion) gives one revealed step.
 * Pure and deterministic.
 */
export function buildDeckSteps(slides: Slide[]): DeckStep[] {
  const steps: DeckStep[] = [];
  slides.forEach((slide, slideIndex) => {
    if (RESULTS_SLIDE_KINDS.has(slide.kind)) {
      steps.push({ slideIndex, revealed: false });
      steps.push({ slideIndex, revealed: true });
    } else {
      steps.push({ slideIndex, revealed: true });
    }
  });
  return steps;
}
