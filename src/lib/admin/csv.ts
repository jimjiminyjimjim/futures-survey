import type { ParticipantResponse } from "@/lib/admin/responses";

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

/**
 * ADM-03: one row per participant, one column per statement key in round
 * order, header email/started_at/submitted_at/<keys>. Rows sorted by
 * email; unanswered cells are empty strings; timestamps are
 * new Date(...).toISOString() (submitted blank when null); every cell is
 * escaped; every line (including the last) ends with CRLF; no BOM.
 */
export function toRoundCsv(
  participants: ParticipantResponse[],
  statementKeysInOrder: string[]
): string {
  const header = ["email", "started_at", "submitted_at", ...statementKeysInOrder]
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
      ...statementKeysInOrder.map((key) => {
        const value = participant.answers[key];
        return value === undefined ? "" : String(value);
      }),
    ];
    return cells.map(escapeCsvCell).join(",");
  });

  return [header, ...lines].map((line) => line + "\r\n").join("");
}
