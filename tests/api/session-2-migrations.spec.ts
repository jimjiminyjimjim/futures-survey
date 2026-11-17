import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Static lint of the two Session 2 migrations (quick task 261117-eak). They
 * are staged, not applied, so these specs read the SQL files only — no DB.
 */

const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");
const M1 = fs.readFileSync(
  path.join(MIGRATIONS, "20261117000100_ranking_kind_and_round_consent.sql"),
  "utf8"
);
const M2 = fs.readFileSync(
  path.join(
    MIGRATIONS,
    "20261117000200_session_2_holding_space_for_uncertainty.sql"
  ),
  "utf8"
);
const V3 = fs.readFileSync(
  path.join(MIGRATIONS, "20261018000100_session_1_content_v3.sql"),
  "utf8"
);

const SESSION_1_ROUND_ID = "6bf90e9e-c628-4592-8e39-cc9c16440ea3";
const SESSION_2_ROUND_ID = "dc9e20b9-ce48-4046-9100-b6b7c5dca6a0";

function stripCommentLines(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

/** The answers_before_write body: from its create line to the next "$$;". */
function answersBeforeWriteBody(sql: string): string[] {
  const start = sql.indexOf(
    "create or replace function public.answers_before_write()"
  );
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", start);
  expect(end).toBeGreaterThan(start);
  return sql
    .slice(start, end + 3)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end + 3);
}

function fingerprintRegions(sql: string): string[] {
  const regions: string[] = [];
  const re = /-- fingerprint:begin\n([\s\S]*?)-- fingerprint:end/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) regions.push(m[1]);
  return regions;
}

