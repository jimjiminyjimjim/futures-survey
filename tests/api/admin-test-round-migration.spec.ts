import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Static lint of the admin test-mode migration (quick task 261117-it4). It
 * is written, not applied, so these specs read the SQL files only — no DB.
 */

const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");
const M = fs.readFileSync(
  path.join(MIGRATIONS, "20261117000300_admin_test_unopened_round.sql"),
  "utf8"
);
const V2 = fs.readFileSync(
  path.join(MIGRATIONS, "20261017000100_surveys_rounds_v2.sql"),
  "utf8"
);

function stripCommentLines(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const SQL = stripCommentLines(M);

/** A function body: from its create line to the next "$$;". */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `function ${name} not found`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + 3);
}

function bodyLines(sql: string, name: string): string[] {
  return functionBody(sql, name)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** A policy statement: from "create policy NAME" to its terminating ";". */
function policyStatement(sql: string, name: string): string {
  const start = sql.indexOf(`create policy ${name}\n`);
  expect(start, `policy ${name} not found`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(";", start);
  return sql.slice(start, end + 1);
}

/** Every "delete from public.responses ..." statement up to its ";". */
function responseDeletes(sql: string): string[] {
  const out: string[] = [];
  const re = /delete from public\.responses[\s\S]*?;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) out.push(m[0]);
  return out;
}

const ADMIN_RPCS = [
  "admin_test_add_samples",
  "admin_test_clear",
  "admin_test_reset",
] as const;

const RPC_SIGNATURES: Record<(typeof ADMIN_RPCS)[number], string> = {
  admin_test_add_samples: "admin_test_add_samples(uuid, integer)",
  admin_test_clear: "admin_test_clear(uuid)",
  admin_test_reset: "admin_test_reset(uuid)",
};

test.describe("admin test round migration — @static (no DB)", () => {
  test("user_id becomes nullable; no flag column; the uniqueness constraint is not touched", () => {
    expect(SQL).toContain(
      "alter table public.responses alter column user_id drop not null;"
    );
    expect(SQL).not.toContain("responses_round_user_unique");
    expect(SQL.toLowerCase()).not.toContain("add column");
  });

  test("responses_before_write is the 20261017000100 body plus only lines carrying 'draft'", () => {
    const oldBody = bodyLines(V2, "responses_before_write");
    const newBodyLines = bodyLines(M, "responses_before_write");
    expect(oldBody.some((line) => line.includes("draft"))).toBe(false);
    expect(newBodyLines.filter((line) => !line.includes("draft"))).toEqual(
      oldBody
    );
    const added = newBodyLines.filter((line) => line.includes("draft"));
    expect(added).toHaveLength(3);
    for (const line of added) expect(line.endsWith("-- draft")).toBe(true);
    const newBody = newBodyLines.join("\n");
    expect(newBody).toContain(
      "if new.user_id is null and not public.round_is_draft(new.round_id) then -- draft"
    );
    expect(added.join("\n")).toContain("23514");
    // The guard sits in the INSERT branch, after the already-submitted check.
    const insertBranch = newBody.slice(
      newBody.indexOf("if tg_op = 'INSERT' then"),
      newBody.indexOf("-- tg_op = 'UPDATE'")
    );
    expect(insertBranch.indexOf("A response cannot be created already submitted")).toBeLessThan(
      insertBranch.indexOf("round_is_draft(new.round_id)")
    );
    expect(insertBranch.indexOf("round_is_draft(new.round_id)")).toBeLessThan(
      insertBranch.indexOf("return new;")
    );
  });

  test("no results function, dashboard function or lifecycle function is redefined", () => {
    for (const name of [
      "admin_statement_answer_counts",
      "admin_statement_choice_counts",
      "admin_prediction_stats",
      "admin_statement_rank_stats",
      "admin_round_responses",
      "admin_round_response_counts",
      "admin_list_rounds",
      "admin_open_round",
      "admin_update_round",
      "update_round_at",
      "open_round_at",
      "close_round_at",
      "answers_before_write",
      "round_status_at",
    ]) {
      expect(SQL, name).not.toContain(`function public.${name}(`);
    }
  });

  test("round_is_draft is security definer, checks both dates, and is not executable by users", () => {
    const body = functionBody(M, "round_is_draft");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = ''");
    expect(body).toContain("opens_at is null");
    expect(body).toContain("closes_at is null");
    expect(body).toContain("coalesce(");
    expect(SQL).toContain(
      "revoke execute on function public.round_is_draft(uuid) from public, anon, authenticated;"
    );
    expect(SQL).not.toMatch(/grant execute on function public\.round_is_draft/);
  });

  test("the four admin-only draft policies; participant policies are untouched", () => {
    for (const name of [
      "responses_insert_admin_draft",
      "responses_update_admin_draft",
      "answers_insert_admin_draft",
      "answers_update_admin_draft",
    ]) {
      const stmt = policyStatement(SQL, name);
      expect(stmt, name).toContain("to authenticated");
      expect(stmt, name).toContain("(select public.is_admin())");
      expect(stmt, name).toContain("user_id = (select auth.uid())");
      expect(stmt, name).toContain("opens_at is null");
      expect(stmt, name).toContain("closes_at is null");
      expect(SQL, name).toContain(`drop policy if exists ${name} on public.`);
    }
    expect(policyStatement(SQL, "responses_insert_admin_draft")).toContain(
      "for insert"
    );
    expect(policyStatement(SQL, "responses_update_admin_draft")).toContain(
      "for update"
    );
    expect(policyStatement(SQL, "answers_insert_admin_draft")).toContain(
      "for insert"
    );
    expect(policyStatement(SQL, "answers_update_admin_draft")).toContain(
      "for update"
    );
    for (const name of [
      "responses_select_own",
      "responses_insert_own_open_round",
      "responses_update_own_open_round",
      "answers_select_own",
      "answers_insert_own_open_unsubmitted",
      "answers_update_own_open_unsubmitted",
    ]) {
      expect(SQL, name).not.toMatch(new RegExp(`${name}\\s+on`));
      expect(SQL, name).not.toMatch(new RegExp(`create policy ${name}\\b`));
    }
    expect(SQL).not.toMatch(/for delete/);
  });

  test("rounds triggers clear test answers on leaving draft and keep responses out of draft; statements trigger", () => {
    expect(SQL).toContain(
      "after update of opens_at, closes_at on public.rounds"
    );
    expect(SQL).toContain(
      "when (old.opens_at is null and old.closes_at is null and (new.opens_at is not null or new.closes_at is not null))"
    );
    const clear = functionBody(M, "rounds_clear_test_answers");
    expect(clear).toContain("security definer");
    expect(clear).toContain("set search_path = ''");
    expect(clear).toMatch(
      /delete from public\.results_consent_rounds where round_id = new\.id;/
    );
    expect(clear).toMatch(/delete from public\.responses where round_id = new\.id;/);

    expect(SQL).toContain(
      "before update of opens_at, closes_at on public.rounds"
    );
    expect(SQL).toContain(
      "when (new.opens_at is null and new.closes_at is null and (old.opens_at is not null or old.closes_at is not null))"
    );
    const keep = functionBody(M, "rounds_keep_responses_out_of_draft");
    expect(keep).toContain("security definer");
    expect(keep).toContain("23514");
    expect(keep).toContain("hint = 'round_has_responses'");

    expect(SQL).toContain("before delete on public.statements");
    const stmts = functionBody(M, "statements_before_delete_clear_test_answers");
    expect(stmts).toContain("security definer");
    const check = stmts.indexOf("public.round_is_draft(old.round_id)");
    expect(check).toBeGreaterThanOrEqual(0);
    expect(stmts.indexOf("delete from public.answers")).toBeGreaterThan(check);
    expect(stmts).toContain("return old;");

    expect((SQL.match(/create trigger /g) ?? []).length).toBe(3);
  });

  test("admin test RPCs: admin-only, share lock, draft-only, scoped deletes, grants", () => {
    for (const name of ADMIN_RPCS) {
      const body = functionBody(M, name);
      expect(body, name).toContain("security definer");
      expect(body, name).toContain("set search_path = ''");
      const admin = body.indexOf("if not public.is_admin() then");
      expect(admin, name).toBeGreaterThanOrEqual(0);
      expect(body.indexOf("42501"), name).toBeGreaterThan(admin);
      const lock = body.indexOf("for share");
      expect(lock, name).toBeGreaterThan(admin);
      const draft = body.indexOf("public.round_is_draft(p_round_id)");
      expect(draft, name).toBeGreaterThan(lock);
      expect(body, name).toContain("'round_not_draft'");
      expect(body.indexOf("delete from"), name).toBeGreaterThan(draft);
      const sig = RPC_SIGNATURES[name];
      expect(SQL, name).toContain(
        `revoke execute on function public.${sig} from public, anon;`
      );
      expect(SQL, name).toContain(
        `grant execute on function public.${sig} to authenticated, service_role;`
      );
    }

    const deletes = responseDeletes(SQL);
    expect(deletes.length).toBeGreaterThanOrEqual(4);
    for (const del of deletes) expect(del).toContain("round_id =");

    expect(functionBody(M, "admin_test_reset")).toMatch(
      /delete from public\.responses\s+where round_id = p_round_id and user_id = \(select auth\.uid\(\)\);/
    );
    expect(functionBody(M, "admin_test_clear")).toMatch(
      /delete from public\.responses where round_id = p_round_id;/
    );

    const add = functionBody(M, "admin_test_add_samples");
    expect(add).toMatch(
      /delete from public\.responses where round_id = p_round_id and user_id is null;/
    );
    expect(add).toContain(
      "insert into public.responses (round_id, user_id) values (p_round_id, null)"
    );
    expect(add).toContain("p_count < 1 or p_count > 50");
    for (const kind of [
      "scale",
      "choice_one",
      "choice_multi",
      "choice_exact",
      "choice_up_to",
      "prediction",
      "rating",
      "two_ended",
      "ranking",
    ]) {
      expect(add, kind).toContain(`'${kind}'`);
    }
    expect(add).toContain("Sample answers do not support this question kind");
    expect(add).toContain(
      "update public.responses set submitted_at = now() where id = v_response_id;"
    );
    expect(add).toContain("scale_options");
    expect(add).toContain("test_sample_pick");

    const pick = functionBody(M, "test_sample_pick");
    expect(pick).toContain("immutable");
    expect(pick).toContain("& 2147483647");
    expect(pick).not.toContain("abs(");
    expect(SQL).toContain(
      "revoke execute on function public.test_sample_pick(text, integer) from public, anon, authenticated;"
    );
  });

  test("no transaction control, no rounds update, no date writes, no auth inserts, no disabled triggers", () => {
    const lower = SQL.toLowerCase();
    expect(lower).not.toMatch(/^\s*(begin|commit|rollback)\s*;/m);
    expect(lower).not.toMatch(/start transaction/);
    expect(lower).not.toContain("update public.rounds");
    expect(lower).not.toContain("set opens_at");
    expect(lower).not.toContain("set closes_at");
    expect(lower).not.toContain("insert into auth");
    expect(lower).not.toContain("disable trigger");
  });
});
