import type { ParticipantResponse } from "@/lib/admin/responses";
import {
  isListKind,
  type ChoiceOption,
  type QuestionKind,
} from "@/lib/survey/answer-rules";

/**
 * OWASP CSV-injection guard (leading apostrophe on =, +, -, @, TAB, CR)
 * followed by RFC 4180 quoting (comma, double quote, CR, or LF triggers
 * quoting, with inner double quotes doubled). Pure, no DOM/Node APIs.
 */
export function escapeCsvCell(raw: string): string {
  let value = raw;
  if (/^[=+\-@\t\r]/.test(value)) {
    value = "'" + value;
  }
  if (/[",\r\n]/.test(value)) {
    value = `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** One CSV column's statement shape — just enough to pick the right cell rule by kind. */
export type CsvStatementColumn = {
  key: string;
  kind: QuestionKind;
  /** Choice kinds only: this statement's own options, for label lookup. */
  options: ChoiceOption[];
};

/**
 * One statement's CSV cell for one participant: scale/choice_one/
 * prediction/rating/two_ended = the raw numeric value, or blank when
 * unanswered/skipped; choice_multi/choice_exact/choice_up_to = the picked
 * options' labels, joined with "; " (falling back to the raw number for
 * an option whose label can't be found), or blank when nothing was
 * picked.
 */
function cellValue(
  participant: ParticipantResponse,
  statement: CsvStatementColumn
): string {
  if (isListKind(statement.kind)) {
    const picks = participant.choiceAnswers?.[statement.key];
    if (!picks || picks.length === 0) {
      return "";
    }
    return picks
      .map(
        (value) =>
          statement.options.find((o) => o.value === value)?.label ??
          String(value)
      )
      .join("; ");
  }
  const value = participant.answers[statement.key];
  return value === undefined ? "" : String(value);
}

/**
 * ADM-03: one row per participant, one column per statement key in round
 * order, header email/started_at/submitted_at/<keys>. Rows sorted by
 * email; unanswered cells are empty strings; timestamps are
 * new Date(...).toISOString() (submitted blank when null); every cell is
 * escaped; every line (including the last) ends with CRLF; no BOM.
 *
 * Accepts either the full per-kind column shape (surveys v2 part B) or a
 * plain array of statement keys (the pre-v2 shape, still used by
 * tests/api/admin-responses-db.spec.ts and tests/e2e/admin-responses.spec.ts)
 * — a bare key is treated as a `scale`-kind column with no options, which
 * reproduces the original "always the raw numeric value" behaviour exactly.
 *
 * When `includeConsent` is true (261018-qck), two extra columns —
 * results_opt_in ("yes"/"no") and results_opt_in_at (ISO, or blank) — are
 * inserted right after submitted_at. The default (omitted/false) output
 * is unchanged, so existing call sites match exactly.
 */
export function toRoundCsv(
  participants: ParticipantResponse[],
  statementsInOrder: (string | CsvStatementColumn)[],
  options?: { includeConsent?: boolean }
): string {
  const includeConsent = options?.includeConsent ?? false;
  const columns: CsvStatementColumn[] = statementsInOrder.map((s) =>
    typeof s === "string" ? { key: s, kind: "scale", options: [] } : s
  );

  const header = [
    "email",
    "started_at",
    "submitted_at",
    ...(includeConsent ? ["results_opt_in", "results_opt_in_at"] : []),
    ...columns.map((s) => s.key),
  ]
    .map(escapeCsvCell)
    .join(",");

  const sorted = [...participants].sort((a, b) =>
    a.email < b.email ? -1 : a.email > b.email ? 1 : 0
  );

  const lines = sorted.map((participant) => {
    const cells = [
      participant.email,
      new Date(participant.startedAt).toISOString(),
      participant.submittedAt
        ? new Date(participant.submittedAt).toISOString()
        : "",
      ...(includeConsent
        ? [
            participant.resultsOptedIn ? "yes" : "no",
            participant.resultsOptedInAt
              ? new Date(participant.resultsOptedInAt).toISOString()
              : "",
          ]
        : []),
      ...columns.map((statement) => cellValue(participant, statement)),
    ];
    return cells.map(escapeCsvCell).join(",");
  });

  return [header, ...lines].map((line) => line + "\r\n").join("");
}
