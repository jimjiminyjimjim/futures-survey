import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type ScaleOption = { value: number; label: string };

export type OrderedStatement = {
  id: string;
  key: string;
  text: string;
  /** 1-based position in round order (section sort_order, then statement sort_order). */
  position: number;
  /** Section's own id — used to group statements into sections (see state.ts's buildSectionSummaries). */
  sectionId: string;
  sectionTitle: string;
  sectionPrompt: string;
  scaleKey: string;
  options: ScaleOption[];
};

export type SurveySnapshot = {
  openRound: { id: string; title: string } | null;
  statements: OrderedStatement[];
  response: { id: string; submittedAt: string | null } | null;
  /** statement_id -> value, for the participant's own answers. */
  answers: Map<string, number>;
  /**
   * True when a Supabase/RPC call failed while building this snapshot.
   * Callers must treat this as distinct from "no round is open" — openRound
   * is still null on this path, but the cause is a real failure, not an
   * absence of an open round.
   */
  hasError: boolean;
};

type SectionRow = {
  id: string;
  sort_order: number;
  title: string;
  prompt: string;
  scale_key: string;
  statements: {
    id: string;
    key: string;
    sort_order: number;
    text: string;
  }[];
};

type RoundRow = {
  id: string;
  title: string;
  sections: SectionRow[];
};

type ScaleOptionRow = {
  scale_key: string;
  value: number;
  label: string;
};

type ResponseRow = {
  id: string;
  submitted_at: string | null;
  answers: { statement_id: string; value: number }[];
};

function emptySnapshot(): SurveySnapshot {
  return {
    openRound: null,
    statements: [],
    response: null,
    answers: new Map(),
    hasError: false,
  };
}

function errorSnapshot(): SurveySnapshot {
  return {
    openRound: null,
    statements: [],
    response: null,
    answers: new Map(),
    hasError: true,
  };
}

/**
 * Server-only. Resolves the open round (if any), its statements in round
 * order with section context and scale options, and the participant's own
 * response/answers for that round. "Open" comes only from the
 * current_open_round_id() RPC — there is no date comparison in TypeScript.
 */
export const getSurveySnapshot = cache(
  async (userId: string): Promise<SurveySnapshot> => {
    const supabase = await createClient();

    const { data: openRoundId, error: openRoundError } = await supabase.rpc(
      "current_open_round_id"
    );

    if (openRoundError) {
      console.error("getSurveySnapshot: current_open_round_id failed", {
        code: openRoundError.code,
        message: openRoundError.message,
      });
      return errorSnapshot();
    }

    if (!openRoundId) {
      return emptySnapshot();
    }

    const [roundResult, scaleOptionsResult, responseResult] =
      await Promise.all([
        supabase
          .from("rounds")
          .select(
            "id, title, sections(id, sort_order, title, prompt, scale_key, statements(id, key, sort_order, text))"
          )
          .eq("id", openRoundId)
          .maybeSingle(),
        supabase
          .from("scale_options")
          .select("scale_key, value, label")
          .order("scale_key")
          .order("value"),
        supabase
          .from("responses")
          .select("id, submitted_at, answers(statement_id, value)")
          .eq("round_id", openRoundId)
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

    if (roundResult.error) {
      console.error("getSurveySnapshot: load round failed", {
        code: roundResult.error.code,
        message: roundResult.error.message,
      });
      return errorSnapshot();
    }
    if (scaleOptionsResult.error) {
      console.error("getSurveySnapshot: load scale options failed", {
        code: scaleOptionsResult.error.code,
        message: scaleOptionsResult.error.message,
      });
      return errorSnapshot();
    }
    if (responseResult.error) {
      console.error("getSurveySnapshot: load response failed", {
        code: responseResult.error.code,
        message: responseResult.error.message,
      });
      return errorSnapshot();
    }

    const round = roundResult.data as RoundRow | null;
    if (!round) {
      return emptySnapshot();
    }

    const scaleOptionRows = (scaleOptionsResult.data ??
      []) as ScaleOptionRow[];
    const optionsByScale = new Map<string, ScaleOption[]>();
    for (const row of scaleOptionRows) {
      const list = optionsByScale.get(row.scale_key) ?? [];
      list.push({ value: row.value, label: row.label });
      optionsByScale.set(row.scale_key, list);
    }
    for (const list of optionsByScale.values()) {
      list.sort((a, b) => a.value - b.value);
    }

    const sections = [...round.sections].sort(
      (a, b) => a.sort_order - b.sort_order
    );

    const statements: OrderedStatement[] = [];
    for (const section of sections) {
      const sectionStatements = [...section.statements].sort(
        (a, b) => a.sort_order - b.sort_order
      );
      for (const statement of sectionStatements) {
        statements.push({
          id: statement.id,
          key: statement.key,
          text: statement.text,
          position: statements.length + 1,
          sectionId: section.id,
          sectionTitle: section.title,
          sectionPrompt: section.prompt,
          scaleKey: section.scale_key,
          options: optionsByScale.get(section.scale_key) ?? [],
        });
      }
    }

    const response = responseResult.data as ResponseRow | null;
    const answers = new Map<string, number>();
    for (const answer of response?.answers ?? []) {
      answers.set(answer.statement_id, answer.value);
    }

    return {
      openRound: { id: round.id, title: round.title },
      statements,
      response: response
        ? { id: response.id, submittedAt: response.submitted_at }
        : null,
      answers,
      hasError: false,
    };
  }
);
