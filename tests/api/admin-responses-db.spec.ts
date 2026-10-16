import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import {
  adminClient,
  testEmail,
  grantTestAdmin,
  revokeTestAdmin,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
  signInAsTestUser,
} from "../support/supabase-admin";
import {
  createTestRound,
  deleteTestRound,
  seedRoundResponses,
} from "../support/survey-fixtures";
import { escapeCsvCell, toRoundCsv } from "../../src/lib/admin/csv";
import { pivotResponses, type AdminResponseRow } from "../../src/lib/admin/responses";

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe("admin responses — @static (no DB)", () => {
  test("escapeCsvCell: plain values pass through unchanged", () => {
    expect(escapeCsvCell("a")).toBe("a");
  });

  test("escapeCsvCell: RFC 4180 quoting for comma/quote/newline", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
    expect(escapeCsvCell("a\nb")).toBe('"a\nb"');
  });

  test("escapeCsvCell: OWASP formula-injection guard on the leading character", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("+x")).toBe("'+x");
    expect(escapeCsvCell("-x")).toBe("'-x");
    expect(escapeCsvCell("@x")).toBe("'@x");
    expect(escapeCsvCell("\tx")).toBe("'\tx");
    // A leading CR triggers the apostrophe guard AND RFC 4180 quoting
    // (the cell contains CR).
    expect(escapeCsvCell("\rx")).toBe('"\'\rx"');
  });

  test("escapeCsvCell: formula guard then quoting when the cell also has a comma", () => {
    expect(escapeCsvCell("=a,b")).toBe('"\'=a,b"');
  });

  test("toRoundCsv: zero participants produces only the header row", () => {
    expect(toRoundCsv([], ["e2e_01", "e2e_02"])).toBe(
      "email,started_at,submitted_at,e2e_01,e2e_02\r\n"
    );
  });

  test("toRoundCsv: rows sorted by email, blanks for unanswered, integers, CRLF", () => {
    const started = "2026-01-01T00:00:00.000Z";
    const submitted = "2026-01-01T00:10:00.000Z";
    const csv = toRoundCsv(
      [
        {
          responseId: "r2",
          email: "zed@example.com",
          startedAt: started,
          submittedAt: null,
          answers: { e2e_01: 3 },
          answeredCount: 1,
        },
        {
          responseId: "r1",
          email: "alice@example.com",
          startedAt: started,
          submittedAt: submitted,
          answers: { e2e_01: 1, e2e_02: 2 },
          answeredCount: 2,
        },
      ],
      ["e2e_01", "e2e_02"]
    );

    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("email,started_at,submitted_at,e2e_01,e2e_02");
    expect(lines[1]).toBe(
      `alice@example.com,${new Date(started).toISOString()},${new Date(submitted).toISOString()},1,2`
    );
    expect(lines[2]).toBe(
      `zed@example.com,${new Date(started).toISOString()},,3,`
    );
    expect(lines[3]).toBe("");
    expect(csv.endsWith("\r\n")).toBe(true);
    // Every line break is CRLF, never a bare LF not preceded by CR.
    expect(/(?<!\r)\n/.test(csv)).toBe(false);
  });

  test("pivotResponses: groups long rows (incl. a null-keyed zero-answer response) into participants, sorted by email", () => {
    const rows: AdminResponseRow[] = [
      {
        response_id: "r-b",
        user_email: "b@example.com",
        started_at: "2026-01-01T00:00:00.000Z",
        submitted_at: "2026-01-01T00:05:00.000Z",
        statement_key: "e2e_01",
        value: 2,
      },
      {
        response_id: "r-a",
        user_email: "a@example.com",
        started_at: "2026-01-01T00:00:00.000Z",
        submitted_at: null,
        statement_key: null,
        value: null,
      },
      {
        response_id: "r-c",
        user_email: "c@example.com",
        started_at: "2026-01-01T00:00:00.000Z",
        submitted_at: "2026-01-01T00:05:00.000Z",
        statement_key: "e2e_01",
        value: 1,
      },
    ];

    const participants = pivotResponses(rows);
    expect(participants.map((p) => p.email)).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
    expect(participants[0].answers).toEqual({});
    expect(participants[0].answeredCount).toBe(0);
    expect(participants[1].answers).toEqual({ e2e_01: 2 });
    expect(participants[1].answeredCount).toBe(1);
  });

  test("grep: admin_round_responses is only referenced by responses-queries.ts and the export route", () => {
    const srcDir = path.join(__dirname, "..", "..", "src");
    const matches: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const contents = fs.readFileSync(full, "utf8");
          if (contents.includes("admin_round_responses")) {
            matches.push(path.relative(srcDir, full));
          }
        }
      }
    }
    walk(srcDir);

    expect(matches.sort()).toEqual(
      [
        path.join("lib", "admin", "responses-queries.ts"),
        path.join("app", "admin", "rounds", "[roundId]", "export", "route.ts"),
      ].sort()
    );
  });
});

