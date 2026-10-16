import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getRoundDetail } from "@/lib/admin/rounds-queries";
import type { PresentationInput } from "./types";

type AnswerCountRow = {
  statement_id: string;
  statement_key: string;
  value: number;
  answer_count: number;
};

type ScaleOptionRow = {
  scale_key: string;
  value: number;
  label: string;
};

export type GetPresentationDataResult =
  | { ok: true; input: PresentationInput }
  | { ok: false; reason: "not_found" | "load_failed" };

/**
 * Server-only. Loads everything the presentation deck needs for one
 * round: Phase 3's getRoundDetail (round + sections + statements) plus
 * two identity-free reads under the caller's own admin JWT —
 * admin_statement_answer_counts (submitted-only aggregates) and
 * scale_options. Never reads an identity-bearing table or function.
 */
export async function getPresentationData(
  roundId: string
): Promise<GetPresentationDataResult> {
  const detail = await getRoundDetail(roundId);
  if (!detail) {
    return { ok: false, reason: "not_found" };
  }

  for (const section of detail.sections) {
    if (section.scaleKey !== "agreement" && section.scaleKey !== "familiarity") {
      console.error("presentation_unknown_scale");
      return { ok: false, reason: "load_failed" };
    }
  }

  const supabase = await createClient();

  const [countsResult, scaleOptionsResult] = await Promise.all([
    supabase.rpc("admin_statement_answer_counts", { p_round_id: roundId }),
    supabase
      .from("scale_options")
      .select("scale_key, value, label")
      .order("scale_key")
      .order("value"),
  ]);

  if (countsResult.error) {
    console.error("admin_statement_answer_counts", {
      code: countsResult.error.code,
    });
    return { ok: false, reason: "load_failed" };
  }
  if (scaleOptionsResult.error) {
    console.error("scale_options", { code: scaleOptionsResult.error.code });
    return { ok: false, reason: "load_failed" };
  }

  const counts = ((countsResult.data ?? []) as AnswerCountRow[]).map(
    (row) => ({
      statementId: row.statement_id,
      value: Number(row.value),
      count: Number(row.answer_count),
    })
  );

  const scaleOptions = ((scaleOptionsResult.data ?? []) as ScaleOptionRow[]).map(
    (row) => ({
      scaleKey: row.scale_key,
      value: Number(row.value),
      label: row.label,
    })
  );

  const input: PresentationInput = {
    round: {
      title: detail.round.title,
      roundNumber: detail.round.roundNumber,
      submittedCount: detail.round.submittedCount,
    },
    sections: detail.sections.map((section) => ({
      sortOrder: section.sortOrder,
      title: section.title,
      prompt: section.prompt,
      scaleKey: section.scaleKey,
      statements: section.statements.map((statement) => ({
        id: statement.id,
        key: statement.key,
        text: statement.text,
        sortOrder: statement.sortOrder,
      })),
    })),
    scaleOptions,
    counts,
  };

  return { ok: true, input };
}
