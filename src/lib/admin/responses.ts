/**
 * Pure helpers for ADM-02/ADM-03's participant responses view — no server
 * imports, no DB access. Mirrors the long-row shape the migration
 * 20261015000800 identity-bearing RPC returns.
 */

export type AdminResponseRow = {
  response_id: string;
  user_email: string;
  started_at: string;
  submitted_at: string | null;
  statement_key: string | null;
  value: number | null;
  /** choice_multi / choice_exact / choice_up_to picks; value is null then. */
  choice_values?: number[] | null;
  /** 261018-qck: results opt-in, repeated on every row for a response. */
  results_opted_in?: boolean;
  results_opted_in_at?: string | null;
};

export type ParticipantResponse = {
  responseId: string;
  email: string;
  startedAt: string;
  submittedAt: string | null;
  answers: Record<string, number>;
  /** statement key -> picks, for choice_multi / choice_exact / choice_up_to answers (only present when there are any). */
  choiceAnswers?: Record<string, number[]>;
  answeredCount: number;
  /** Optional so pre-261018-qck fixtures keep typechecking. */
  resultsOptedIn?: boolean;
  resultsOptedInAt?: string | null;
};

/**
 * Groups the identity-bearing RPC's long rows (one per response/answer
 * pair, with a single null-keyed row for a response with zero answers)
 * into one ParticipantResponse per response_id, sorted by email ascending
 * (emails are unique per user, so the order is total).
 */
export function pivotResponses(rows: AdminResponseRow[]): ParticipantResponse[] {
  const byResponseId = new Map<string, ParticipantResponse>();

  for (const row of rows) {
    let entry = byResponseId.get(row.response_id);
    if (!entry) {
      entry = {
        responseId: row.response_id,
        email: row.user_email,
        startedAt: row.started_at,
        submittedAt: row.submitted_at,
        answers: {},
        answeredCount: 0,
        // Repeated identically on every row for this response — read once
        // at entry creation.
        resultsOptedIn: row.results_opted_in,
        resultsOptedInAt: row.results_opted_in_at,
      };
      byResponseId.set(row.response_id, entry);
    }

    if (row.statement_key !== null && row.value !== null) {
      entry.answers[row.statement_key] = row.value;
      entry.answeredCount += 1;
    } else if (
      row.statement_key !== null &&
      row.choice_values != null &&
      row.choice_values.length > 0
    ) {
      entry.choiceAnswers ??= {};
      entry.choiceAnswers[row.statement_key] = row.choice_values;
      entry.answeredCount += 1;
    }
  }

  return [...byResponseId.values()].sort((a, b) =>
    a.email < b.email ? -1 : a.email > b.email ? 1 : 0
  );
}
