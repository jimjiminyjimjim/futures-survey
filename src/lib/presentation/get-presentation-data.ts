import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isUnopenedDraft } from "@/lib/unopened-draft";
import {
  isPresentationScaleKey,
  type PresentationInput,
  type PresentationStatement,
} from "./types";

// Surveys v2 Part C: this loader is intentionally self-contained and
// does NOT import from src/lib/admin/** (that tree is owned by Part B,
// being edited concurrently). It calls the same admin_list_rounds RPC
// directly instead of going through getRoundDetail, and reads
// sections/statements straight off the DB with the v2 columns
// getRoundDetail doesn't select (kind, options, choice_count, is_key,
// prediction_of, optional, label, parent_title, discussion_prompt).

type AdminListRoundsRow = {
  id: string;
  round_number: number;
  title: string;
  opens_at: string | null;
  closes_at: string | null;
  submitted_count: number | string;
};

type AnswerCountRow = {
  statement_id: string;
  statement_key: string;
  value: number;
  answer_count: number;
};

type ChoiceCountRow = {
  statement_id: string;
  statement_key: string;
  kind: string;
  value: number;
  label: string;
  exclusive: boolean;
  answer_count: number | string;
  respondent_count: number | string;
};

type PredictionStatsRow = {
  statement_id: string;
  statement_key: string;
  prediction_of: string;
  prediction_of_key: string;
  guess_count: number | string;
  average_guess: number | string | null;
  actual_respondent_count: number | string;
  actual_agree_count: number | string;
  actual_agree_percent: number | string | null;
};

type RankStatsRow = {
  statement_id: string;
  statement_key: string;
  value: number | string;
  label: string;
  respondent_count: number | string;
  ranked_count: number | string;
  rank_sum: number | string;
  first_count: number | string;
};

type ScaleOptionRow = {
  scale_key: string;
  value: number;
  label: string;
};

type StatementRow = {
  id: string;
  key: string;
  text: string;
  sort_order: number;
  kind: string;
  options: { value: number; label: string; exclusive?: boolean }[] | null;
  choice_count: number | null;
  is_key: boolean;
  prediction_of: string | null;
  optional: boolean;
  label: string | null;
  context: string | null;
  question: string | null;
  reveal_text: string | null;
  left_label: string | null;
  right_label: string | null;
};

type SectionWithStatementsRow = {
  sort_order: number;
  label: string | null;
  parent_title: string | null;
  title: string;
  prompt: string;
  scale_key: string;
  discussion_prompt: string | null;
  show_overview: boolean;
  statements: StatementRow[] | null;
};

/**
 * `isUnopenedDraft` (quick task 261117-it4): the round has no open date and
 * no close date, so every answer in the deck is an admin test answer and
 * the deck says so. Known on a load failure too once the round row loaded.
 */
export type GetPresentationDataResult =
  | { ok: true; input: PresentationInput; isUnopenedDraft: boolean }
  | {
      ok: false;
      reason: "not_found" | "load_failed";
      isUnopenedDraft?: boolean;
    };

/**
 * Server-only. Loads everything the presentation deck needs for one
 * round: the round's own admin_list_rounds row, its sections and
 * statements (every v2 column, plus show_overview), scale_options, and
 * three identity-free admin aggregates under the caller's own admin JWT —
 * admin_statement_answer_counts (scale), admin_statement_choice_counts
 * (choice_one/choice_multi/choice_exact) and admin_prediction_stats — plus
 * admin_statement_rank_stats, called only when the round has ranking
 * statements. Never reads an identity-bearing table or function.
 */
