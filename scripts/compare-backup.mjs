#!/usr/bin/env node
// Read-only backup compare (quick task 261117-eak).
//
// Usage: node scripts/compare-backup.mjs <newDir> [baseDir]
//   baseDir defaults to backups/2026-11-17-supabase
//
// Diffs a newer database backup (a directory of <table>.json files written by
// backups/<date>-supabase/_backup.mjs) against the baseline BY ROW ID, to
// prove that applying the Session 2 migrations changed nothing it should not
// have. It only reads files: no network, no env loading, no Supabase client,
// and it never writes anything.
//
// Allowed (reported, not failing):
//   - Session 2's rounds row changing (title / intro)
//   - sections and statements whose round_id is the Session 2 round, old or new
//   - new scales / scale_options rows for importance_change
//   - new auth_users ids
//   - new responses / answers rows on the Session 2 round
//   - tables present only in the new backup (e.g. results_consent_rounds)
// Everything else fails: any removed or changed existing row, any new row in
// surveys, rounds, Session 1/3 sections or statements, Session 1/3 responses or
// answers, results_consent, allowed_domains or admin_emails, and any table
// missing from the new backup.
//
// auth_users rows are compared with last_sign_in_at, updated_at and every key
// ending in _sent_at removed at any depth (they change on every sign-in).
//
// Exit code: 0 = PASS, 1 = FAIL.

import fs from "node:fs";
import path from "node:path";

const SESSION_2_ROUND_ID = "dc9e20b9-ce48-4046-9100-b6b7c5dca6a0";
const NEW_SCALE_KEY = "importance_change";
const DEFAULT_BASE_DIR = "backups/2026-11-17-supabase";

const KEY_OF = {
  surveys: (r) => r.id,
  rounds: (r) => r.id,
  sections: (r) => r.id,
  statements: (r) => r.id,
  responses: (r) => r.id,
  answers: (r) => r.id,
  auth_users: (r) => r.id,
  results_consent: (r) => r.user_id,
  scales: (r) => r.key,
  scale_options: (r) => `${r.scale_key}#${r.value}`,
  allowed_domains: (r) => r.domain,
  admin_emails: (r) => r.email,
};

const IGNORED_AUTH_KEYS = (key) =>
  key === "last_sign_in_at" || key === "updated_at" || key.endsWith("_sent_at");

function stripAuthNoise(value) {
  if (Array.isArray(value)) return value.map(stripAuthNoise);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (!IGNORED_AUTH_KEYS(k)) out[k] = stripAuthNoise(v);
    }
    return out;
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function loadDir(dir) {
  const tables = new Map();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    if (Array.isArray(parsed)) tables.set(file.slice(0, -".json".length), parsed);
  }
  return tables;
}

function keyed(table, rows, problems) {
  const keyOf = KEY_OF[table] ?? ((r) => r.id);
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === undefined || key === null) {
      problems.push(`${table}: a row has no key`);
      continue;
    }
    if (map.has(key)) problems.push(`${table}: duplicate key ${key}`);
    map.set(key, row);
  }
  return map;
}

function fingerprintOf(table, row) {
  return canonical(table === "auth_users" ? stripAuthNoise(row) : row);
}

/** True when this table/row change is on the allow-list. */
function isAllowedAdd(table, row) {
  switch (table) {
    case "auth_users":
      return true;
    case "sections":
    case "statements":
    case "responses":
    case "answers":
      return row.round_id === SESSION_2_ROUND_ID;
    case "scales":
      return row.key === NEW_SCALE_KEY;
    case "scale_options":
      return row.scale_key === NEW_SCALE_KEY;
    default:
      return false;
  }
}

function isAllowedRemove(table, row) {
  return (
    (table === "sections" || table === "statements") &&
    row.round_id === SESSION_2_ROUND_ID
  );
}

function isAllowedChange(table, oldRow, newRow) {
  if (table === "rounds") return oldRow.id === SESSION_2_ROUND_ID;
  if (table === "sections" || table === "statements") {
    return (
      oldRow.round_id === SESSION_2_ROUND_ID ||
      newRow.round_id === SESSION_2_ROUND_ID
    );
  }
  return false;
}

function main() {
  const [newDir, baseDirArg] = process.argv.slice(2);
  if (!newDir) {
    console.error("usage: node scripts/compare-backup.mjs <newDir> [baseDir]");
    process.exit(2);
  }
  const baseDir = baseDirArg ?? DEFAULT_BASE_DIR;

  const base = loadDir(baseDir);
  const next = loadDir(newDir);

  const fail = [];
  const allowed = [];
  const newRows = [];
  const newTables = [];
  const problems = [];

  for (const table of base.keys()) {
    if (!next.has(table)) fail.push(`${table}: table missing from ${newDir}`);
  }
  for (const table of next.keys()) {
    if (!base.has(table)) newTables.push(`${table} (${next.get(table).length} rows)`);
  }

  for (const [table, baseRows] of base) {
    if (!next.has(table)) continue;
    const oldMap = keyed(table, baseRows, problems);
    const newMap = keyed(table, next.get(table), problems);

    for (const [key, oldRow] of oldMap) {
      const newRow = newMap.get(key);
      if (newRow === undefined) {
        (isAllowedRemove(table, oldRow) ? allowed : fail).push(
          `${table}: removed ${key}`
        );
        continue;
      }
      if (fingerprintOf(table, oldRow) !== fingerprintOf(table, newRow)) {
        (isAllowedChange(table, oldRow, newRow) ? allowed : fail).push(
          `${table}: changed ${key}`
        );
      }
    }

    for (const [key, newRow] of newMap) {
      if (oldMap.has(key)) continue;
      if (isAllowedAdd(table, newRow)) {
        // New sign-ups and new Session 2 rows are expected; list them apart.
        newRows.push(`${table}: ${key}`);
      } else {
        fail.push(`${table}: unexpected new row ${key}`);
      }
    }
  }

  for (const p of problems) fail.push(p);

  const section = (title, lines) => {
    console.log(`\n== ${title} (${lines.length}) ==`);
    for (const line of lines) console.log(`  ${line}`);
  };

  section("FAIL", fail);
  section("ALLOWED", allowed);
  section("NEW ROWS", newRows);
  section("NEW TABLES", newTables);

  if (fail.length > 0) {
    console.log("\nFAIL");
    process.exit(1);
  }
  console.log("\nPASS");
  process.exit(0);
}

main();
