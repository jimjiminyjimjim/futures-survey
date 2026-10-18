"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAdminDateTime } from "@/lib/admin/datetime";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";
import type { RoundResponsesStatement } from "@/lib/admin/responses-queries";
import type { ParticipantResponse } from "@/lib/admin/responses";
import { isListKind } from "@/lib/survey/answer-rules";

/** True when the participant has an answer for this statement, any kind. */
function hasParticipantAnswer(
  participant: ParticipantResponse,
  statement: RoundResponsesStatement
): boolean {
  if (isListKind(statement.kind)) {
    return (participant.choiceAnswers?.[statement.key]?.length ?? 0) > 0;
  }
  return participant.answers[statement.key] !== undefined;
}

/**
 * ADM-02's participant table: email filter and status/started/submitted/
 * answered columns. Individual answers are deliberately never shown, so
 * responses stay anonymous to admins. Nothing is logged client-side (this
 * component never calls console.*).
 */
export function ResponsesTable({
  participants,
  statements,
  heading,
  actions,
}: {
  participants: ParticipantResponse[];
  statements: RoundResponsesStatement[];
  /** Left side of the toolbar row (section title + count). */
  heading?: ReactNode;
  /** Rendered right of the email filter (e.g. Export CSV). */
  actions?: ReactNode;
}) {
  const [filter, setFilter] = useState("");

  const normalizedFilter = filter.trim().toLowerCase();
  const visible = normalizedFilter
    ? participants.filter((p) =>
        p.email.toLowerCase().includes(normalizedFilter)
      )
    : participants;

  // Completion counts required (non-optional) questions only — predictions
  // are optional and don't count towards either side of "n of m answered".
  const requiredStatements = useMemo(
    () => statements.filter((s) => !s.optional),
    [statements]
  );

  function countRequiredAnswered(participant: ParticipantResponse): number {
    let n = 0;
    for (const statement of requiredStatements) {
      if (hasParticipantAnswer(participant, statement)) {
        n += 1;
      }
    }
    return n;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>{heading}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="responses-email-filter" className="sr-only">
            {ADMIN_MESSAGES.filterByEmail}
          </Label>
          <Input
            id="responses-email-filter"
            type="search"
            placeholder={ADMIN_MESSAGES.filterByEmail}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-64"
          />
          {actions}
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>{ADMIN_MESSAGES.optedInHeading}</TableHead>
              <TableHead>Answered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((participant) => (
              <TableRow key={participant.responseId}>
                <TableCell
                  className="max-w-xs break-all whitespace-normal"
                  title={participant.email}
                >
                  {participant.email}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={participant.submittedAt ? "default" : "outline"}
                  >
                    {participant.submittedAt
                      ? ADMIN_MESSAGES.badgeSubmitted
                      : ADMIN_MESSAGES.badgeStarted}
                  </Badge>
                </TableCell>
                <TableCell>
                  {formatAdminDateTime(participant.startedAt)}
                </TableCell>
                <TableCell>
                  {formatAdminDateTime(participant.submittedAt) ??
                    ADMIN_MESSAGES.noSubmittedTime}
                </TableCell>
                <TableCell>
                  {participant.resultsOptedIn ? (
                    <Badge variant="secondary">
                      {ADMIN_MESSAGES.optedInBadge}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  {ADMIN_MESSAGES.answeredOf(
                    countRequiredAnswered(participant),
                    requiredStatements.length
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
