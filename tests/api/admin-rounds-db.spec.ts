import { test, expect } from "@playwright/test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";
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
  pastWindowFor,
  snapshotRound1,
  E2E_ROUND_NUMBER_MIN,
} from "../support/survey-fixtures";
import { formatAdminDateTime } from "../../src/lib/admin/datetime";
import { RoundStatusBadge } from "../../src/components/admin/round-status-badge";

/**
 * Proves RND-05's "at most one open round" invariant (exclusion
 * constraint + friendly trigger), round_status_at's pure status matrix,
 * admin_list_rounds, and pins the admin-only dashboard's pure TS helpers
 * — all against the live hosted project. Round 1 is read-only here;
 * every mutating fixture lives at round_number >= 900000 and is deleted
 * or restored by the end of the file.
 */

test.describe("admin rounds DB — @static (no DB)", () => {
  test("pastWindowFor derives a unique, always-2001, never-overlapping window from round_number", () => {
    const a = pastWindowFor(E2E_ROUND_NUMBER_MIN);
    expect(a.opensAt).toBe("2001-01-01T00:00:00.000000Z");
    expect(a.closesAt).toBe("2001-01-01T00:01:00.000000Z");

    const b = pastWindowFor(E2E_ROUND_NUMBER_MIN + 1);
    expect(b.opensAt).toBe("2001-01-01T00:02:00.000000Z");
    expect(b.closesAt).toBe("2001-01-01T00:03:00.000000Z");

    // a and b must never overlap or touch in a way that collides —
    // b.opensAt must be >= a.closesAt.
    expect(new Date(b.opensAt).getTime()).toBeGreaterThanOrEqual(
      new Date(a.closesAt).getTime()
    );

    expect(() => pastWindowFor(E2E_ROUND_NUMBER_MIN - 1)).toThrow();
  });

  test("formatAdminDateTime renders UK time and passes null through", () => {
    expect(formatAdminDateTime("2026-07-01T08:00:00Z")).toBe(
      "1 Jul 2026, 09:00"
    );
    expect(formatAdminDateTime("2026-11-01T09:00:00Z")).toBe(
      "1 Nov 2026, 09:00"
    );
    expect(formatAdminDateTime(null)).toBeNull();
  });

  test("RoundStatusBadge renders the label for every status", () => {
    for (const status of ["draft", "scheduled", "open", "closed"] as const) {
      const html = renderToStaticMarkup(
        React.createElement(RoundStatusBadge, { status })
      );
      const label = { draft: "Draft", scheduled: "Scheduled", open: "Open", closed: "Closed" }[
        status
      ];
      expect(html).toContain(label);
    }
  });
});

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** ISO string with 6 fractional digits (never a Date object). */
function iso6(date: Date): string {
  return date.toISOString().replace(/\.(\d{3})Z$/, (_m, ms) => `.${ms}000Z`);
}

