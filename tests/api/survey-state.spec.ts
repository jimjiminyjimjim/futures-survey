import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, expect } from "@playwright/test";
import {
  resolveSurveyScreen,
  questionCountLabel,
  roughMinutesLabel,
  progressLabel,
} from "@/lib/survey/state";
import {
  NoOpenRoundScreen,
  ThanksScreen,
} from "@/components/survey/status-screens";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

/**
 * Pure resolver/label tests (no DB, no server) plus a server-render check
 * of the two static status screens — proves the no-open-round screen
 * without ever touching the live project's actually-open Round 1
 * (tests/api/round-1-content.spec.ts and survey-visibility.spec.ts cover
 * the DB side; this file never calls Supabase at all).
 */
test.describe("survey state @survey-state", () => {
  const KEYS = ["k1", "k2", "k3"];

  test("null round resolves to no-round", () => {
    const screen = resolveSurveyScreen({
      openRound: null,
      orderedStatementKeys: KEYS,
      response: null,
      answeredKeys: new Set(),
    });
    expect(screen).toEqual({ kind: "no-round" });
  });

  test("zero statements resolves to no-round even with an open round", () => {
    const screen = resolveSurveyScreen({
      openRound: { title: "Round 1" },
      orderedStatementKeys: [],
      response: null,
      answeredKeys: new Set(),
    });
    expect(screen).toEqual({ kind: "no-round" });
  });

  test("a submitted response resolves to thanks regardless of answered count", () => {
    for (const answeredKeys of [new Set<string>(), new Set(KEYS)]) {
      const screen = resolveSurveyScreen({
        openRound: { title: "Round 1" },
        orderedStatementKeys: KEYS,
        response: { submittedAt: "2026-10-15T00:00:00Z" },
        answeredKeys,
      });
      expect(screen).toEqual({ kind: "thanks" });
    }
  });

  test("null response resolves to start with the first key", () => {
    const screen = resolveSurveyScreen({
      openRound: { title: "Round 1" },
      orderedStatementKeys: KEYS,
      response: null,
      answeredKeys: new Set(),
    });
    expect(screen).toEqual({
      kind: "start",
      roundTitle: "Round 1",
      questionCount: 3,
      firstStatementKey: "k1",
    });
  });

  test("an unsubmitted response with zero answers resolves to start", () => {
    const screen = resolveSurveyScreen({
      openRound: { title: "Round 1" },
      orderedStatementKeys: KEYS,
      response: { submittedAt: null },
      answeredKeys: new Set(),
    });
    expect(screen.kind).toBe("start");
  });

  test("answered {k1} resolves to resume k2 (first unanswered)", () => {
    const screen = resolveSurveyScreen({
      openRound: { title: "Round 1" },
      orderedStatementKeys: KEYS,
      response: { submittedAt: null },
      answeredKeys: new Set(["k1"]),
    });
    expect(screen).toEqual({ kind: "resume", statementKey: "k2" });
  });

  test("answered {k1, k3} resolves to resume k2, not the last visited (k3)", () => {
    const screen = resolveSurveyScreen({
      openRound: { title: "Round 1" },
      orderedStatementKeys: KEYS,
      response: { submittedAt: null },
      answeredKeys: new Set(["k1", "k3"]),
    });
    expect(screen).toEqual({ kind: "resume", statementKey: "k2" });
  });

  test("all answered and unsubmitted resolves to review", () => {
    const screen = resolveSurveyScreen({
      openRound: { title: "Round 1" },
      orderedStatementKeys: KEYS,
      response: { submittedAt: null },
      answeredKeys: new Set(KEYS),
    });
    expect(screen).toEqual({ kind: "review" });
  });

  test("questionCountLabel", () => {
    expect(questionCountLabel(1)).toBe("1 question");
    expect(questionCountLabel(85)).toBe("85 questions");
  });

  test("roughMinutesLabel", () => {
    expect(roughMinutesLabel(1)).toBe("about 1 minute");
    expect(roughMinutesLabel(3)).toBe("about 1 minute");
    expect(roughMinutesLabel(9)).toBe("about 2 minutes");
    expect(roughMinutesLabel(85)).toBe("about 14 minutes");
  });

  test("progressLabel", () => {
    expect(progressLabel(23, 85)).toBe("23 of 85");
  });

  function decodeEntities(html: string): string {
    return html
      .replaceAll("&#x27;", "'")
      .replaceAll("&quot;", '"')
      .replaceAll("&amp;", "&");
  }

  test("NoOpenRoundScreen server-renders the exact heading/body copy", () => {
    const html = decodeEntities(
      renderToStaticMarkup(createElement(NoOpenRoundScreen))
    );
    expect(html).toContain('role="heading"');
    expect(html).toContain('aria-level="1"');
    expect(html).toContain(SURVEY_MESSAGES.noRoundHeading);
    expect(html).toContain(SURVEY_MESSAGES.noRoundBody);
  });

  test("ThanksScreen server-renders the exact heading/body copy (em dash included)", () => {
    const html = decodeEntities(
      renderToStaticMarkup(createElement(ThanksScreen))
    );
    expect(html).toContain('role="heading"');
    expect(html).toContain('aria-level="1"');
    expect(html).toContain(SURVEY_MESSAGES.thanksHeading);
    expect(html).toContain(SURVEY_MESSAGES.thanksBody);
    expect(SURVEY_MESSAGES.thanksHeading).toContain("—");
  });
});
