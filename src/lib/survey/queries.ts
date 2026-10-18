import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

import {
  parseChoiceOptions,
  type AnswerValue,
  type ChoiceOption,
  type QuestionKind,
} from "@/lib/survey/answer-rules";

export type { AnswerValue, ChoiceOption, QuestionKind };

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
  /** Display numbering, e.g. "1", "2a", "11b" (null for unlabelled sections). */
  sectionLabel: string | null;
  /** Parent section title for subsections, e.g. "What is design?" for 2a. */
  sectionParentTitle: string | null;
  scaleKey: string;
  kind: QuestionKind;
  /**
   * The choices to render: the section scale's options for `scale`, the
   * statement's own options for choice kinds, [] for `prediction`,
   * `rating` and `two_ended`.
   */
  options: ChoiceOption[];
  /** choice_exact / choice_up_to only: how many options must be picked (at most, for choice_up_to). */
  choiceCount: number | null;
  /** Optional questions (predictions) don't count towards completeness. */
  optional: boolean;
  /** prediction only: the statement whose agreement is being guessed. */
  predictionOf: { key: string; text: string } | null;
  /** Item sub-label, e.g. "2a", shown above the statement text. */
  label: string | null;
  /** Source line shown above the statement text, e.g. "Shein (2023)". */
  context: string | null;
  /** Per-item question shown below the statement text; overrides the section prompt. */
  question: string | null;
  /** rating/two_ended only: label at the low end of the scale. */
  leftLabel: string | null;
  /** rating/two_ended only: label at the high end of the scale. */
  rightLabel: string | null;
};

export type SurveySnapshot = {
  openRound: {
    id: string;
    title: string;
    surveyTitle: string | null;
    /** 1-based part (session) number within the survey, e.g. 1 of 3. */
    partNumber: number | null;
    totalParts: number | null;
    /** Verbatim participant-facing intro copy for the start screen, if set. */
    intro: string | null;
  } | null;
  statements: OrderedStatement[];
  response: { id: string; submittedAt: string | null } | null;
  /** statement_id -> saved answer, for the participant's own answers. */
  answers: Map<string, AnswerValue>;
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
  label: string | null;
  parent_title: string | null;
  statements: {
    id: string;
    key: string;
    sort_order: number;
    text: string;
    kind: QuestionKind;
    options: unknown;
    choice_count: number | null;
    optional: boolean;
    prediction_of: string | null;
    label: string | null;
    context: string | null;
    question: string | null;
    left_label: string | null;
    right_label: string | null;
  }[];
};

type RoundRow = {
  id: string;
  title: string;
  session_number: number | null;
  intro: string | null;
  surveys: { title: string } | null;
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
  answers: {
    statement_id: string;
    value: number | null;
    choice_values: number[] | null;
  }[];
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
 *
 * Presentation-only columns (sections.discussion_prompt, statements.is_key,
 * and the presentation-only reveal text column) are deliberately never
 * selected here: participants must not receive them.
 */
const SURVEY_PARTS = 3;

export const getSurveySnapshot = cache(
  async (userId: string): Promise<SurveySnapshot> => {
    const supabase = await createClient();

    // One retry: a transient failure (seen in dev as an error object with no
    // code/message) shouldn't drop the participant onto the error screen.
    let { data: openRoundId, error: openRoundError } = await supabase.rpc(
      "current_open_round_id"
    );
    if (openRoundError) {
      ({ data: openRoundId, error: openRoundError } = await supabase.rpc(
        "current_open_round_id"
      ));
    }

    if (openRoundError) {
      const e = openRoundError as unknown as Record<string, unknown>;
      console.error("getSurveySnapshot: current_open_round_id failed", {
        name: e.name,
        code: e.code,
        message: e.message,
        details: e.details,
        hint: e.hint,
        status: e.status,
        raw: String(openRoundError),
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
            "id, title, session_number, intro, surveys(title), sections(id, sort_order, title, prompt, scale_key, label, parent_title, statements(id, key, sort_order, text, kind, options, choice_count, optional, prediction_of, label, context, question, left_label, right_label))"
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
          .select("id, submitted_at, answers(statement_id, value, choice_values)")
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
    const optionsByScale = new Map<string, ChoiceOption[]>();
    for (const row of scaleOptionRows) {
      const list = optionsByScale.get(row.scale_key) ?? [];
      list.push({ value: row.value, label: row.label, exclusive: false });
      optionsByScale.set(row.scale_key, list);
    }
    for (const list of optionsByScale.values()) {
      list.sort((a, b) => a.value - b.value);
    }

    const sections = [...round.sections].sort(
      (a, b) => a.sort_order - b.sort_order
    );

    const statementById = new Map<string, { key: string; text: string }>();
    for (const section of sections) {
      for (const statement of section.statements) {
        statementById.set(statement.id, {
          key: statement.key,
          text: statement.text,
        });
      }
    }

    const statements: OrderedStatement[] = [];
    for (const section of sections) {
      const sectionStatements = [...section.statements].sort(
        (a, b) => a.sort_order - b.sort_order
      );
      for (const statement of sectionStatements) {
        const kind = statement.kind;
        const options =
          kind === "scale"
            ? (optionsByScale.get(section.scale_key) ?? [])
            : kind === "prediction" || kind === "rating" || kind === "two_ended"
              ? []
              : parseChoiceOptions(statement.options);
        statements.push({
          id: statement.id,
          key: statement.key,
          text: statement.text,
          position: statements.length + 1,
          sectionId: section.id,
          sectionTitle: section.title,
          sectionPrompt: section.prompt,
          sectionLabel: section.label,
          sectionParentTitle: section.parent_title,
          scaleKey: section.scale_key,
          kind,
          options,
          choiceCount: statement.choice_count,
          optional: statement.optional,
          predictionOf: statement.prediction_of
            ? (statementById.get(statement.prediction_of) ?? null)
            : null,
          label: statement.label,
          context: statement.context,
          question: statement.question,
          leftLabel: statement.left_label,
          rightLabel: statement.right_label,
        });
      }
    }

    const response = responseResult.data as ResponseRow | null;
    const answers = new Map<string, AnswerValue>();
    for (const answer of response?.answers ?? []) {
      answers.set(answer.statement_id, {
        value: answer.value,
        choiceValues: answer.choice_values,
      });
    }

    return {
      openRound: {
        id: round.id,
        title: round.title,
        surveyTitle: round.surveys?.title ?? null,
        partNumber: round.session_number ?? null,
        // Participants can only read the OPEN round (RLS), so they can't count
        // the survey's rounds; every survey has exactly 3 parts (the DB
        // refuses a 4th session), so the total is fixed.
        totalParts: SURVEY_PARTS,
        intro: round.intro,
      },
      statements,
      response: response
        ? { id: response.id, submittedAt: response.submitted_at }
        : null,
      answers,
      hasError: false,
    };
  }
);

export type ResultsConsentSnapshot = { optedIn: boolean; hasError: boolean };

/**
 * Server-only. Reads the signed-in participant's own results_consent row
 * (RLS limits this to their own row). Logs only the code/message on
 * failure (PRIV-02).
 */
export const getResultsConsent = cache(
  async (userId: string): Promise<ResultsConsentSnapshot> => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("results_consent")
      .select("consented")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("getResultsConsent: load failed", {
        code: error.code,
        message: error.message,
      });
      return { optedIn: false, hasError: true };
    }

    return { optedIn: data?.consented === true, hasError: false };
  }
);