test.describe.serial("admin responses DB — @admin-responses-db", () => {
  const adminEmail = testEmail("admin", "rdbp");
  const participantEmail = testEmail("participant", "rdbp");

  let roundId: string;
  let emptyRoundId: string;

  test.beforeAll(async () => {
    await sweepStaleTestData();
    await grantTestAdmin(adminEmail);

    const round = await createTestRound({ window: "closed", statementCount: 2 });
    roundId = round.roundId;
    await seedRoundResponses(roundId, [
      {
        email: testEmail("participant", "rdbpa"),
        answers: { e2e_01: 1, e2e_02: 2 },
        submit: true,
      },
      {
        email: testEmail("participant", "rdbpb"),
        answers: { e2e_01: 3 },
        submit: false,
      },
      { email: testEmail("participant", "rdbpc"), answers: {}, submit: false },
    ]);

    const empty = await createTestRound({ window: "closed", statementCount: 2 });
    emptyRoundId = empty.roundId;
  });

  test.afterAll(async () => {
    await deleteTestRound(roundId).catch(() => undefined);
    await deleteTestRound(emptyRoundId).catch(() => undefined);
    await revokeTestAdmin(adminEmail);
    await deleteAuthUserByEmail(adminEmail);
    await deleteAuthUserByEmail(participantEmail);
    await deleteAuthUserByEmail(testEmail("participant", "rdbpa"));
    await deleteAuthUserByEmail(testEmail("participant", "rdbpb"));
    await deleteAuthUserByEmail(testEmail("participant", "rdbpc"));
    expect(await countAuthUsersByEmail(adminEmail)).toBe(0);
  });

  test("admin_round_responses: admin sees exact columns and per-participant rows scoped to the round", async () => {
    const admin = await signInAsTestUser(adminEmail);
    const { data, error } = await admin.rpc("admin_round_responses", {
      p_round_id: roundId,
    });
    expect(error).toBeNull();
    expect(data).not.toBeNull();

    const rows = (data ?? []) as Record<string, unknown>[];
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ["response_id", "started_at", "statement_key", "submitted_at", "user_email", "value"].sort()
      );
    }

    const paRows = rows.filter(
      (r) => r.user_email === testEmail("participant", "rdbpa")
    );
    expect(paRows.length).toBe(2);
    expect(paRows.some((r) => r.statement_key === "e2e_01" && r.value === 1)).toBe(
      true
    );
    expect(paRows.some((r) => r.statement_key === "e2e_02" && r.value === 2)).toBe(
      true
    );
    expect(paRows.every((r) => r.submitted_at !== null)).toBe(true);

    const pbRows = rows.filter(
      (r) => r.user_email === testEmail("participant", "rdbpb")
    );
    expect(pbRows.length).toBe(1);
    expect(pbRows[0].statement_key).toBe("e2e_01");
    expect(pbRows[0].value).toBe(3);
    expect(pbRows[0].submitted_at).toBeNull();

    const pcRows = rows.filter(
      (r) => r.user_email === testEmail("participant", "rdbpc")
    );
    expect(pcRows.length).toBe(1);
    expect(pcRows[0].statement_key).toBeNull();
    expect(pcRows[0].value).toBeNull();

    // Every row belongs to this round (service-role check).
    const service = adminClient();
    for (const row of rows) {
      const { data: response } = await service
        .from("responses")
        .select("round_id")
        .eq("id", row.response_id as string)
        .single();
      expect(response?.round_id).toBe(roundId);
    }
  });

  test("admin_round_responses: non-admin participant and anon are refused", async () => {
    const participant = await signInAsTestUser(
      testEmail("participant", "rdbpa")
    );
    const { error: participantError } = await participant.rpc(
      "admin_round_responses",
      { p_round_id: roundId }
    );
    expect(participantError).not.toBeNull();
    expect(participantError?.code).toBe("42501");

    const anon = anonClient();
    const { error: anonError } = await anon.rpc("admin_round_responses", {
      p_round_id: roundId,
    });
    expect(anonError).not.toBeNull();
  });

  test("the empty round returns zero rows", async () => {
    const admin = await signInAsTestUser(adminEmail);
    const { data, error } = await admin.rpc("admin_round_responses", {
      p_round_id: emptyRoundId,
    });
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