test.describe("session 2 migrations — @static (no DB)", () => {
  test("answers_before_write is the 20261018000100 body plus only lines carrying 'ranking'", () => {
    const oldBody = answersBeforeWriteBody(V3);
    const newBody = answersBeforeWriteBody(M1)
      .map((line) => line.replace(", 'ranking')", ")"))
      .filter((line) => !line.includes("ranking"));
    expect(newBody).toEqual(oldBody);
  });

  test("answers_before_write loads ranking options, never sorts a ranking, refuses a partial one", () => {
    const body = answersBeforeWriteBody(M1).join("\n");
    expect(body).toContain(
      "if v_kind in ('choice_one', 'choice_multi', 'choice_exact', 'choice_up_to', 'ranking') then"
    );
    expect(body).toContain("if v_kind <> 'ranking' then");
    expect(body).toContain("elsif v_kind = 'ranking' then");
    expect(body).toContain("Rank every option on this question");
  });

  test("kind and options constraints list 'ranking'; ranking forbids exclusive options", () => {
    const sql = stripCommentLines(M1);
    const kindConstraint = sql.match(
      /add constraint statements_kind_valid\s+check \(([\s\S]*?)\);/
    );
    expect(kindConstraint?.[1]).toContain("'ranking'");
    const optionsConstraint = sql.match(
      /add constraint statements_options_by_kind\s+check \(([\s\S]*?)\);/
    );
    expect(optionsConstraint?.[1]).toContain("'ranking'");
    expect(sql).toContain("statements_ranking_no_exclusive");
    expect(sql).toContain("options @> '[{\"exclusive\": true}]'::jsonb");
  });

  test("admin_statement_rank_stats is admin-only, submitted-only and identity-free", () => {
    const body = functionBody(M1, "admin_statement_rank_stats");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = ''");
    expect(body).toContain("is_admin()");
    expect(body).toContain("42501");
    expect(body).toContain("submitted_at is not null");
    expect(body).toContain("kind = 'ranking'");
    expect(body).not.toContain("auth.users");
    expect(body.toLowerCase()).not.toContain("email");
    expect(body).not.toContain("user_id");
    expect(M1).toContain(
      "revoke execute on function public.admin_statement_rank_stats(uuid) from public, anon;"
    );
    expect(M1).toContain(
      "grant execute on function public.admin_statement_rank_stats(uuid) to authenticated, service_role;"
    );
  });

  test("results_consent_rounds: RLS, select/insert/update policies, no delete policy, immutable keys", () => {
    const sql = stripCommentLines(M1);
    expect(sql).toContain("create table if not exists public.results_consent_rounds");
    expect(sql).toContain(
      "alter table public.results_consent_rounds enable row level security;"
    );
    expect(sql).toMatch(/create policy results_consent_rounds_select_own_or_admin[\s\S]*?for select/);
    expect(sql).toMatch(/create policy results_consent_rounds_insert_own[\s\S]*?for insert/);
    expect(sql).toMatch(/create policy results_consent_rounds_update_own[\s\S]*?for update/);
    expect(sql).not.toMatch(/on public\.results_consent_rounds\s+for delete/);
    expect(sql).not.toContain("for delete");
    expect(sql).toContain("round_id = (select public.current_open_round_id())");
    expect(sql).toContain("primary key (user_id, round_id)");
    const trigger = functionBody(M1, "results_consent_rounds_before_write");
    expect(trigger).toContain("security definer");
    expect(trigger).toContain("new.round_id <> old.round_id");
    expect(trigger).toContain("new.consented_at := now()");
  });

  test("admin_round_responses reads legacy consent for Session 1 only, per-round consent otherwise", () => {
    const body = functionBody(M1, "admin_round_responses");
    expect(body).toContain(SESSION_1_ROUND_ID);
    expect(body).toContain("rcr.round_id = responses.round_id");
    expect(body).toContain("left join public.results_consent rc on v_legacy");
    expect(body).toContain("is_admin()");
    expect(body).toContain("order by users.email, statements.key nulls first");
  });

  test("migration 1 is schema/functions only: no insert, delete or update of data", () => {
    const sql = stripCommentLines(M1).toLowerCase();
    expect(sql).not.toContain("insert into");
    expect(sql).not.toContain("delete from");
    expect(sql).not.toContain("update public.");
  });

  test("migration 2 is one DO block with nothing but comments outside it", () => {
    const sql = stripCommentLines(M2);
    expect(sql.match(/\bdo \$\$/g)?.length).toBe(1);
    const open = sql.indexOf("do $$");
    const close = sql.lastIndexOf("$$;");
    expect(open).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(open);
    expect(sql.slice(0, open).trim()).toBe("");
    expect(sql.slice(close + 3).trim()).toBe("");
  });

  test("migration 2 has exactly one id-scoped DELETE, the round/count guards and the sanity strings", () => {
    const sql = stripCommentLines(M2);
    expect(sql.match(/delete from/gi)?.length).toBe(1);
    expect(sql).toMatch(/delete from public\.sections\s+where round_id = v_round_id/);
    expect(sql).toContain(SESSION_2_ROUND_ID);
    expect(sql).toContain("1:6/32 2:9/38 3:5/61");
    expect(sql).toContain("session_2_content:");
  });

  test("migration 2 never disables triggers or touches Session 1/3, consent, dates or scale rows", () => {
    const sql = stripCommentLines(M2).toLowerCase();
    for (const forbidden of [
      "disable trigger",
      "update public.scale_options",
      "opens_at =",
      "closes_at =",
      "insert into public.results_consent",
      "update public.results_consent",
      "delete from public.answers",
      "delete from public.responses",
    ]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });

  test("migration 2's before and after fingerprint queries are textually identical", () => {
    const regions = fingerprintRegions(M2);
    expect(regions.length).toBe(2);
    expect(regions[0]).toBe(regions[1]);
    expect(regions[0]).toContain("row_to_json");
    for (const table of [
      "public.surveys",
      "public.rounds",
      "public.sections",
      "public.statements",
      "public.scales",
      "public.scale_options",
      "public.responses",
      "public.answers",
      "public.results_consent",
      "public.allowed_domains",
      "public.admin_emails",
    ]) {
      expect(regions[0], table).toContain(table);
    }
  });

  test("migration 2 gives B1 and B2 no parent_title (both read as 'B.' with no invented parent line)", () => {
    const sql = stripCommentLines(M2);
    expect(sql).toMatch(/\$t\$B1\$t\$, null,/);
    expect(sql).toMatch(/\$t\$B2\$t\$, null,/);
    expect(sql).not.toContain("$t$In a world of AI$t$,");
    expect(sql).toContain("parent_title is not null");
  });
});
