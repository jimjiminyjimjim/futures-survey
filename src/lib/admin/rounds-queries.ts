import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  parseChoiceOptions,
  type ChoiceOption,
  type QuestionKind,
} from "@/lib/survey/answer-rules";

export type RoundStatus = "draft" | "scheduled" | "open" | "closed";

export type AdminRoundRow = {
  id: string;
  roundNumber: number;
  title: string;
  opensAt: string | null;
  closesAt: string | null;
  status: RoundStatus;
  sectionCount: number;
  statementCount: number;
  startedCount: number;
  submittedCount: number;
  /** Surveys v2 (20261017000100): the round's survey and session 1..3. */
  surveyId: string | null;
  surveyTitle: string | null;
  sessionNumber: number | null;
};

type AdminListRoundsRow = {
  id: string;
  round_number: number;
  title: string;
  opens_at: string | null;
  closes_at: string | null;
  status: RoundStatus;
  section_count: number | string;
  statement_count: number | string;
  started_count: number | string;
  submitted_count: number | string;
  survey_id?: string | null;
  survey_title?: string | null;
  session_number?: number | null;
};

export type RoundStatement = {
  id: string;
  key: string;
  text: string;
  sortOrder: number;
  kind: QuestionKind;
  /** Choice kinds only: this statement's own options. [] for scale/prediction. */
  options: ChoiceOption[];
  /** choice_exact only: how many options must be picked. */
  choiceCount: number | null;
  /** Optional questions (predictions) don't count towards submit completeness. */
  optional: boolean;
};

export type RoundSection = {
  id: string;
  sortOrder: number;
  title: string;
  prompt: string;
  scaleKey: string;
  /** Display numbering, e.g. "1", "2a", "11b" (null for unlabelled sections). */
  label: string | null;
  /** Parent section title for subsections, e.g. "What is design?" for 2a/2b. */
  parentTitle: string | null;
  statements: RoundStatement[];
};

export type SurveyGroup = {
  surveyId: string;
  surveyTitle: string;
  /** This survey's rounds, ordered by session number (1, 2, 3). */
  rounds: AdminRoundRow[];
};

/**
 * Groups admin_list_rounds' flat rows by survey (ADM-01, surveys v2 part B):
 * newest survey first. Every round's round_number is drawn from one
 * ever-increasing global sequence (admin_create_round /
 * admin_create_survey), so a group's highest round_number is a reliable
 * "most recently created" ordering across surveys without any extra date
 * comparison.
 */
export function groupRoundsBySurvey(rounds: AdminRoundRow[]): SurveyGroup[] {
  const bySurvey = new Map<string, SurveyGroup>();

  for (const round of rounds) {
    const surveyId = round.surveyId ?? round.id;
    const surveyTitle = round.surveyTitle ?? round.title;
    let group = bySurvey.get(surveyId);
    if (!group) {
      group = { surveyId, surveyTitle, rounds: [] };
      bySurvey.set(surveyId, group);
    }
    group.rounds.push(round);
  }

  const groups = [...bySurvey.values()];
  for (const group of groups) {
    group.rounds.sort(
      (a, b) => (a.sessionNumber ?? 0) - (b.sessionNumber ?? 0)
    );
  }
  groups.sort((a, b) => {
    const aMax = Math.max(...a.rounds.map((r) => r.roundNumber));
    const bMax = Math.max(...b.rounds.map((r) => r.roundNumber));
    return bMax - aMax;
  });
  return groups;
}

export type RoundDetail = {
  round: AdminRoundRow;
  sections: RoundSection[];
  scales: { key: string; name: string }[];
};

/**
 * Pure mirror of round_content_editable_at on the DB-computed status
 * string — no TS date comparison is needed. True exactly for "draft" and
 * "scheduled" (RND-03: content locks once the round opens, not merely once
 * it is scheduled).
 */
