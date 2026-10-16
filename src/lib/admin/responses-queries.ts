import { createClient } from "@/lib/supabase/server";
import { getRoundDetail, type AdminRoundRow } from "@/lib/admin/rounds-queries";
import {
  pivotResponses,
  type AdminResponseRow,
  type ParticipantResponse,
} from "@/lib/admin/responses";

export type RoundResponsesStatement = {
  key: string;
  text: string;
  sectionTitle: string;
  scaleKey: string;
  position: number;
};

export type RoundResponsesResult =
  | {
      ok: true;
      round: AdminRoundRow;
      statements: RoundResponsesStatement[];
      optionLabels: Record<string, Record<number, string>>;
      participants: ParticipantResponse[];
    }
  | { ok: false };

type ScaleOptionRow = { scale_key: string; value: number; label: string };

/**
 * ADM-02/ADM-03's single data source: a round's detail (reused from the
 * editor), every scale option label, and the identity-bearing
 * admin_round_responses RPC, pivoted into one row per participant. Returns
 * null when the round itself doesn't exist, { ok: false } on any other
 * query/RPC error (logging only the operation name and error code — never
 * emails or values).
 */
export async function getRoundResponses(
  roundId: string
): Promise<RoundResponsesResult | null> {
  const supabase = await createClient();

  const [detail, scaleOptionsResult, responsesResult] = await Promise.all([
    getRoundDetail(roundId),
    supabase.from("scale_options").select("scale_key, value, label"),
    supabase.rpc("admin_round_responses", { p_round_id: roundId }),
  ]);

  if (!detail) {
    return null;
  }

  if (scaleOptionsResult.error) {
    console.error("scale_options", { code: scaleOptionsResult.error.code });
    return { ok: false };
  }

  if (responsesResult.error) {
    console.error("admin_round_responses", {
      code: responsesResult.error.code,
    });
    return { ok: false };
  }

  const optionLabels: Record<string, Record<number, string>> = {};
  for (const row of (scaleOptionsResult.data ?? []) as ScaleOptionRow[]) {
    optionLabels[row.scale_key] ??= {};
    optionLabels[row.scale_key][row.value] = row.label;
  }

  const statements: RoundResponsesStatement[] = [];
  let position = 0;
  for (const section of detail.sections) {
    for (const statement of section.statements) {
      position += 1;
      statements.push({
        key: statement.key,
        text: statement.text,
        sectionTitle: section.title,
        scaleKey: section.scaleKey,
        position,
      });
    }
  }

  const participants = pivotResponses(
    (responsesResult.data ?? []) as AdminResponseRow[]
  );

  return {
    ok: true,
    round: detail.round,
    statements,
    optionLabels,
    participants,
  };
}
