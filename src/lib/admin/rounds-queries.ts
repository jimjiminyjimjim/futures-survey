import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

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
};

export type RoundStatement = {
  id: string;
  key: string;
  text: string;
  sortOrder: number;
};

export type RoundSection = {
  id: string;
  sortOrder: number;
  title: string;
  prompt: string;
  scaleKey: string;
  statements: RoundStatement[];
};

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
  };
}

type SectionWithStatementsRow = {
  id: string;
  sort_order: number;
  title: string;
  prompt: string;
  scale_key: string;
  statements:
    | { id: string; key: string; sort_order: number; text: string }[]
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
          "id, sort_order, title, prompt, scale_key, statements(id, key, sort_order, text)"
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
        statements: (section.statements ?? [])
          .map((statement) => ({
            id: statement.id,
            key: statement.key,
            text: statement.text,
            sortOrder: statement.sort_order,
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
