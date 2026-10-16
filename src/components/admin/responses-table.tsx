"use client";

import type { ReactNode } from "react";
import { Fragment, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AnswerScaleIndicator } from "@/components/admin/answer-scale-indicator";
import { formatAdminDateTime } from "@/lib/admin/datetime";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";
import type { RoundResponsesStatement } from "@/lib/admin/responses-queries";
import type { ParticipantResponse } from "@/lib/admin/responses";

type SectionGroup = {
  sectionTitle: string;
  statements: RoundResponsesStatement[];
};

/**
 * Groups the flat, position-ordered statement list back into the sections
 * it came from (responses-queries.ts walks `detail.sections` in order to
 * build it, so consecutive runs of the same sectionTitle reconstruct the
 * original grouping without needing a separate section id).
 */
function groupBySection(
  statements: RoundResponsesStatement[]
): SectionGroup[] {
  const groups: SectionGroup[] = [];
  for (const statement of statements) {
    const current = groups[groups.length - 1];
    if (current && current.sectionTitle === statement.sectionTitle) {
      current.statements.push(statement);
    } else {
      groups.push({ sectionTitle: statement.sectionTitle, statements: [statement] });
    }
  }
  return groups;
}

/**
 * One statement's answer row in the expanded panel: question number + text
 * on the left, a compact filled/empty scale indicator plus the answer
 * label on the right (stacked on narrow screens). The indicator is purely
 * decorative (aria-hidden); its numeric value reaches screen readers via
 * sr-only text instead.
 */
function AnswerRow({
  statement,
  number,
  value,
  label,
  total,
}: {
  statement: RoundResponsesStatement;
  /** 1-based position within its section (numbering restarts per section). */
  number: number;
  value: number | undefined;
  label: string | undefined;
  total: number;
}) {
  const answered = value !== undefined && label !== undefined;

  return (
    <li className="grid grid-cols-1 items-start gap-x-4 gap-y-1 py-2 sm:grid-cols-[1fr_auto] sm:items-center">
      <span className="text-sm">
        <span className="text-muted-foreground">{number}.</span>{" "}
        {statement.text}
      </span>
      {/* Label first, dots last: right-aligned, so every row's dots line up
          at the same right edge regardless of label length. */}
      <span className="flex items-center gap-3 sm:justify-end">
        {answered ? (
          <span className="text-sm font-medium sm:text-right">{label}</span>
        ) : (
          <span className="text-sm text-muted-foreground sm:text-right">
            {ADMIN_MESSAGES.notAnswered}
          </span>
        )}
        <AnswerScaleIndicator
          value={value}
          total={total}
          srLabel={answered ? ADMIN_MESSAGES.answerSrLabel(value, total) : undefined}
        />
      </span>
    </li>
  );
}

/**
 * ADM-02's participant table: email filter, status/started/submitted/
 * answered columns, and an expandable per-participant answers row. Nothing
 * is logged client-side (this component never calls console.*).
 */
export function ResponsesTable({
  participants,
  statements,
  optionLabels,
  heading,
  actions,
}: {
  participants: ParticipantResponse[];
  statements: RoundResponsesStatement[];
  optionLabels: Record<string, Record<number, string>>;
  /** Left side of the toolbar row (section title + count). */
  heading?: ReactNode;
  /** Rendered right of the email filter (e.g. Export CSV). */
  actions?: ReactNode;
}) {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const normalizedFilter = filter.trim().toLowerCase();
  const visible = normalizedFilter
    ? participants.filter((p) =>
        p.email.toLowerCase().includes(normalizedFilter)
      )
    : participants;

  const sectionGroups = useMemo(() => groupBySection(statements), [statements]);
  const scaleSizes = useMemo(() => {
    const sizes: Record<string, number> = {};
    for (const statement of statements) {
      sizes[statement.scaleKey] ??= Object.keys(
        optionLabels[statement.scaleKey] ?? {}
      ).length;
    }
    return sizes;
  }, [statements, optionLabels]);

  function toggle(responseId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(responseId)) {
        next.delete(responseId);
      } else {
        next.add(responseId);
      }
      return next;
    });
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
              <TableHead>Answered</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((participant) => {
              const isExpanded = expanded.has(participant.responseId);
              const panelId = `responses-answers-${participant.responseId}`;
              return (
                <Fragment key={participant.responseId}>
                  <TableRow>
                    <TableCell
                      className="max-w-xs break-all whitespace-normal"
                      title={participant.email}
                    >
                      {participant.email}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          participant.submittedAt ? "default" : "outline"
                        }
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
                      {ADMIN_MESSAGES.answeredOf(
                        participant.answeredCount,
                        statements.length
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                        onClick={() => toggle(participant.responseId)}
                      >
                        {isExpanded
                          ? ADMIN_MESSAGES.hideAnswers
                          : ADMIN_MESSAGES.showAnswers}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {isExpanded ? (
                    <TableRow
                      id={panelId}
                      className="border-l-2 border-l-primary bg-muted"
                    >
                      <TableCell colSpan={6}>
                        <div className="flex flex-col gap-4 py-2">
                          {sectionGroups.map((group, groupIndex) => (
                            <Fragment key={group.sectionTitle + groupIndex}>
                              {groupIndex > 0 ? <Separator /> : null}
                              <div className="flex flex-col gap-1">
                                <h4 className="pt-2 text-base font-semibold text-foreground">
                                  {group.sectionTitle}
                                </h4>
                                <ul className="flex flex-col divide-y divide-border">
                                  {group.statements.map((statement, statementIndex) => {
                                    const value =
                                      participant.answers[statement.key];
                                    const label =
                                      value !== undefined
                                        ? optionLabels[statement.scaleKey]?.[
                                            value
                                          ]
                                        : undefined;
                                    return (
                                      <AnswerRow
                                        key={statement.key}
                                        statement={statement}
                                        number={statementIndex + 1}
                                        value={value}
                                        label={label}
                                        total={scaleSizes[statement.scaleKey] ?? 0}
                                      />
                                    );
                                  })}
                                </ul>
                              </div>
                            </Fragment>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