test.describe.serial("admin rounds DB — @admin-rounds-db", () => {
  const adminEmail = testEmail("admin", "rdb");
  const participantEmail = testEmail("participant", "rdb");

  let round1Id: string;
  let round1Title: string;
  let round1SnapshotBefore: string;
  let adminTestClient: ReturnType<typeof adminClient>;
  let participantClient: ReturnType<typeof adminClient>;

  const trackedRoundIds: string[] = [];
  async function trackedCreate(
    input: Parameters<typeof createTestRound>[0]
  ) {
    const round = await createTestRound(input);
    trackedRoundIds.push(round.roundId);
    return round;
  }

  test.beforeAll(async () => {
    await sweepStaleTestData();
    round1SnapshotBefore = await snapshotRound1();

    const admin = adminClient();
    const { data: round1 } = await admin
      .from("rounds")
      .select("id, title")
      .eq("round_number", 1)
      .single();
    round1Id = round1!.id as string;
    round1Title = round1!.title as string;

    await grantTestAdmin(adminEmail);
    adminTestClient = await signInAsTestUser(adminEmail);
    participantClient = await signInAsTestUser(participantEmail);
  });

  test.afterAll(async () => {
    for (const roundId of [...trackedRoundIds]) {
      await deleteTestRound(roundId).catch(() => undefined);
    }
    await revokeTestAdmin(adminEmail).catch(() => undefined);
    await deleteAuthUserByEmail(adminEmail);
    await deleteAuthUserByEmail(participantEmail);
    expect(await countAuthUsersByEmail(adminEmail)).toBe(0);
    expect(await countAuthUsersByEmail(participantEmail)).toBe(0);

    const round1SnapshotAfter = await snapshotRound1();
    expect(round1SnapshotAfter).toBe(round1SnapshotBefore);
  });

  test("round_status_at: the pure 8-case matrix", async () => {
    const admin = adminClient();
    const T = "2030-01-01T00:00:00.000000Z";
    const TMinus1us = "2029-12-31T23:59:59.999999Z";
    const C = "2030-02-01T00:00:00.000000Z";
    const CMinus1us = "2030-01-31T23:59:59.999999Z";

    const cases: Array<{
      opensAt: string | null;
      closesAt: string | null;
      at: string | null;
      expected: string | null;
    }> = [
      { opensAt: null, closesAt: null, at: T, expected: "draft" },
      { opensAt: null, closesAt: C, at: T, expected: "draft" },
      { opensAt: T, closesAt: null, at: T, expected: "open" },
      { opensAt: T, closesAt: null, at: TMinus1us, expected: "scheduled" },
      { opensAt: T, closesAt: C, at: CMinus1us, expected: "open" },
      { opensAt: T, closesAt: C, at: C, expected: "closed" },
      {
        opensAt: T,
        closesAt: C,
        at: "2030-03-01T00:00:00Z",
        expected: "closed",
      },
      { opensAt: T, closesAt: null, at: null, expected: null },
    ];

    for (const c of cases) {
      const { data, error } = await admin.rpc("round_status_at", {
        p_opens_at: c.opensAt,
        p_closes_at: c.closesAt,
        p_at: c.at,
      });
      expect(error).toBeNull();
      expect(data).toBe(c.expected);
    }
  });

  test("admin_list_rounds: Round 1, a draft fixture, a closed fixture, p_round_id scoping, and ordering", async () => {
    const draftFixture = await trackedCreate({ window: "draft" });
    const closedFixture = await trackedCreate({ window: "closed" });

    const { data: rows, error } = await adminTestClient.rpc(
      "admin_list_rounds"
    );
    expect(error).toBeNull();
    const byId = new Map(
      (rows ?? []).map((r: { id: string }) => [r.id, r])
    );

    const admin = adminClient();
    const { data: countsRows } = await admin.rpc(
      "admin_round_response_counts"
    );
    const round1Counts = (countsRows ?? []).find(
      (r: { round_id: string }) => r.round_id === round1Id
    ) as { started_count: number; submitted_count: number } | undefined;

    const round1Row = byId.get(round1Id) as
      | {
          status: string;
          section_count: number;
          statement_count: number;
          started_count: number;
          submitted_count: number;
        }
      | undefined;
    expect(round1Row).toBeTruthy();
    expect(round1Row!.status).toBe("open");
    expect(Number(round1Row!.section_count)).toBe(7);
    expect(Number(round1Row!.statement_count)).toBe(85);
    expect(Number(round1Row!.started_count)).toBe(
      Number(round1Counts?.started_count ?? 0)
    );
    expect(Number(round1Row!.submitted_count)).toBe(
      Number(round1Counts?.submitted_count ?? 0)
    );

    const draftRow = byId.get(draftFixture.roundId) as
      | { status: string; started_count: number; submitted_count: number }
      | undefined;
    expect(draftRow).toBeTruthy();
    expect(draftRow!.status).toBe("draft");
    expect(Number(draftRow!.started_count)).toBe(0);
    expect(Number(draftRow!.submitted_count)).toBe(0);

    const closedRow = byId.get(closedFixture.roundId) as
      | { status: string }
      | undefined;
    expect(closedRow).toBeTruthy();
    expect(closedRow!.status).toBe("closed");

    const roundNumbers = (rows ?? []).map((r: { round_number: number }) =>
      Number(r.round_number)
    );
    for (let i = 1; i < roundNumbers.length; i += 1) {
      expect(roundNumbers[i]).toBeLessThan(roundNumbers[i - 1]);
    }

    const { data: scoped, error: scopedError } = await adminTestClient.rpc(
      "admin_list_rounds",
      { p_round_id: round1Id }
    );
    expect(scopedError).toBeNull();
    expect(scoped).toHaveLength(1);
    expect((scoped as { id: string }[])[0].id).toBe(round1Id);

    for (const client of [participantClient, anonClient()]) {
      const { error: deniedError } = await client.rpc("admin_list_rounds");
      expect(deniedError).toBeTruthy();
    }
  });

  test("overlap refusals leave the table unchanged; touching windows are allowed; drafts never collide", async () => {
    const admin = adminClient();
    const fixtureA = await trackedCreate({ window: "closed" });
    const windowA = fixtureA.pastWindow!;

    // 1. Opening after Round 1's open-ended window is refused outright.
    const r1 = E2E_ROUND_NUMBER_MIN + Math.floor(Math.random() * 10000);
    const { error: futureOverlapError } = await admin.from("rounds").insert({
      round_number: r1,
      title: `e2e-overlap-future-${r1}`,
      opens_at: "2099-01-01T00:00:00.000000Z",
      closes_at: null,
    });
    expect(futureOverlapError).toBeTruthy();
    expect((futureOverlapError as { code: string }).code).toBe("23P01");
    expect((futureOverlapError as { hint: string }).hint).toBe(
      "round_overlap"
    );
    const { data: noFutureRow } = await admin
      .from("rounds")
      .select("id")
      .eq("round_number", r1);
    expect(noFutureRow ?? []).toHaveLength(0);

    // 2. A window overlapping fixture A's by one second is refused.
    const r2 = E2E_ROUND_NUMBER_MIN + Math.floor(Math.random() * 10000) + 20000;
    const overlapOpens = iso6(
      new Date(new Date(windowA.opensAt).getTime() + 30_000)
    );
    const { error: oneSecondOverlapError } = await admin
      .from("rounds")
      .insert({
        round_number: r2,
        title: `e2e-overlap-a-${r2}`,
        opens_at: overlapOpens,
        closes_at: iso6(new Date(new Date(overlapOpens).getTime() + 60_000)),
      });
    expect(oneSecondOverlapError).toBeTruthy();
    expect((oneSecondOverlapError as { code: string }).code).toBe("23P01");
    const { data: noOverlapRow } = await admin
      .from("rounds")
      .select("id")
      .eq("round_number", r2);
    expect(noOverlapRow ?? []).toHaveLength(0);

    // 3. Updating fixture A's closes_at to null makes its window
    // open-ended, which now overlaps Round 1 — refused, and A's stored
    // dates are unchanged.
    const { error: reopenError } = await admin
      .from("rounds")
      .update({ closes_at: null })
      .eq("id", fixtureA.roundId);
    expect(reopenError).toBeTruthy();
    expect((reopenError as { code: string }).code).toBe("23P01");
    const { data: fixtureAAfter } = await admin
      .from("rounds")
      .select("opens_at, closes_at")
      .eq("id", fixtureA.roundId)
      .single();
    // PostgREST may re-serialize the timestamptz (e.g. "+00:00" instead of
    // "Z", seconds trimmed when the fraction is zero) — compare instants,
    // not exact strings.
    expect(new Date(fixtureAAfter!.opens_at as string).getTime()).toBe(
      new Date(windowA.opensAt).getTime()
    );
    expect(new Date(fixtureAAfter!.closes_at as string).getTime()).toBe(
      new Date(windowA.closesAt).getTime()
    );

    // 4. Touching windows are allowed: B opens exactly at A.closes_at; C
    // closes exactly at A.opens_at.
    const rB = E2E_ROUND_NUMBER_MIN + Math.floor(Math.random() * 10000) + 40000;
    const bCloses = iso6(
      new Date(new Date(windowA.closesAt).getTime() + 60_000)
    );
    const { data: roundB, error: bError } = await admin
      .from("rounds")
      .insert({
        round_number: rB,
        title: `e2e-touch-b-${rB}`,
        opens_at: windowA.closesAt,
        closes_at: bCloses,
      })
      .select("id")
      .single();
    expect(bError).toBeNull();
    trackedRoundIds.push(roundB!.id as string);

    const rC = E2E_ROUND_NUMBER_MIN + Math.floor(Math.random() * 10000) + 60000;
    const cOpens = iso6(
      new Date(new Date(windowA.opensAt).getTime() - 60_000)
    );
    const { data: roundC, error: cError } = await admin
      .from("rounds")
      .insert({
        round_number: rC,
        title: `e2e-touch-c-${rC}`,
        opens_at: cOpens,
        closes_at: windowA.opensAt,
      })
      .select("id")
      .single();
    expect(cError).toBeNull();
    trackedRoundIds.push(roundC!.id as string);

    // 5. opens_at = closes_at is refused by rounds_dates_ordered (23514),
    // never by a range-construction error.
    const rEq = E2E_ROUND_NUMBER_MIN + Math.floor(Math.random() * 10000) + 80000;
    const eqInstant = "2010-01-01T00:00:00.000000Z";
    const { error: equalDatesError } = await admin.from("rounds").insert({
      round_number: rEq,
      title: `e2e-equal-dates-${rEq}`,
      opens_at: eqInstant,
      closes_at: eqInstant,
    });
    expect(equalDatesError).toBeTruthy();
    expect((equalDatesError as { code: string }).code).toBe("23514");

    // 6. Draft rounds never participate in the overlap rule — any number
    // of drafts coexist.
    const draft1 = await trackedCreate({ window: "draft" });
    const draft2 = await trackedCreate({ window: "draft" });
    expect(draft1.roundId).not.toBe(draft2.roundId);
  });

  test("concurrent inserts of two overlapping windows: exactly one is stored", async () => {
    const admin = adminClient();
    const base = E2E_ROUND_NUMBER_MIN + Math.floor(Math.random() * 5000) + 100000;
    // A safely-past window (Round 1 opens 2026-10-15 with no close date,
    // so its window is unbounded-future — any future year would overlap
    // it; a window this far in the past can never overlap Round 1 or any
    // other fixture's 2001-based window).
    const opensAt = "1990-06-01T00:00:00.000000Z";
    const closesAt = "1990-06-01T00:01:00.000000Z";

    const insertOne = (offset: number) =>
      admin
        .from("rounds")
        .insert({
          round_number: base + offset,
          title: `e2e-concurrent-${base + offset}`,
          opens_at: opensAt,
          closes_at: closesAt,
        })
        .select("id");

    const [first, second] = await Promise.all([insertOne(0), insertOne(1)]);
    const succeeded = [first, second].filter((r) => !r.error);
    const failed = [first, second].filter((r) => r.error);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0].error as { code: string }).code).toBe("23P01");

    const survivorId = succeeded[0].data![0].id as string;
    trackedRoundIds.push(survivorId);

    const { data: stored } = await admin
      .from("rounds")
      .select("id")
      .in("round_number", [base, base + 1]);
    expect(stored).toHaveLength(1);
  });

  test("participant: cannot insert into rounds; a no-op update of Round 1 (same title) affects zero rows", async () => {
    const { error: insertError } = await participantClient
      .from("rounds")
      .insert({ round_number: E2E_ROUND_NUMBER_MIN + 1, title: "e2e-nope" });
    expect(insertError).toBeTruthy();

    const { data: updateRows, error: updateError } = await participantClient
      .from("rounds")
      .update({ title: round1Title })
      .eq("id", round1Id)
      .select();
    if (updateError) {
      expect(updateError).toBeTruthy();
    } else {
      expect(updateRows ?? []).toHaveLength(0);
    }
  });
});