export async function getPresentationData(
  roundId: string
): Promise<GetPresentationDataResult> {
  const supabase = await createClient();

  const [
    roundResult,
    sectionsResult,
    scaleOptionsResult,
    countsResult,
    choiceCountsResult,
    predictionStatsResult,
  ] = await Promise.all([
    supabase.rpc("admin_list_rounds", { p_round_id: roundId }),
    supabase
      .from("sections")
      .select(
        "sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt, show_overview, statements(id, key, text, sort_order, kind, options, choice_count, is_key, prediction_of, optional, label, context, question, reveal_text, left_label, right_label)"
      )
      .eq("round_id", roundId),
    supabase
      .from("scale_options")
      .select("scale_key, value, label")
      .order("scale_key")
      .order("value"),
    supabase.rpc("admin_statement_answer_counts", { p_round_id: roundId }),
    supabase.rpc("admin_statement_choice_counts", { p_round_id: roundId }),
    supabase.rpc("admin_prediction_stats", { p_round_id: roundId }),
  ]);

  if (roundResult.error) {
    console.error("admin_list_rounds", { code: roundResult.error.code });
    return { ok: false, reason: "load_failed" };
  }
  const roundRow = ((roundResult.data ?? []) as AdminListRoundsRow[])[0];
  if (!roundRow) {
    return { ok: false, reason: "not_found" };
  }
  const draft = isUnopenedDraft(roundRow.opens_at, roundRow.closes_at);

  if (sectionsResult.error) {
    console.error("getPresentationData: sections", {
      code: sectionsResult.error.code,
    });
    return { ok: false, reason: "load_failed", isUnopenedDraft: draft };
  }
  if (scaleOptionsResult.error) {
    console.error("scale_options", { code: scaleOptionsResult.error.code });
    return { ok: false, reason: "load_failed", isUnopenedDraft: draft };
  }
  if (countsResult.error) {
    console.error("admin_statement_answer_counts", {
      code: countsResult.error.code,
    });
    return { ok: false, reason: "load_failed", isUnopenedDraft: draft };
  }
  if (choiceCountsResult.error) {
    console.error("admin_statement_choice_counts", {
      code: choiceCountsResult.error.code,
    });
    return { ok: false, reason: "load_failed", isUnopenedDraft: draft };
  }
  if (predictionStatsResult.error) {
    console.error("admin_prediction_stats", {
      code: predictionStatsResult.error.code,
    });
    return { ok: false, reason: "load_failed", isUnopenedDraft: draft };
  }

  const sectionRows = (sectionsResult.data ?? []) as SectionWithStatementsRow[];

  for (const section of sectionRows) {
    if (!isPresentationScaleKey(section.scale_key)) {
      console.error("presentation_unknown_scale");
      return { ok: false, reason: "load_failed", isUnopenedDraft: draft };
    }
  }

  // The ranking aggregate RPC is only called for a round that actually has
  // ranking statements, so a round without them (Session 1) never depends
  // on it — the deck loads even if the ranking migration is not applied yet.
  const hasRanking = sectionRows.some((section) =>
    (section.statements ?? []).some((st) => st.kind === "ranking")
  );
  let rankStats: PresentationInput["rankStats"] | undefined;
  if (hasRanking) {
    const rankStatsResult = await supabase.rpc("admin_statement_rank_stats", {
      p_round_id: roundId,
    });
    if (rankStatsResult.error) {
      console.error("admin_statement_rank_stats", {
        code: rankStatsResult.error.code,
      });
      return { ok: false, reason: "load_failed", isUnopenedDraft: draft };
    }
    rankStats = ((rankStatsResult.data ?? []) as RankStatsRow[]).map((row) => ({
      statementId: row.statement_id,
      value: Number(row.value),
      label: row.label,
      respondentCount: Number(row.respondent_count),
      rankedCount: Number(row.ranked_count),
      rankSum: Number(row.rank_sum),
      firstCount: Number(row.first_count),
    }));
  }

  const toStatement = (row: StatementRow): PresentationStatement => ({
    id: row.id,
    key: row.key,
    text: row.text,
    sortOrder: row.sort_order,
    kind: row.kind as PresentationStatement["kind"],
    options: row.options,
    choiceCount: row.choice_count,
    isKey: row.is_key,
    predictionOf: row.prediction_of,
    optional: row.optional,
    label: row.label,
    context: row.context,
    question: row.question,
    revealText: row.reveal_text,
    leftLabel: row.left_label,
    rightLabel: row.right_label,
  });

  const sections = sectionRows
    .map((section) => ({
      sortOrder: section.sort_order,
      label: section.label,
      parentTitle: section.parent_title,
      title: section.title,
      prompt: section.prompt,
      scaleKey: section.scale_key,
      discussionPrompt: section.discussion_prompt,
      showOverview: section.show_overview,
      statements: (section.statements ?? [])
        .map(toStatement)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const scaleOptions = ((scaleOptionsResult.data ?? []) as ScaleOptionRow[]).map(
    (row) => ({
      scaleKey: row.scale_key,
      value: Number(row.value),
      label: row.label,
    })
  );

  const counts = ((countsResult.data ?? []) as AnswerCountRow[]).map(
    (row) => ({
      statementId: row.statement_id,
      value: Number(row.value),
      count: Number(row.answer_count),
    })
  );

  const choiceCounts = ((choiceCountsResult.data ?? []) as ChoiceCountRow[]).map(
    (row) => ({
      statementId: row.statement_id,
      value: Number(row.value),
      label: row.label,
      exclusive: row.exclusive,
      answerCount: Number(row.answer_count),
      respondentCount: Number(row.respondent_count),
    })
  );

  const predictionStats = (
    (predictionStatsResult.data ?? []) as PredictionStatsRow[]
  ).map((row) => ({
    statementId: row.statement_id,
    predictionOfId: row.prediction_of,
    guessCount: Number(row.guess_count),
    averageGuess: row.average_guess === null ? null : Number(row.average_guess),
    actualRespondentCount: Number(row.actual_respondent_count),
    actualAgreeCount: Number(row.actual_agree_count),
    actualAgreePercent:
      row.actual_agree_percent === null ? null : Number(row.actual_agree_percent),
  }));

  const input: PresentationInput = {
    round: {
      title: roundRow.title,
      roundNumber: roundRow.round_number,
      submittedCount: Number(roundRow.submitted_count),
    },
    sections,
    scaleOptions,
    counts,
    choiceCounts,
    predictionStats,
    ...(rankStats ? { rankStats } : {}),
  };

  return { ok: true, input, isUnopenedDraft: draft };
}
