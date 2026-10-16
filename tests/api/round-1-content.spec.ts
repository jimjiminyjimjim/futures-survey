import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  adminClient,
  testEmail,
  grantTestAdmin,
  revokeTestAdmin,
  deleteAuthUserByEmail,
  sweepStaleTestData,
  signInAsTestUser,
} from "../support/supabase-admin";

/**
 * Verbatim-content + RLS checks for Round 1, seeded by
 * supabase/migrations/20261015000200_round_1_content.sql.
 *
 * @static tests parse .planning/SURVEY-CONTENT.md and the migration file
 * directly — no DB connection needed — and MUST pass before the migration
 * is ever pushed (plan 01-03 Task 2 step (d)).
 *
 * @db tests run against the hosted (dev == live) project and are read-only:
 * they never insert/update/delete rows in rounds/sections/statements/scales,
 * only in admin_emails (via grantTestAdmin/revokeTestAdmin) and auth.users
 * (via test identities), both cleaned up in afterAll.
 */

const SURVEY_PATH = path.resolve(
  process.cwd(),
  ".planning/SURVEY-CONTENT.md"
);
const MIGRATION_PATH = path.resolve(
  process.cwd(),
  "supabase/migrations/20261015000200_round_1_content.sql"
);

type ParsedSection = {
  sortOrder: number;
  title: string;
  prompt: string;
  scaleKey: string;
};

type ParsedStatement = {
  sectionSortOrder: number;
  stmtSortOrder: number;
  key: string;
  text: string;
};

type ParsedSurvey = {
  sections: ParsedSection[];
  statements: ParsedStatement[];
};

/**
 * Independent parser of SURVEY-CONTENT.md — written separately from the
 * (uncommitted, throwaway) generator script that produced the migration's
 * data lines, per plan 01-03 Task 2 step (c). Simple line regexes only.
 */
