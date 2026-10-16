/**
 * Pure slide sequencing: title -> per section (section-intro, then one
 * statement slide per statement) -> (familiarity sections also get a
 * trailing familiarity-overview slide once they have at least one
 * statement). Deterministic: the same input always produces the same
 * slide array.
 */
import { rankByMeanFamiliarity, meanFamiliarity } from "./chart-math";
import type { PresentationInput, Slide, OptionCount } from "./types";

export type BuildSlidesResult = {
  slides: Slide[];
  respondentCount: number;
};

export function buildSlides(input: PresentationInput): BuildSlidesResult {
  const { round, sections, scaleOptions, counts } = input;

  const countsByStatement = new Map<string, Map<number, number>>();
  for (const c of counts) {
    const byValue = countsByStatement.get(c.statementId) ?? new Map();
    byValue.set(c.value, c.count);
    countsByStatement.set(c.statementId, byValue);
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

  // Per-statement options/totals, computed once up front so
  // respondentCount (the max across all statements) and each statement
  // slide can both read from the same pass.
  const sortedSections = [...sections].sort(
    (a, b) => a.sortOrder - b.sortOrder
  );

  let maxStatementTotal = 0;
  const statementData = new Map<
    string,
    { options: OptionCount[]; total: number }
  >();

  for (const section of sortedSections) {
    if (section.scaleKey !== "agreement" && section.scaleKey !== "familiarity") {
      throw new Error(
        `buildSlides: unknown scale key "${section.scaleKey}"`
      );
    }
    const scaleOpts = optionsByScale.get(section.scaleKey) ?? [];
    for (const statement of section.statements) {
      const byValue = countsByStatement.get(statement.id) ?? new Map();
      const options: OptionCount[] = scaleOpts.map((o) => ({
        value: o.value,
        label: o.label,
        count: byValue.get(o.value) ?? 0,
      }));
      const total = options.reduce((sum, o) => sum + o.count, 0);
      statementData.set(statement.id, { options, total });
      maxStatementTotal = Math.max(maxStatementTotal, total);
    }
  }

  const respondentCount =
    sortedSections.some((s) => s.statements.length > 0)
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
    slides.push({
      kind: "section-intro",
      sectionTitle: section.title,
      sectionPrompt: section.prompt,
      statementCount: section.statements.length,
      respondentCount,
    });

    const sortedStatements = [...section.statements].sort(
      (a, b) => a.sortOrder - b.sortOrder
    );
    for (const statement of sortedStatements) {
      const data = statementData.get(statement.id)!;
      slides.push({
        kind: "statement",
        scaleKey: section.scaleKey as "agreement" | "familiarity",
        statementKey: statement.key,
        text: statement.text,
        sectionTitle: section.title,
        respondentCount: data.total,
        options: data.options,
      });
    }

    if (section.scaleKey === "familiarity" && sortedStatements.length > 0) {
      const terms = sortedStatements.map((statement) => {
        const data = statementData.get(statement.id)!;
        const sum = data.options.reduce((s, o) => s + o.value * o.count, 0);
        const n = data.total;
        return {
          statementKey: statement.key,
          text: statement.text,
          sortOrder: statement.sortOrder,
          sum,
          n,
          mean: meanFamiliarity(data.options),
        };
      });
      slides.push({
        kind: "familiarity-overview",
        sectionSortOrder: section.sortOrder,
        respondentCount,
        terms: rankByMeanFamiliarity(terms),
      });
    }
  }

  return { slides, respondentCount };
}
