import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { isUnopenedDraft } from "@/lib/unopened-draft";
import {
  LIVE_SURVEY_PATHS,
  testSurveyPaths,
  statementHref,
  sectionHref,
  reviewHref,
} from "@/lib/survey/paths";
import {
  buildSectionSummaries,
  resolveStatementNav,
  resolveSectionScreen,
  type SectionGroupableStatement,
} from "@/lib/survey/state";

/**
 * Admin test mode (quick task 261117-it4): pure helpers and source lints.
 * No DB, no server.
 */

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

/** Matches a quoted string literal that starts with "/survey". */
const LIVE_SURVEY_LITERAL = /["'`]\/survey/;

const R = "11111111-2222-4333-8444-555555555555";

// A (ungrouped, a1/a2), C (grouped, c1/c2), D (ungrouped, d1, last).
const FIXTURE: SectionGroupableStatement[] = [
  { key: "a1", sectionId: "sA", sectionTitle: "A", sectionPrompt: "A p", sectionLabel: "A" },
  { key: "a2", sectionId: "sA", sectionTitle: "A", sectionPrompt: "A p", sectionLabel: "A" },
  { key: "c1", sectionId: "sC", sectionTitle: "C", sectionPrompt: "C p", sectionLabel: "C", sectionGrouped: true },
  { key: "c2", sectionId: "sC", sectionTitle: "C", sectionPrompt: "C p", sectionLabel: "C", sectionGrouped: true },
  { key: "d1", sectionId: "sD", sectionTitle: "D", sectionPrompt: "D p", sectionLabel: "D" },
];

test.describe("admin test round app — @static (no DB)", () => {
  test("isUnopenedDraft: only both dates null", () => {
    expect(isUnopenedDraft(null, null)).toBe(true);
    expect(isUnopenedDraft("2026-11-17T10:00:00Z", null)).toBe(false);
    expect(isUnopenedDraft(null, "2099-01-01T00:00:00Z")).toBe(false);
    expect(isUnopenedDraft("2026-11-17T10:00:00Z", "2099-01-01T00:00:00Z")).toBe(false);
  });

  test("LIVE_SURVEY_PATHS gives today's literals", () => {
    expect(LIVE_SURVEY_PATHS).toEqual({ home: "/", base: "/survey" });
    expect(statementHref(LIVE_SURVEY_PATHS, "k")).toBe("/survey/k");
    expect(sectionHref(LIVE_SURVEY_PATHS, 2)).toBe("/survey/section/2");
    expect(reviewHref(LIVE_SURVEY_PATHS)).toBe("/survey/review");
  });

  test("testSurveyPaths puts every screen under /admin/rounds/<id>/test", () => {
    const paths = testSurveyPaths("R");
    expect(paths.home).toBe("/admin/rounds/R/test");
    expect(paths.base).toBe("/admin/rounds/R/test/survey");
    expect(statementHref(paths, "k")).toBe("/admin/rounds/R/test/survey/k");
    expect(sectionHref(paths, 2)).toBe("/admin/rounds/R/test/survey/section/2");
    expect(reviewHref(paths)).toBe("/admin/rounds/R/test/survey/review");
  });

  test("resolveStatementNav / resolveSectionScreen with no paths argument are unchanged", () => {
    const sections = buildSectionSummaries(FIXTURE);
    expect(resolveStatementNav(sections, "a1")?.prevHref).toBe("/survey/section/1");
    expect(resolveStatementNav(sections, "a1")?.nextHref).toBe("/survey/a2");
    expect(resolveStatementNav(sections, "a2")?.nextHref).toBe("/survey/section/2");
    expect(resolveStatementNav(sections, "c2")?.prevHref).toBe("/survey/section/2");
    expect(resolveStatementNav(sections, "d1")?.nextHref).toBe("/survey/review");
    expect(resolveSectionScreen(sections, 1)?.backHref).toBe("/");
    expect(resolveSectionScreen(sections, 1)?.continueHref).toBe("/survey/a1");
    expect(resolveSectionScreen(sections, 3)?.backHref).toBe("/survey/c1");
    // Passing LIVE_SURVEY_PATHS explicitly is identical.
    expect(resolveStatementNav(sections, "a2", LIVE_SURVEY_PATHS)).toEqual(
      resolveStatementNav(sections, "a2")
    );
    expect(resolveSectionScreen(sections, 3, LIVE_SURVEY_PATHS)).toEqual(
      resolveSectionScreen(sections, 3)
    );
  });

  test("with testSurveyPaths every nav href stays in the test route", () => {
    const sections = buildSectionSummaries(FIXTURE);
    const paths = testSurveyPaths(R);
    const base = `/admin/rounds/${R}/test`;
    const a1 = resolveStatementNav(sections, "a1", paths);
    expect(a1?.prevHref).toBe(`${base}/survey/section/1`);
    expect(a1?.nextHref).toBe(`${base}/survey/a2`);
    expect(resolveStatementNav(sections, "a2", paths)?.nextHref).toBe(
      `${base}/survey/section/2`
    );
    const c2 = resolveStatementNav(sections, "c2", paths);
    expect(c2?.prevHref).toBe(`${base}/survey/section/2`);
    expect(c2?.nextHref).toBe(`${base}/survey/section/3`);
    expect(resolveStatementNav(sections, "d1", paths)?.nextHref).toBe(
      `${base}/survey/review`
    );
    expect(resolveSectionScreen(sections, 1, paths)?.backHref).toBe(base);
    expect(resolveSectionScreen(sections, 1, paths)?.continueHref).toBe(
      `${base}/survey/a1`
    );
    expect(resolveSectionScreen(sections, 3, paths)?.backHref).toBe(
      `${base}/survey/c1`
    );
  });

  test("source lints: no hardcoded /survey literals in state.ts or the shared screens", () => {
    for (const rel of [
      "src/lib/survey/state.ts",
      "src/app/survey/[statementKey]/statement-screen.tsx",
      "src/app/survey/section/[sectionNumber]/section-screen.tsx",
      "src/app/survey/review/review-screen.tsx",
    ]) {
      const lines = read(rel)
        .split("\n")
        .filter((line) => LIVE_SURVEY_LITERAL.test(line));
      expect(lines, rel).toEqual([]);
    }
  });

  test("source lints: live snapshot keeps current_open_round_id; test branch requires both dates null", () => {
    const queries = read("src/lib/survey/queries.ts");
    expect(queries).toContain('"current_open_round_id"');
    expect(queries).toContain('.is("opens_at", null)');
    expect(queries).toContain('.is("closes_at", null)');
  });

  test("source lints: one shared ensure-response upsert; test mode re-checks admin and draft", () => {
    const actions = read("src/lib/survey/actions.ts");
    expect(actions.split('onConflict: "round_id,user_id"').length - 1).toBe(1);
    expect(actions).toContain('"current_open_round_id"');
    expect(actions).toContain('rpc("is_admin")');
    expect(actions).toContain('.is("opens_at", null)');
    expect(actions).toContain('.is("closes_at", null)');
    expect(actions.startsWith('"use server";')).toBe(true);
  });

  test("source lints: the client forms use the survey-mode context, never a hardcoded home", () => {
    for (const rel of [
      "src/app/survey/[statementKey]/question-controls.tsx",
      "src/app/survey/[statementKey]/grouped-rating-form.tsx",
      "src/app/survey/review/submit-form.tsx",
    ]) {
      const src = read(rel);
      expect(src, rel).toContain("useSurveyMode()");
      expect(src, rel).toContain("router.replace(homeHref)");
      expect(src, rel).not.toContain('router.replace("/")');
    }
  });

  test("the test routes exist and the test page offers no consent question", () => {
    const base = "src/app/admin/rounds/[roundId]/test";
    for (const rel of [
      "layout.tsx",
      "page.tsx",
      "survey/[statementKey]/page.tsx",
      "survey/section/[sectionNumber]/page.tsx",
      "survey/review/page.tsx",
    ]) {
      expect(fs.existsSync(path.join(process.cwd(), base, rel)), rel).toBe(true);
    }
    const review = read(`${base}/survey/review/page.tsx`);
    expect(review).toContain("consent={null}");
    expect(review).not.toContain("getResultsConsent");
  });

  test("deck loader: every aggregate RPC keeps exactly { p_round_id: roundId }", () => {
    const src = read("src/lib/presentation/get-presentation-data.ts");
    for (const rpc of [
      "admin_statement_answer_counts",
      "admin_statement_choice_counts",
      "admin_prediction_stats",
    ]) {
      expect(src, rpc).toContain(
        `supabase.rpc("${rpc}", { p_round_id: roundId })`
      );
    }
    expect(src).toMatch(
      /supabase\.rpc\("admin_statement_rank_stats", \{\s*p_round_id: roundId,?\s*\}\)/
    );
    expect(src).toContain('supabase.rpc("admin_list_rounds", { p_round_id: roundId })');
    expect(src).toContain('from "@/lib/unopened-draft"');
    expect(src).not.toMatch(/from "@\/lib\/admin\//);
    expect(src).toContain("isUnopenedDraft(roundRow.opens_at, roundRow.closes_at)");
  });

  test("present page passes the test-answers notice only for an unopened draft", () => {
    const src = read("src/app/admin/rounds/[roundId]/present/page.tsx");
    expect(src).toMatch(
      /notice=\{\s*result\.isUnopenedDraft \? PRESENTATION_MESSAGES\.testAnswersLabel : null\s*\}/
    );
    const deck = read("src/components/presentation/presentation-deck.tsx");
    expect(deck).toContain('data-slot="deck-notice"');
    expect(deck).toContain("notice = null");
  });

  test("Open now on a draft with test answers confirms with the count", () => {
    const src = read("src/components/admin/round-lifecycle-actions.tsx");
    const dialog = src.slice(
      src.indexOf('if (status === "draft" && testAnswerCount > 0)'),
      src.indexOf('if (status === "draft" || status === "scheduled")')
    );
    expect(dialog).toContain("<ConfirmDialog");
    expect(dialog).toContain(
      "ADMIN_MESSAGES.openNowClearsTestAnswers(testAnswerCount)"
    );
    expect(dialog).toContain("ADMIN_MESSAGES.openNowTestConfirm");
    expect(dialog).toContain("openRoundNow({ roundId })");
    const page = read("src/app/admin/rounds/[roundId]/page.tsx");
    expect(page).toContain(
      "testAnswerCount={testMode ? round.startedCount : 0}"
    );
  });

  test("canPresent is unchanged: open or closed only", () => {
    const src = read("src/lib/presentation/chart-math.ts");
    const start = src.indexOf("export function canPresent(");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = src.slice(start, src.indexOf("\n}\n", start) + 3);
    expect(body).toContain('"open"');
    expect(body).toContain('"closed"');
    expect(body).not.toContain('"draft"');
  });
});