function parseSurveyContent(markdown: string): ParsedSurvey {
  const lines = markdown.split("\n");
  const sections: ParsedSection[] = [];
  const statements: ParsedStatement[] = [];
  let current: ParsedSection | null = null;
  let sawFirstHeading = false;
  let stmtCounter = 0;

  for (const line of lines) {
    const heading = line.match(/^## (\d+)\. (.+)$/);
    if (heading) {
      sawFirstHeading = true;
      current = {
        sortOrder: Number(heading[1]),
        title: heading[2].trim(),
        prompt: "",
        scaleKey: "",
      };
      sections.push(current);
      stmtCounter = 0;
      continue;
    }

    if (!sawFirstHeading) {
      continue;
    }

    const prompt = line.match(/^Prompt: (.+)$/);
    if (prompt && current) {
      current.prompt = prompt[1].trim();
      continue;
    }

    const scale = line.match(/^Scale: (.+)$/);
    if (scale && current) {
      current.scaleKey = scale[1].trim();
      continue;
    }

    const bullet = line.match(/^- (.+)$/);
    if (bullet && current) {
      stmtCounter += 1;
      const position = String(stmtCounter).padStart(2, "0");
      statements.push({
        sectionSortOrder: current.sortOrder,
        stmtSortOrder: stmtCounter,
        key: `s${current.sortOrder}_${position}`,
        text: bullet[1],
      });
    }
  }

  return { sections, statements };
}

type MigrationSectionRow = {
  sortOrder: number;
  title: string;
  prompt: string;
  scaleKey: string;
};

type MigrationStatementRow = {
  sectionSortOrder: number;
  stmtSortOrder: number;
  key: string;
  text: string;
};

/**
 * Extracts the two literal value-line shapes documented in plan 01-03 Task
 * 2 step (b):
 *   section:   (N, $t$TITLE$t$, $t$PROMPT$t$, 'SCALE_KEY'),
 *   statement: (N, M, 'KEY', $t$TEXT$t$),
 * The join-sentinel row (sort_order / section_sort_order 0) that closes
 * each VALUES list without a trailing comma on the last real row is
 * filtered out — it never represents real content.
 */
function parseMigrationRows(sql: string): {
  sections: MigrationSectionRow[];
  statements: MigrationStatementRow[];
} {
  const lines = sql.split("\n");
  const sectionRe =
    /^\s*\((\d+), \$t\$(.*?)\$t\$, \$t\$(.*?)\$t\$, '([a-z]+)'\),?$/;
  const statementRe =
    /^\s*\((\d+), (\d+), '([a-z0-9_]+)', \$t\$(.*?)\$t\$\),?$/;

  const sections: MigrationSectionRow[] = [];
  const statements: MigrationStatementRow[] = [];

  for (const line of lines) {
    const sectionMatch = line.match(sectionRe);
    if (sectionMatch) {
      const sortOrder = Number(sectionMatch[1]);
      if (sortOrder > 0) {
        sections.push({
          sortOrder,
          title: sectionMatch[2],
          prompt: sectionMatch[3],
          scaleKey: sectionMatch[4],
        });
      }
      continue;
    }

    const statementMatch = line.match(statementRe);
    if (statementMatch) {
      const sectionSortOrder = Number(statementMatch[1]);
      if (sectionSortOrder > 0) {
        statements.push({
          sectionSortOrder,
          stmtSortOrder: Number(statementMatch[2]),
          key: statementMatch[3],
          text: statementMatch[4],
        });
      }
    }
  }

  return { sections, statements };
}

function parseScaleDefinitions(
  markdown: string
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const lines = markdown.split("\n");
  for (const line of lines) {
    const match = line.match(/^- `([a-z]+)` \(\d+-point\): (.+)$/);
    if (match) {
      result[match[1]] = match[2].split(" → ").map((s) => s.trim());
    }
  }
  return result;
}

const survey = parseSurveyContent(fs.readFileSync(SURVEY_PATH, "utf8"));
const migration = parseMigrationRows(
  fs.readFileSync(MIGRATION_PATH, "utf8")
);
const scaleDefinitions = parseScaleDefinitions(
  fs.readFileSync(SURVEY_PATH, "utf8")
);

test.describe("Round 1 content — @static (no DB)", () => {
  test("parses 7 sections and 85 statements from SURVEY-CONTENT.md", () => {
    expect(survey.sections).toHaveLength(7);
    expect(survey.statements).toHaveLength(85);
  });

  test("per-section statement counts are 16, 8, 12, 10, 14, 13, 12", () => {
    const counts = survey.sections.map(
      (s) =>
        survey.statements.filter((st) => st.sectionSortOrder === s.sortOrder)
          .length
    );
    expect(counts).toEqual([16, 8, 12, 10, 14, 13, 12]);
  });

  test("migration contains exactly 7 section rows and 85 statement rows", () => {
    expect(migration.sections).toHaveLength(7);
    expect(migration.statements).toHaveLength(85);
  });

  test("migration section rows equal the parsed markdown exactly, in order", () => {
    expect(migration.sections).toEqual(survey.sections);
  });

  test("migration statement rows equal the parsed markdown exactly, in order", () => {
    expect(migration.statements).toEqual(survey.statements);
  });

  test("every statement key matches s{section}_{two-digit position} and is unique", () => {
    for (const st of migration.statements) {
      expect(st.key).toBe(
        `s${st.sectionSortOrder}_${String(st.stmtSortOrder).padStart(2, "0")}`
      );
    }
    const keys = migration.statements.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

test.describe("Round 1 content — @db (hosted project, read-only)", () => {
  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test("scales and scale_options match SURVEY-CONTENT.md", async () => {
    const admin = adminClient();

    const { data: scales, error: scalesError } = await admin
      .from("scales")
      .select("key, name")
      .order("key");
    expect(scalesError).toBeNull();
    expect(scales).toEqual([
      { key: "agreement", name: "Agreement" },
      { key: "familiarity", name: "Familiarity" },
    ]);

    for (const [scaleKey, labels] of Object.entries(scaleDefinitions)) {
      const { data: options, error: optionsError } = await admin
        .from("scale_options")
        .select("value, label")
        .eq("scale_key", scaleKey)
        .order("value");
      expect(optionsError).toBeNull();
      expect(options).toEqual(
        labels.map((label, i) => ({ value: i + 1, label }))
      );
    }
  });

  test("exactly one Round 1, open since 20261015000400, 7 sections, 85 statements matching the markdown", async () => {
    const admin = adminClient();

    const { data: rounds, error: roundsError } = await admin
      .from("rounds")
      .select("id, round_number, title, opens_at, closes_at")
      .eq("round_number", 1);
    expect(roundsError).toBeNull();
    expect(rounds).toHaveLength(1);
    const round = rounds![0];
    expect(round.title).toBe("Round 1");
    expect(round.opens_at).not.toBeNull();
    expect(new Date(round.opens_at as string).getTime()).toBeLessThanOrEqual(
      Date.now()
    );
    expect(round.closes_at).toBeNull();

    const { data: sections, error: sectionsError } = await admin
      .from("sections")
      .select("sort_order, title, prompt, scale_key")
      .eq("round_id", round.id)
      .order("sort_order");
    expect(sectionsError).toBeNull();
    expect(sections).toEqual(
      survey.sections.map((s) => ({
        sort_order: s.sortOrder,
        title: s.title,
        prompt: s.prompt,
        scale_key: s.scaleKey,
      }))
    );

    const { data: statements, error: statementsError } = await admin
      .from("statements")
      .select("section_id, sort_order, key, text, sections!inner(sort_order)")
      .eq("round_id", round.id)
      .order("key");
    expect(statementsError).toBeNull();
    expect(statements).toHaveLength(85);

    const bySortedKey = [...survey.statements].sort((a, b) =>
      a.key.localeCompare(b.key)
    );
    const actual = (statements ?? [])
      .map((st) => ({
        key: st.key as string,
        text: st.text as string,
        sort_order: st.sort_order as number,
        section_sort_order: (
          st.sections as unknown as { sort_order: number }
        ).sort_order,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));

    expect(actual).toEqual(
      bySortedKey.map((st) => ({
        key: st.key,
        text: st.text,
        sort_order: st.stmtSortOrder,
        section_sort_order: st.sectionSortOrder,
      }))
    );
  });

  test("literal spot checks", async () => {
    const admin = adminClient();
    const { data, error } = await admin
      .from("statements")
      .select("key, text")
      .in("key", ["s5_09", "s1_04", "s2_03", "s7_12"]);
    expect(error).toBeNull();

    const byKey = Object.fromEntries(
      (data ?? []).map((row) => [row.key, row.text])
    );
    expect(byKey["s5_09"]).toBe(
      "Sometimes I look for the “right” answer when I don't know what to do."
    );
    expect(byKey["s1_04"]).toBe("Life Cycle Assessment (LCA)");
    expect(byKey["s2_03"]).toBe(
      "I am sceptical when brands describe a product as sustainable."
    );
    expect(byKey["s7_12"]).toBe(
      "I am excited by the possibility that my understanding of design might be very different in three years' time."
    );
  });

  test.describe("RLS", () => {
    const participantEmail = testEmail("participant");
    const adminEmail = testEmail("admin");

    test.afterAll(async () => {
      await revokeTestAdmin(adminEmail);
      await deleteAuthUserByEmail(participantEmail);
      await deleteAuthUserByEmail(adminEmail);
    });

    test("anonymous callers read zero rows from rounds, sections and statements", async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const publishableKey =
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
      const anon = createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: rounds } = await anon.from("rounds").select("id");
      const { data: sections } = await anon.from("sections").select("id");
      const { data: statements } = await anon
        .from("statements")
        .select("id");

      expect(rounds ?? []).toHaveLength(0);
      expect(sections ?? []).toHaveLength(0);
      expect(statements ?? []).toHaveLength(0);
    });

    test("signed-in non-admin participant reads exactly the open round (Round 1: 1 round, 7 sections, 85 statements) plus 2 scales", async () => {
      const admin = adminClient();
      const { data: round1 } = await admin
        .from("rounds")
        .select("id")
        .eq("round_number", 1)
        .single();

      const participant = await signInAsTestUser(participantEmail);

      const { data: rounds, error: roundsError } = await participant
        .from("rounds")
        .select("id");
      const { data: sections, error: sectionsError } = await participant
        .from("sections")
        .select("id, round_id");
      const { data: statements, error: statementsError } = await participant
        .from("statements")
        .select("id, round_id");
      const { data: scales, error: scalesError } = await participant
        .from("scales")
        .select("key");

      expect(roundsError).toBeNull();
      expect(rounds).toHaveLength(1);
      expect(rounds![0].id).toBe(round1!.id);

      expect(sectionsError).toBeNull();
      expect(sections).toHaveLength(7);
      expect((sections ?? []).every((s) => s.round_id === round1!.id)).toBe(
        true
      );

      expect(statementsError).toBeNull();
      expect(statements).toHaveLength(85);
      expect(
        (statements ?? []).every((s) => s.round_id === round1!.id)
      ).toBe(true);

      expect(scalesError).toBeNull();
      expect(scales).toHaveLength(2);
    });

    test("a test admin reads all 85 Round 1 statements", async () => {
      await grantTestAdmin(adminEmail);
      const admin = await signInAsTestUser(adminEmail);

      const adminService = adminClient();
      const { data: round1 } = await adminService
        .from("rounds")
        .select("id")
        .eq("round_number", 1)
        .single();

      const { data: statements, error } = await admin
        .from("statements")
        .select("id")
        .eq("round_id", round1!.id);

      expect(error).toBeNull();
      expect(statements).toHaveLength(85);
    });
  });
});
