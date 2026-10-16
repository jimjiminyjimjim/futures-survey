/**
 * Pure presentation-deck types. No imports from server modules (no
 * "server-only", no Supabase types) — these are shared between the
 * server loader, the pure slide builder, and client components.
 */

export type OptionCount = {
  value: number;
  label: string;
  count: number;
};

/**
 * A single term's familiarity-ranking inputs, carried through to the
 * familiarity-overview slide. sum/n let rankByMeanFamiliarity compare
 * means by exact integer cross-multiplication instead of floating point.
 */
export type OverviewTerm = {
  statementKey: string;
  text: string;
  sortOrder: number;
  sum: number;
  n: number;
  mean: number;
};

export type Slide =
  | {
      kind: "title";
      roundTitle: string;
      respondentCount: number;
    }
  | {
      kind: "section-intro";
      sectionTitle: string;
      sectionPrompt: string;
      statementCount: number;
      respondentCount: number;
    }
  | {
      kind: "statement";
      scaleKey: "agreement" | "familiarity";
      statementKey: string;
      text: string;
      sectionTitle: string;
      respondentCount: number;
      options: OptionCount[];
    }
  | {
      kind: "familiarity-overview";
      sectionSortOrder: number;
      respondentCount: number;
      terms: OverviewTerm[];
    };

export type PresentationInput = {
  round: {
    title: string;
    roundNumber: number;
    submittedCount: number;
  };
  sections: Array<{
    sortOrder: number;
    title: string;
    prompt: string;
    scaleKey: string;
    statements: Array<{
      id: string;
      key: string;
      text: string;
      sortOrder: number;
    }>;
  }>;
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
};
