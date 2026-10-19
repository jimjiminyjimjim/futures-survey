import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, expect } from "@playwright/test";
import {
  resolveSurveyScreen,
  questionCountLabel,
  roughMinutesLabel,
  progressLabel,
  buildSectionSummaries,
  canonicalStatementKey,
  resolveStatementNav,
  resolveSectionScreen,
  type SectionGroupableStatement,
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

test.describe("grouped sections @survey-state", () => {
  // Three sections: A (ungrouped, a1/a2), C (grouped, c1/c2/c3), D
  // (ungrouped, d1).
  const fixture: SectionGroupableStatement[] = [
    { key: "a1", sectionId: "sA", sectionTitle: "A title", sectionPrompt: "A prompt", sectionLabel: "A" },
    { key: "a2", sectionId: "sA", sectionTitle: "A title", sectionPrompt: "A prompt", sectionLabel: "A" },
    { key: "c1", sectionId: "sC", sectionTitle: "C title", sectionPrompt: "C prompt", sectionLabel: "C", sectionGrouped: true },
    { key: "c2", sectionId: "sC", sectionTitle: "C title", sectionPrompt: "C prompt", sectionLabel: "C", sectionGrouped: true },
    { key: "c3", sectionId: "sC", sectionTitle: "C title", sectionPrompt: "C prompt", sectionLabel: "C", sectionGrouped: true },
    { key: "d1", sectionId: "sD", sectionTitle: "D title", sectionPrompt: "D prompt", sectionLabel: "D" },
  ];
  const sections = buildSectionSummaries(fixture);

  test("buildSectionSummaries marks C grouped, A and D not", () => {
    expect(sections.map((s) => ({ label: s.label, grouped: s.grouped }))).toEqual([
      { label: "A", grouped: false },
      { label: "C", grouped: true },
      { label: "D", grouped: false },
    ]);
  });

  test("canonicalStatementKey: any key in a grouped section maps to the section's first key; ungrouped and unknown keys return themselves", () => {
    expect(canonicalStatementKey(sections, "c3")).toBe("c1");
    expect(canonicalStatementKey(sections, "c1")).toBe("c1");
    expect(canonicalStatementKey(sections, "a2")).toBe("a2");
    expect(canonicalStatementKey(sections, "nope")).toBe("nope");
  });

  test("resolveStatementNav: a grouped section's statement navigates as one stop at its section's break screens", () => {
    const nav = resolveStatementNav(sections, "c2");
    expect(nav?.prevHref).toBe("/survey/section/2");
    expect(nav?.nextHref).toBe("/survey/section/3");
    expect(nav?.position.positionInSection).toBe(3);
    expect(nav?.position.countInSection).toBe(3);
  });

  test("resolveStatementNav: ungrouped behaviour is unchanged (a2 -> next section's break screen)", () => {
    const nav = resolveStatementNav(sections, "a2");
    expect(nav?.nextHref).toBe("/survey/section/2");
  });

  test("resolveSectionScreen: D's backHref lands on C's canonical (first) key, not its last; C's continueHref is its first key", () => {
    const dScreen = resolveSectionScreen(sections, 3);
    expect(dScreen?.backHref).toBe("/survey/c1");

    const cScreen = resolveSectionScreen(sections, 2);
    expect(cScreen?.continueHref).toBe("/survey/c1");
  });

  test("resolveSurveyScreen: resume lands on a grouped section's canonical key", () => {
    const screen1 = resolveSurveyScreen({
      openRound: { title: "Round" },
      orderedStatementKeys: fixture.map((f) => f.key),
      response: { submittedAt: null },
      answeredKeys: new Set(["a1", "a2", "c1"]),
      sections,
    });
    expect(screen1).toEqual({ kind: "resume", statementKey: "c1" });

    const screen2 = resolveSurveyScreen({
      openRound: { title: "Round" },
      orderedStatementKeys: fixture.map((f) => f.key),
      response: { submittedAt: null },
      answeredKeys: new Set(["a1", "a2", "c1", "c2", "c3"]),
      sections,
    });
    expect(screen2).toEqual({ kind: "resume", statementKey: "d1" });
  });

  test("resolveSurveyScreen: backwards-compatible without sections (resumes at the raw first-unanswered key)", () => {
    const screen = resolveSurveyScreen({
      openRound: { title: "Round" },
      orderedStatementKeys: fixture.map((f) => f.key),
      response: { submittedAt: null },
      answeredKeys: new Set(["a1", "a2", "c1"]),
    });
    expect(screen).toEqual({ kind: "resume", statementKey: "c2" });
  });

  test("resolveStatementNav: a grouped section that is last in the round points nextHref at review", () => {
    const lastFixture: SectionGroupableStatement[] = [
      { key: "x1", sectionId: "sX", sectionTitle: "X title", sectionPrompt: "X prompt", sectionLabel: "X" },
      { key: "y1", sectionId: "sY", sectionTitle: "Y title", sectionPrompt: "Y prompt", sectionLabel: "Y", sectionGrouped: true },
      { key: "y2", sectionId: "sY", sectionTitle: "Y title", sectionPrompt: "Y prompt", sectionLabel: "Y", sectionGrouped: true },
    ];
    const lastSections = buildSectionSummaries(lastFixture);
    for (const key of ["y1", "y2"]) {
      const nav = resolveStatementNav(lastSections, key);
      expect(nav?.nextHref).toBe("/survey/review");
    }
  });
});
