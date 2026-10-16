import { test, expect } from "@playwright/test";
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
  assertTestRound,
} from "../support/survey-fixtures";
import { adminErrorMessage, ADMIN_MESSAGES } from "../../src/lib/admin/messages";

/**
 * RND-02/RND-05/RND-06's lifecycle half: every transition and refusal in
 * update_round_at/open_round_at/close_round_at, proven at past instants on
 * e2e-only fixture rounds whose reserved 2001 windows never touch Round 1
 * or each other; the live admin_* wrappers at real now(); and non-admin
 * refusals. Round 1 is read-only here — snapshotted before/after.
 */

/** ISO string with 6 fractional digits (never a Date object). */
function iso6(date: Date): string {
  return date.toISOString().replace(/\.(\d{3})Z$/, (_m, ms) => `.${ms}000Z`);
}

/** Adds a whole number of milliseconds to an iso6 instant. */
function plusMs(iso: string, ms: number): string {
  return iso6(new Date(new Date(iso).getTime() + ms));
}

/**
 * Adds a small number of microseconds (no carry past one second) to an
 * iso6 instant — the one place sub-millisecond precision is needed, since
 * JS Date itself cannot represent it.
 */
function plusMicros(iso: string, micros: number): string {
  const match = /^(.+T\d{2}:\d{2}:\d{2})\.(\d{6})Z$/.exec(iso);
  if (!match) {
    throw new Error(`plusMicros: unexpected format ${iso}`);
  }
  const [, prefix, fracStr] = match;
  const newFracNum = Number(fracStr) + micros;
  if (newFracNum < 0 || newFracNum > 999999) {
    throw new Error("plusMicros: carry beyond one second not supported");
  }
  return `${prefix}.${String(newFracNum).padStart(6, "0")}Z`;
}

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe("admin lifecycle — @static (no DB)", () => {
  test("adminErrorMessage maps every lifecycle hint to its exact copy", () => {
    expect(adminErrorMessage({ hint: "another_round_open" })).toBe(
      ADMIN_MESSAGES.anotherRoundOpen
    );
    expect(adminErrorMessage({ hint: "round_not_open" })).toBe(
      ADMIN_MESSAGES.roundNotOpen
    );
    expect(adminErrorMessage({ hint: "round_overlap" })).toBe(
      ADMIN_MESSAGES.scheduleOverlap
    );
    expect(adminErrorMessage({ hint: "round_already_open" })).toBe(
      ADMIN_MESSAGES.roundAlreadyOpen
    );
    expect(adminErrorMessage({ hint: "close_date_passed" })).toBe(
      ADMIN_MESSAGES.closeDatePassed
    );
    expect(adminErrorMessage({ hint: "empty_window" })).toBe(
      ADMIN_MESSAGES.saveFailed
    );
  });
});