export function isContentEditable(status: RoundStatus): boolean {
  return status === "draft" || status === "scheduled";
}

function toAdminRoundRow(row: AdminListRoundsRow): AdminRoundRow {
  return {
    id: row.id,
    roundNumber: row.round_number,
    title: row.title,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    status: row.status,
    sectionCount: Number(row.section_count),
    statementCount: Number(row.statement_count),
    startedCount: Number(row.started_count),
    submittedCount: Number(row.submitted_count),
    surveyId: row.survey_id ?? null,
    surveyTitle: row.survey_title ?? null,
    sessionNumber: row.session_number ?? null,
  };
}

type SectionWithStatementsRow = {
  id: string;
  sort_order: number;
  title: string;
  prompt: string;
  scale_key: string;
  label: string | null;
  parent_title: string | null;
  statements:
    | {
        id: string;
        key: string;
        sort_order: number;
        text: string;
        kind: QuestionKind;
        options: unknown;
        choice_count: number | null;
        optional: boolean;
      }[]
    | null;
};

/**
 * Server-only. The rounds dashboard's single data source
 * (public.admin_list_rounds — ADM-01). No date comparison happens in
 * TypeScript; status is whatever the RPC returns.
 */
export const listRounds = cache(
  async (): Promise<
    { ok: true; rounds: AdminRoundRow[] } | { ok: false }
  > => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_list_rounds");

    if (error) {
      console.error("admin_list_rounds", { code: error.code });
      return { ok: false };
    }

    const rows = (data ?? []) as AdminListRoundsRow[];

    return {
      ok: true,
      rounds: rows.map(toAdminRoundRow),
    };
  }
);

/**
 * Server-only. A single round's full editor detail: its admin_list_rounds
 * row, every section with its statements (sorted by sort_order), and the
 * fixed set of scales (for mapping a section's scale_key to its display
 * name). Returns null on any RPC/query error or when the round doesn't
 * exist, so callers can notFound() uniformly.
 */
export const getRoundDetail = cache(
  async (roundId: string): Promise<RoundDetail | null> => {
    const supabase = await createClient();

    const [roundResult, sectionsResult, scalesResult] = await Promise.all([
      supabase.rpc("admin_list_rounds", { p_round_id: roundId }),
      supabase
        .from("sections")
        .select(
          "id, sort_order, title, prompt, scale_key, label, parent_title, statements(id, key, sort_order, text, kind, options, choice_count, optional)"
        )
        .eq("round_id", roundId),
      supabase.from("scales").select("key, name"),
    ]);

    if (roundResult.error) {
      console.error("getRoundDetail: admin_list_rounds", {
        code: roundResult.error.code,
      });
      return null;
    }
    const roundRow = ((roundResult.data ?? []) as AdminListRoundsRow[])[0];
    if (!roundRow) {
      return null;
    }

    if (sectionsResult.error) {
      console.error("getRoundDetail: sections", {
        code: sectionsResult.error.code,
      });
      return null;
    }
    if (scalesResult.error) {
      console.error("getRoundDetail: scales", {
        code: scalesResult.error.code,
      });
      return null;
    }

    const sections = (
      (sectionsResult.data ?? []) as SectionWithStatementsRow[]
    )
      .map((section) => ({
        id: section.id,
        sortOrder: section.sort_order,
        title: section.title,
        prompt: section.prompt,
        scaleKey: section.scale_key,
        label: section.label,
        parentTitle: section.parent_title,
        statements: (section.statements ?? [])
          .map((statement) => ({
            id: statement.id,
            key: statement.key,
            text: statement.text,
            sortOrder: statement.sort_order,
            kind: statement.kind,
            options: parseChoiceOptions(statement.options),
            choiceCount: statement.choice_count,
            optional: statement.optional,
          }))
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return {
      round: toAdminRoundRow(roundRow),
      sections,
      scales: (scalesResult.data ?? []) as { key: string; name: string }[],
    };
  }
);
