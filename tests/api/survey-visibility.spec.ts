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
  RUN_ID,
} from "../support/supabase-admin";
import {
  createTestRound,
  deleteTestRound,
} from "../support/survey-fixtures";

/**
 * Pins the single open-window rule (is_round_open_at / open_round_id_at /
 * current_open_round_id — supabase/migrations/20261015000300) at its
 * boundary edges, its deterministic current-round ordering, and
 * participant/admin/anon visibility of draft/scheduled/closed e2e rounds
 * next to the real, now-open Round 1. Every e2e round created here is
 * either a draft, scheduled in the future, or already closed — never open
 * at the current time (PRIV-01 prohibition) — and is deleted by the end
 * of its own test, with afterAll as a best-effort safety net.
 */

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** ISO string with 6 fractional digits (never a Date object) — the format
 * is_round_open_at is designed for (microsecond-precision timestamptz
 * boundaries), even though JS Date itself only carries millisecond
 * precision. */
function iso6(date: Date): string {
  return date.toISOString().replace(/\.(\d{3})Z$/, (_m, ms) => `.${ms}000Z`);
}

test.describe.serial("survey visibility @survey-visibility", () => {
  const createdRoundIds: string[] = [];

  async function createTrackedRound(
    input: Parameters<typeof createTestRound>[0]
  ) {
    const round = await createTestRound(input);
    createdRoundIds.push(round.roundId);
    return round;
  }

  async function deleteTrackedRound(roundId: string) {
    await deleteTestRound(roundId);
    const idx = createdRoundIds.indexOf(roundId);
    if (idx !== -1) {
      createdRoundIds.splice(idx, 1);
    }
  }

  test.beforeAll(async () => {
    await sweepStaleTestData();
  });

  test.afterAll(async () => {
    for (const roundId of [...createdRoundIds]) {
      await deleteTestRound(roundId).catch(() => undefined);
    }
    createdRoundIds.length = 0;
  });

  test("is_round_open_at: inclusive open, exclusive close, every edge case", async () => {
    const admin = adminClient();

    const T = "2030-01-01T00:00:00.000000Z";
    const TMinus1us = "2029-12-31T23:59:59.999999Z";
    const C = "2030-02-01T00:00:00.000000Z";
    const CMinus1us = "2030-01-31T23:59:59.999999Z";

    const cases: Array<{
      opensAt: string | null;
      closesAt: string | null;
      at: string;
      expected: boolean;
    }> = [
      { opensAt: T, closesAt: null, at: T, expected: true },
      { opensAt: T, closesAt: null, at: TMinus1us, expected: false },
      { opensAt: T, closesAt: C, at: C, expected: false },
      { opensAt: T, closesAt: C, at: CMinus1us, expected: true },
      { opensAt: null, closesAt: null, at: T, expected: false },
      { opensAt: null, closesAt: C, at: T, expected: false },
      { opensAt: T, closesAt: null, at: null as unknown as string, expected: false },
      { opensAt: T, closesAt: null, at: "2999-01-01T00:00:00Z", expected: true },
    ];

    for (const c of cases) {
      const { data, error } = await admin.rpc("is_round_open_at", {
        p_opens_at: c.opensAt,
        p_closes_at: c.closesAt,
        p_at: c.at,
      });
      expect(error).toBeNull();
      expect(data).toBe(c.expected);
    }
  });

  test("open_round_id_at: null for an empty instant; 'now' matches current_open_round_id (Round 1)", async () => {
    const admin = adminClient();

    const { data: nullResult, error: nullError } = await admin.rpc(
      "open_round_id_at",
      { p_at: "2000-01-01T00:00:00.000000Z" }
    );
    expect(nullError).toBeNull();
    expect(nullResult).toBeNull();

    const { data: byInstant, error: byInstantError } = await admin.rpc(
      "open_round_id_at",
      { p_at: iso6(new Date()) }
    );
    expect(byInstantError).toBeNull();

    const participantEmail = testEmail("participant");
    const participant = await signInAsTestUser(participantEmail);
    const { data: byRpc, error: byRpcError } = await participant.rpc(
      "current_open_round_id"
    );
    expect(byRpcError).toBeNull();

    const { data: round1 } = await admin
      .from("rounds")
      .select("id")
      .eq("round_number", 1)
      .single();

    expect(byInstant).toBe(round1!.id);
    expect(byRpc).toBe(round1!.id);

    await deleteAuthUserByEmail(participantEmail);
  });

  test("current-round selection is total with non-overlapping windows; an overlapping third window is refused", async () => {
    const admin = adminClient();

    // Two closed e2e fixtures, each in their own unique 2001 window
    // (pastWindowFor) — windows can never overlap Round 1 or each other,
    // which is the only way two "real" open rounds could ever coexist
    // now that RND-05's exclusion constraint is live (a 2099-style
    // "scheduled" fixture is no longer constructible while Round 1 is
    // open-ended).
    const roundA = await createTrackedRound({ window: "closed" });
    const roundB = await createTrackedRound({ window: "closed" });
    const windowA = roundA.pastWindow!;
    const windowB = roundB.pastWindow!;

    const { data: winnerA, error: winnerAError } = await admin.rpc(
      "open_round_id_at",
      { p_at: iso6(new Date(new Date(windowA.opensAt).getTime() + 30_000)) }
    );
    expect(winnerAError).toBeNull();
    expect(winnerA).toBe(roundA.roundId);

    const { data: winnerB, error: winnerBError } = await admin.rpc(
      "open_round_id_at",
      { p_at: iso6(new Date(new Date(windowB.opensAt).getTime() + 30_000)) }
    );
    expect(winnerBError).toBeNull();
    expect(winnerB).toBe(roundB.roundId);

    // At A's close instant (exclusive-close), A is no longer open there —
    // the result is null unless B happens to start exactly at that
    // instant (inclusive-open), in which case B wins.
    const { data: atAClose, error: atACloseError } = await admin.rpc(
      "open_round_id_at",
      { p_at: windowA.closesAt }
    );
    expect(atACloseError).toBeNull();
    if (windowB.opensAt === windowA.closesAt) {
      expect(atAClose).toBe(roundB.roundId);
    } else {
      expect(atAClose).toBeNull();
    }

    // A third window overlapping A's is refused outright — so two open
    // rounds (and any tie-break between them) can no longer exist.
    const overlapRoundNumber = roundA.roundNumber + 500000;
    const { error: overlapError } = await admin.from("rounds").insert({
      round_number: overlapRoundNumber,
      title: `e2e-${RUN_ID}-overlap-${overlapRoundNumber}`,
      opens_at: windowA.opensAt,
      closes_at: windowA.closesAt,
    });
    expect(overlapError).toBeTruthy();
    expect(overlapError!.code).toBe("23P01");
    expect(overlapError!.hint).toBe("round_overlap");

    await deleteTrackedRound(roundA.roundId);
    await deleteTrackedRound(roundB.roundId);
  });

  test("participant reads exactly the open round (Round 1); draft/closed e2e rounds are invisible to them; a test admin reads the e2e rounds; anon and participant RPC calls error as designed", async () => {
    const admin = adminClient();
    const { data: round1 } = await admin
      .from("rounds")
      .select("id")
      .eq("round_number", 1)
      .single();

    const draftRound = await createTrackedRound({ window: "draft" });
    const closedRound = await createTrackedRound({ window: "closed" });

    const participantEmail = testEmail("participant");
    const adminEmail = testEmail("admin");

    try {
      const participant = await signInAsTestUser(participantEmail);

      const { data: rounds, error: roundsError } = await participant
        .from("rounds")
        .select("id");
      expect(roundsError).toBeNull();
      expect(rounds).toHaveLength(1);
      expect(rounds![0].id).toBe(round1!.id);

      const { data: sections, error: sectionsError } = await participant
        .from("sections")
        .select("id, round_id");
      expect(sectionsError).toBeNull();
      expect(sections).toHaveLength(7);
      expect((sections ?? []).every((s) => s.round_id === round1!.id)).toBe(
        true
      );

      const { data: statements, error: statementsError } = await participant
        .from("statements")
        .select("id, round_id");
      expect(statementsError).toBeNull();
      expect(statements).toHaveLength(85);
      expect(
        (statements ?? []).every((s) => s.round_id === round1!.id)
      ).toBe(true);

      // A participant cannot probe arbitrary instants.
      const { error: openRoundIdAtError } = await participant.rpc(
        "open_round_id_at",
        { p_at: iso6(new Date()) }
      );
      expect(openRoundIdAtError).not.toBeNull();

      // Anon reads zero rows and cannot call current_open_round_id.
      const anon = anonClient();
      const { data: anonRounds } = await anon.from("rounds").select("id");
      expect(anonRounds ?? []).toHaveLength(0);
      const { error: anonRpcError } = await anon.rpc(
        "current_open_round_id"
      );
      expect(anonRpcError).not.toBeNull();

      // A test admin reads every e2e round and its statements.
      await grantTestAdmin(adminEmail);
      const testAdmin = await signInAsTestUser(adminEmail);

      const { data: adminRounds, error: adminRoundsError } = await testAdmin
        .from("rounds")
        .select("id")
        .in("id", [draftRound.roundId, closedRound.roundId]);
      expect(adminRoundsError).toBeNull();
      expect(adminRounds).toHaveLength(2);

      for (const round of [draftRound, closedRound]) {
        const { data: roundStatements, error: roundStatementsError } =
          await testAdmin
            .from("statements")
            .select("id")
            .eq("round_id", round.roundId);
        expect(roundStatementsError).toBeNull();
        expect(roundStatements).toHaveLength(2);
      }
    } finally {
      await revokeTestAdmin(adminEmail).catch(() => undefined);
      await deleteAuthUserByEmail(participantEmail);
      await deleteAuthUserByEmail(adminEmail);
    }

    await deleteTrackedRound(draftRound.roundId);
    await deleteTrackedRound(closedRound.roundId);
  });
});