test.describe.serial("admin lifecycle DB — @admin-lifecycle-db", () => {
  const adminEmail = testEmail("admin", "ldb");
  const participantEmail = testEmail("participant", "ldb");

  let round1SnapshotBefore: string;
  let adminTestClient: ReturnType<typeof adminClient>;
  let participantClient: ReturnType<typeof adminClient>;

  const trackedRoundIds: string[] = [];
  async function trackedCreate(
    input: Parameters<typeof createTestRound>[0] = {}
  ) {
    const round = await createTestRound(input);
    trackedRoundIds.push(round.roundId);
    return round;
  }

  /** A fresh draft (opens/closes both null) plus its own reserved 2001 window. */
  async function freshDraft() {
    const round = await trackedCreate({ window: "draft" });
    const window = pastWindowFor(round.roundNumber);
    return { roundId: round.roundId, roundNumber: round.roundNumber, window };
  }

  /** A fresh draft with closes_at preset (service-role, direct) to its own window's close. */
  async function freshDraftWithClosesPreset() {
    const draft = await freshDraft();
    const admin = adminClient();
    const { error } = await admin
      .from("rounds")
      .update({ closes_at: draft.window.closesAt })
      .eq("id", draft.roundId);
    if (error) {
      throw error;
    }
    return draft;
  }

  async function readDates(roundId: string) {
    const admin = adminClient();
    const { data, error } = await admin
      .from("rounds")
      .select("opens_at, closes_at")
      .eq("id", roundId)
      .single();
    if (error || !data) {
      throw error ?? new Error("round not found");
    }
    return {
      opensAt: data.opens_at as string | null,
      closesAt: data.closes_at as string | null,
    };
  }

  test.beforeAll(async () => {
    await sweepStaleTestData();
    round1SnapshotBefore = await snapshotRound1();
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

  test("update_round_at: draft D — scheduled, opens-locked edit, close-date edit trimmed, then closed", async () => {
    const admin = adminClient();
    const D = await freshDraft();
    await assertTestRound(D.roundId);

    const atMinus1h = plusMs(D.window.opensAt, -60 * 60 * 1000);
    const { error: scheduleError } = await admin.rpc("update_round_at", {
      p_round_id: D.roundId,
      p_title: `e2e-${D.roundNumber}-D`,
      p_opens_at: D.window.opensAt,
      p_closes_at: D.window.closesAt,
      p_at: atMinus1h,
    });
    expect(scheduleError).toBeNull();
    {
      const { data: status } = await admin.rpc("round_status_at", {
        p_opens_at: D.window.opensAt,
        p_closes_at: D.window.closesAt,
        p_at: atMinus1h,
      });
      expect(status).toBe("scheduled");
    }

    const atPlus20s = plusMs(D.window.opensAt, 20_000);
    const atPlus40s = plusMs(D.window.opensAt, 40_000);

    const { error: lockedError } = await admin.rpc("update_round_at", {
      p_round_id: D.roundId,
      p_title: `e2e-${D.roundNumber}-D`,
      p_opens_at: plusMs(D.window.opensAt, 1000),
      p_closes_at: D.window.closesAt,
      p_at: atPlus20s,
    });
    expect(lockedError).toBeTruthy();
    expect((lockedError as { hint: string }).hint).toBe("opens_locked");
    {
      const after = await readDates(D.roundId);
      expect(new Date(after.opensAt!).getTime()).toBe(
        new Date(D.window.opensAt).getTime()
      );
    }

    const { error: editError } = await admin.rpc("update_round_at", {
      p_round_id: D.roundId,
      p_title: `  e2e-${D.roundNumber}-D-t  `,
      p_opens_at: D.window.opensAt,
      p_closes_at: atPlus40s,
      p_at: atPlus20s,
    });
    expect(editError).toBeNull();
    {
      const { data: row } = await admin
        .from("rounds")
        .select("title, closes_at")
        .eq("id", D.roundId)
        .single();
      expect(row!.title).toBe(`e2e-${D.roundNumber}-D-t`);
      expect(new Date(row!.closes_at as string).getTime()).toBe(
        new Date(atPlus40s).getTime()
      );
    }

    const atClosesPlus1s = plusMs(D.window.closesAt, 1000);
    const { error: closedError } = await admin.rpc("update_round_at", {
      p_round_id: D.roundId,
      p_title: `e2e-${D.roundNumber}-D-t`,
      p_opens_at: D.window.opensAt,
      p_closes_at: atPlus40s,
      p_at: atClosesPlus1s,
    });
    expect(closedError).toBeTruthy();
    expect((closedError as { hint: string }).hint).toBe("round_closed");
  });

  test("update_round_at: fresh-draft edges — opens/closes in past, dates order, ordering priority, blank title, clear-opens, not-found", async () => {
    const admin = adminClient();

    // opens = P (boundary: equal to the instant) → opens_in_past.
    {
      const fresh = await freshDraft();
      const P = fresh.window.opensAt;
      const { error } = await admin.rpc("update_round_at", {
        p_round_id: fresh.roundId,
        p_title: `e2e-${fresh.roundNumber}`,
        p_opens_at: P,
        p_closes_at: null,
        p_at: P,
      });
      expect(error).toBeTruthy();
      expect((error as { hint: string }).hint).toBe("opens_in_past");
      const after = await readDates(fresh.roundId);
      expect(after.opensAt).toBeNull();
    }

    // (opens P+1µs, closes window close) → stored.
    {
      const fresh = await freshDraft();
      const P = fresh.window.opensAt;
      const { error } = await admin.rpc("update_round_at", {
        p_round_id: fresh.roundId,
        p_title: `e2e-${fresh.roundNumber}`,
        p_opens_at: plusMicros(P, 1),
        p_closes_at: fresh.window.closesAt,
        p_at: P,
      });
      expect(error).toBeNull();
      const after = await readDates(fresh.roundId);
      expect(new Date(after.opensAt!).getTime()).toBe(new Date(P).getTime());
    }

    // closes = P with opens null → closes_in_past.
    {
      const fresh = await freshDraft();
      const P = fresh.window.opensAt;
      const { error } = await admin.rpc("update_round_at", {
        p_round_id: fresh.roundId,
        p_title: `e2e-${fresh.roundNumber}`,
        p_opens_at: null,
        p_closes_at: P,
        p_at: P,
      });
      expect(error).toBeTruthy();
      expect((error as { hint: string }).hint).toBe("closes_in_past");
      const after = await readDates(fresh.roundId);
      expect(after.closesAt).toBeNull();
    }

    // closes = opens (same future instant, same call) → dates_order.
    {
      const fresh = await freshDraft();
      const P = fresh.window.opensAt;
      const sameInstant = plusMs(P, 10_000);
      const { error } = await admin.rpc("update_round_at", {
        p_round_id: fresh.roundId,
        p_title: `e2e-${fresh.roundNumber}`,
        p_opens_at: sameInstant,
        p_closes_at: sameInstant,
        p_at: P,
      });
      expect(error).toBeTruthy();
      expect((error as { hint: string }).hint).toBe("dates_order");
      const after = await readDates(fresh.roundId);
      expect(after.opensAt).toBeNull();
    }

    // (opens P+10s, closes P+10s+1µs) → stored.
    {
      const fresh = await freshDraft();
      const P = fresh.window.opensAt;
      const opens = plusMs(P, 10_000);
      const closes = plusMicros(opens, 1);
      const { error } = await admin.rpc("update_round_at", {
        p_round_id: fresh.roundId,
        p_title: `e2e-${fresh.roundNumber}`,
        p_opens_at: opens,
        p_closes_at: closes,
        p_at: P,
      });
      expect(error).toBeNull();
      const after = await readDates(fresh.roundId);
      expect(new Date(after.opensAt!).getTime()).toBe(new Date(opens).getTime());
    }

    // Opens in the past AND closes before opens: opens_in_past wins — the
    // fixed validation order reports the first problem.
    {
      const fresh = await freshDraft();
      const P = fresh.window.opensAt;
      const { error } = await admin.rpc("update_round_at", {
        p_round_id: fresh.roundId,
        p_title: `e2e-${fresh.roundNumber}`,
        p_opens_at: P,
        p_closes_at: plusMs(P, -10_000),
        p_at: P,
      });
      expect(error).toBeTruthy();
      expect((error as { hint: string }).hint).toBe("opens_in_past");
    }

    // Blank title (after trim) → round_title_blank, short-circuiting before
    // any date is ever evaluated.
    {
      const fresh = await freshDraft();
      const { error } = await admin.rpc("update_round_at", {
        p_round_id: fresh.roundId,
        p_title: "   ",
        p_opens_at: null,
        p_closes_at: null,
        p_at: fresh.window.opensAt,
      });
      expect(error).toBeTruthy();
      expect((error as { hint: string }).hint).toBe("round_title_blank");
    }

    // Clearing opens on a scheduled (not open) round returns it to draft.
    {
      const fresh = await freshDraft();
      const atMinus1h = plusMs(fresh.window.opensAt, -60 * 60 * 1000);
      const { error: scheduleError } = await admin.rpc("update_round_at", {
        p_round_id: fresh.roundId,
        p_title: `e2e-${fresh.roundNumber}`,
        p_opens_at: fresh.window.opensAt,
        p_closes_at: fresh.window.closesAt,
        p_at: atMinus1h,
      });
      expect(scheduleError).toBeNull();

      const { error: clearError } = await admin.rpc("update_round_at", {
        p_round_id: fresh.roundId,
        p_title: `e2e-${fresh.roundNumber}`,
        p_opens_at: null,
        p_closes_at: null,
        p_at: atMinus1h,
      });
      expect(clearError).toBeNull();
      const after = await readDates(fresh.roundId);
      expect(after.opensAt).toBeNull();
      const { data: status } = await admin.rpc("round_status_at", {
        p_opens_at: after.opensAt,
        p_closes_at: after.closesAt,
        p_at: atMinus1h,
      });
      expect(status).toBe("draft");
    }

    // A random, non-existent round id → round_not_found.
    {
      const { error } = await admin.rpc("update_round_at", {
        p_round_id: "00000000-0000-0000-0000-000000000000",
        p_title: "e2e-nope",
        p_opens_at: null,
        p_closes_at: null,
        p_at: new Date().toISOString(),
      });
      expect(error).toBeTruthy();
      expect((error as { hint: string }).hint).toBe("round_not_found");
    }
  });

  test("open_round_at/close_round_at: open → already-open → close exactly → not-open → closed", async () => {
    const admin = adminClient();
    const E = await freshDraftWithClosesPreset();

    const { error: openError } = await admin.rpc("open_round_at", {
      p_round_id: E.roundId,
      p_at: E.window.opensAt,
    });
    expect(openError).toBeNull();
    {
      const after = await readDates(E.roundId);
      expect(new Date(after.opensAt!).getTime()).toBe(
        new Date(E.window.opensAt).getTime()
      );
    }

    const { error: againError } = await admin.rpc("open_round_at", {
      p_round_id: E.roundId,
      p_at: plusMs(E.window.opensAt, 10_000),
    });
    expect(againError).toBeTruthy();
    expect((againError as { hint: string }).hint).toBe("round_already_open");

    const closeAt = plusMs(E.window.opensAt, 30_000);
    const { error: closeError } = await admin.rpc("close_round_at", {
      p_round_id: E.roundId,
      p_at: closeAt,
    });
    expect(closeError).toBeNull();
    {
      const after = await readDates(E.roundId);
      expect(new Date(after.closesAt!).getTime()).toBe(new Date(closeAt).getTime());
    }

    const { error: closeAgainError } = await admin.rpc("close_round_at", {
      p_round_id: E.roundId,
      p_at: plusMs(E.window.opensAt, 40_000),
    });
    expect(closeAgainError).toBeTruthy();
    expect((closeAgainError as { hint: string }).hint).toBe("round_not_open");

    const { error: openClosedError } = await admin.rpc("open_round_at", {
      p_round_id: E.roundId,
      p_at: plusMs(E.window.opensAt, 50_000),
    });
    expect(openClosedError).toBeTruthy();
    expect((openClosedError as { hint: string }).hint).toBe("round_closed");
  });

  test("open_round_at: another_round_open when a different round is open at that instant", async () => {
    const admin = adminClient();
    const A = await trackedCreate({ window: "closed" });
    const F = await freshDraftWithClosesPreset();

    const instant = plusMs(A.pastWindow!.opensAt, 30_000);
    const { error } = await admin.rpc("open_round_at", {
      p_round_id: F.roundId,
      p_at: instant,
    });
    expect(error).toBeTruthy();
    expect((error as { hint: string }).hint).toBe("another_round_open");

    const after = await readDates(F.roundId);
    expect(after.opensAt).toBeNull();
  });

  test("open_round_at: close_date_passed when the preset close is at or before the instant (boundary: exactly at closes)", async () => {
    const admin = adminClient();
    const G = await freshDraftWithClosesPreset();

    const { error } = await admin.rpc("open_round_at", {
      p_round_id: G.roundId,
      p_at: G.window.closesAt,
    });
    expect(error).toBeTruthy();
    expect((error as { hint: string }).hint).toBe("close_date_passed");

    const after = await readDates(G.roundId);
    expect(after.opensAt).toBeNull();
  });

  test("close_round_at: empty_window when closing at the exact instant it opened", async () => {
    const admin = adminClient();
    const H = await freshDraftWithClosesPreset();

    const { error: openError } = await admin.rpc("open_round_at", {
      p_round_id: H.roundId,
      p_at: H.window.opensAt,
    });
    expect(openError).toBeNull();

    const { error: closeError } = await admin.rpc("close_round_at", {
      p_round_id: H.roundId,
      p_at: H.window.opensAt,
    });
    expect(closeError).toBeTruthy();
    expect((closeError as { hint: string }).hint).toBe("empty_window");
  });

  test("open_round_at: round_overlap (23P01) when the resulting window overlaps another round's interval", async () => {
    const admin = adminClient();
    const I = await freshDraftWithClosesPreset();
    const J = await freshDraft();

    // Move J's own window (service role, direct) to sit strictly inside the
    // window I is about to open into.
    const jOpens = plusMs(I.window.opensAt, 20_000);
    const jCloses = plusMs(I.window.opensAt, 40_000);
    const { error: moveError } = await admin
      .from("rounds")
      .update({ opens_at: jOpens, closes_at: jCloses })
      .eq("id", J.roundId);
    expect(moveError).toBeNull();

    const { error } = await admin.rpc("open_round_at", {
      p_round_id: I.roundId,
      p_at: I.window.opensAt,
    });
    expect(error).toBeTruthy();
    expect((error as { code: string }).code).toBe("23P01");
    expect((error as { hint: string }).hint).toBe("round_overlap");

    const after = await readDates(I.roundId);
    expect(after.opensAt).toBeNull();
  });

  test("update_round_at: adjacency is accepted at the exact boundary, refused one second inside", async () => {
    const admin = adminClient();
    const A = await trackedCreate({ window: "closed" });
    const K = await freshDraft();

    const kAt = plusMs(A.pastWindow!.closesAt, -10 * 60 * 1000);
    const kCloses = plusMs(A.pastWindow!.closesAt, 60_000);

    const { error: touchError } = await admin.rpc("update_round_at", {
      p_round_id: K.roundId,
      p_title: `e2e-${K.roundNumber}-K`,
      p_opens_at: A.pastWindow!.closesAt,
      p_closes_at: kCloses,
      p_at: kAt,
    });
    expect(touchError).toBeNull();

    const oneSecondEarlier = plusMs(A.pastWindow!.closesAt, -1000);
    const { error: overlapError } = await admin.rpc("update_round_at", {
      p_round_id: K.roundId,
      p_title: `e2e-${K.roundNumber}-K`,
      p_opens_at: oneSecondEarlier,
      p_closes_at: kCloses,
      p_at: kAt,
    });
    expect(overlapError).toBeTruthy();
    expect((overlapError as { code: string }).code).toBe("23P01");
    expect((overlapError as { hint: string }).hint).toBe("round_overlap");

    const after = await readDates(K.roundId);
    expect(new Date(after.opensAt!).getTime()).toBe(
      new Date(A.pastWindow!.closesAt).getTime()
    );
  });

  test("live wrappers (admin_open_round/admin_close_round/admin_update_round) at real now()", async () => {
    const draft = await trackedCreate({ window: "draft" });
    const closedFixture = await trackedCreate({ window: "closed" });

    // Round 1 is open right now — opening any e2e draft now refuses.
    {
      const { error } = await adminTestClient.rpc("admin_open_round", {
        p_round_id: draft.roundId,
      });
      expect(error).toBeTruthy();
      expect((error as { hint: string }).hint).toBe("another_round_open");
      const after = await readDates(draft.roundId);
      expect(after.opensAt).toBeNull();
    }

    // An always-closed fixture isn't open now.
    {
      const { error } = await adminTestClient.rpc("admin_close_round", {
        p_round_id: closedFixture.roundId,
      });
      expect(error).toBeTruthy();
      expect((error as { hint: string }).hint).toBe("round_not_open");
    }

    // Retitling only (both dates null) is stored.
    {
      const newTitle = `e2e-${draft.roundNumber}-renamed-live`;
      const { error } = await adminTestClient.rpc("admin_update_round", {
        p_round_id: draft.roundId,
        p_title: newTitle,
        p_opens_at: null,
        p_closes_at: null,
      });
      expect(error).toBeNull();
      const admin = adminClient();
      const { data } = await admin
        .from("rounds")
        .select("title")
        .eq("id", draft.roundId)
        .single();
      expect(data!.title).toBe(newTitle);
    }

    // Scheduling the draft open-ended in the future collides with Round
    // 1's own open-ended window.
    {
      const { error } = await adminTestClient.rpc("admin_update_round", {
        p_round_id: draft.roundId,
        p_title: `e2e-${draft.roundNumber}-renamed-live`,
        p_opens_at: "2099-01-01T00:00:00Z",
        p_closes_at: null,
      });
      expect(error).toBeTruthy();
      expect((error as { code: string }).code).toBe("23P01");
      expect((error as { hint: string }).hint).toBe("round_overlap");
    }
  });

  test("participants and anon cannot call any admin wrapper or service-role lifecycle function", async () => {
    const draft = await trackedCreate({ window: "draft" });
    const anon = anonClient();
    const nowIso = new Date().toISOString();

    const { error: openWrapperError } = await participantClient.rpc(
      "admin_open_round",
      { p_round_id: draft.roundId }
    );
    expect(openWrapperError).toBeTruthy();
    expect((openWrapperError as { hint: string }).hint).toBe("not_admin");

    const { error: closeWrapperError } = await participantClient.rpc(
      "admin_close_round",
      { p_round_id: draft.roundId }
    );
    expect(closeWrapperError).toBeTruthy();
    expect((closeWrapperError as { hint: string }).hint).toBe("not_admin");

    const { error: updateWrapperError } = await participantClient.rpc(
      "admin_update_round",
      {
        p_round_id: draft.roundId,
        p_title: "nope",
        p_opens_at: null,
        p_closes_at: null,
      }
    );
    expect(updateWrapperError).toBeTruthy();
    expect((updateWrapperError as { hint: string }).hint).toBe("not_admin");

    for (const client of [participantClient, anon]) {
      const { error: openError } = await client.rpc("open_round_at", {
        p_round_id: draft.roundId,
        p_at: nowIso,
      });
      expect(openError).toBeTruthy();

      const { error: closeError } = await client.rpc("close_round_at", {
        p_round_id: draft.roundId,
        p_at: nowIso,
      });
      expect(closeError).toBeTruthy();

      const { error: updateError } = await client.rpc("update_round_at", {
        p_round_id: draft.roundId,
        p_title: "nope",
        p_opens_at: null,
        p_closes_at: null,
        p_at: nowIso,
      });
      expect(updateError).toBeTruthy();
    }

    const after = await readDates(draft.roundId);
    expect(after.opensAt).toBeNull();
  });
});
