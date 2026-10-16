import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminClient,
  testEmail,
  authUserIdByEmail,
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
  seedOwnAnswers,
} from "../support/survey-fixtures";

/**
 * The full non-admin adversarial matrix (PRIV-01/02/03), the submit lock
 * (SURV-06/07), and SURV-08 — all proven against the live database as
 * non-admin participants, never assumed. Every e2e round used here is
 * either a draft, scheduled in the future, or already closed; the real,
 * currently-open Round 1 is used read/write exactly the way a real
 * participant would use it, and only test identities ever touch it.
 *
 * "Changes nothing" is asserted as: either the operation errors, or it
 * returns zero affected rows and a re-read shows the value unchanged —
 * both are valid RLS-enforced no-ops (a plain UPDATE whose USING clause
 * excludes the target row is silently skipped; an INSERT/UPSERT whose
 * WITH CHECK or a BEFORE trigger rejects the row raises an error). Error
 * presence is asserted, not exact Postgres wording, except where the plan
 * names a specific substring ("Cannot submit").
 */

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Either an error occurred, or the mutation affected zero rows. */
function expectNoopOrError(
  result: { data: unknown[] | null; error: { message?: string } | null }
) {
  if (!result.error) {
    expect(result.data ?? []).toHaveLength(0);
  } else {
    expect(result.error).toBeTruthy();
  }
}

test.describe.serial("survey privacy adversarial matrix @survey-privacy", () => {
  const paEmail = testEmail("participant", "pa");
  const pbEmail = testEmail("participant", "pb");
  const pcEmail = testEmail("participant", "pc");
  const adminEmail = testEmail("admin", "pv");

  let round1Id: string;
  let paClient: SupabaseClient;
  let pbClient: SupabaseClient;
  let pcClient: SupabaseClient;
  let adminTestClient: SupabaseClient;
  let paUserId: string;
  let pbUserId: string;
  let pcUserId: string;

  let paResponseId: string;
  let pbResponseId: string;

  let draftRoundId: string;
  let closedRoundA: { roundId: string; statementIds: string[] };
  let closedAggRound: { roundId: string; statementIds: string[] };
  let closedCRound: { roundId: string; statementIds: string[] };

  const statementIdCache = new Map<string, string>();
  async function getStatementId(key: string): Promise<string> {
    const cached = statementIdCache.get(key);
    if (cached) return cached;
    const { data, error } = await adminClient()
      .from("statements")
      .select("id")
      .eq("round_id", round1Id)
      .eq("key", key)
      .single();
    if (error || !data) {
      throw error ?? new Error(`statement ${key} not found`);
    }
    statementIdCache.set(key, data.id as string);
    return data.id as string;
  }

  test.beforeAll(async () => {
    await sweepStaleTestData();

    const admin = adminClient();
    const { data: round1 } = await admin
      .from("rounds")
      .select("id")
      .eq("round_number", 1)
      .single();
    round1Id = round1!.id as string;

    paClient = await signInAsTestUser(paEmail);
    pbClient = await signInAsTestUser(pbEmail);
    pcClient = await signInAsTestUser(pcEmail);
    paUserId = (await authUserIdByEmail(paEmail))!;
    pbUserId = (await authUserIdByEmail(pbEmail))!;
    pcUserId = (await authUserIdByEmail(pcEmail))!;

    await grantTestAdmin(adminEmail);
    adminTestClient = await signInAsTestUser(adminEmail);

    const draft = await createTestRound({ window: "draft" });
    draftRoundId = draft.roundId;
    closedRoundA = await createTestRound({ window: "closed" });
    closedAggRound = await createTestRound({ window: "closed" });
    closedCRound = await createTestRound({ window: "closed" });
  });

  test.afterAll(async () => {
    await deleteTestRound(draftRoundId).catch(() => undefined);
    await deleteTestRound(closedRoundA.roundId).catch(() => undefined);
    await deleteTestRound(closedAggRound.roundId).catch(() => undefined);
    await deleteTestRound(closedCRound.roundId).catch(() => undefined);

    await revokeTestAdmin(adminEmail).catch(() => undefined);
    await deleteAuthUserByEmail(paEmail);
    await deleteAuthUserByEmail(pbEmail);
    await deleteAuthUserByEmail(pcEmail);
    await deleteAuthUserByEmail(adminEmail);

    expect(await countAuthUsersByEmail(paEmail)).toBe(0);
    expect(await countAuthUsersByEmail(pbEmail)).toBe(0);
    expect(await countAuthUsersByEmail(pcEmail)).toBe(0);
    expect(await countAuthUsersByEmail(adminEmail)).toBe(0);
  });

  test("open-round only: a response insert succeeds only for the open round; an answer into a closed round errors; impersonation attempts error", async () => {
    // Impersonation checks run BEFORE participant A has a response row for
    // the open round, so the unique (round_id, user_id) constraint can
    // never mask the WITH CHECK violation being tested here.
    const { error: impersonateUserIdError } = await paClient
      .from("responses")
      .insert({ round_id: round1Id, user_id: pbUserId });
    expect(impersonateUserIdError).toBeTruthy();

    const { error: impersonateSubmittedError } = await paClient
      .from("responses")
      .insert({ round_id: round1Id, submitted_at: new Date().toISOString() });
    expect(impersonateSubmittedError).toBeTruthy();

    // Draft / closed rounds all reject a response insert. (A "scheduled"
    // round can no longer exist while Round 1 is open-ended — RND-05's
    // one-open-round rule is proven separately in admin-rounds-db.spec.ts.)
    for (const roundId of [draftRoundId, closedRoundA.roundId]) {
      const { error } = await paClient
        .from("responses")
        .insert({ round_id: roundId });
      expect(error).toBeTruthy();
    }

    // An answer pointing at a closed round's statement errors (no response
    // in that round exists for A, and round_id != the open round either).
    const { error: closedAnswerError } = await paClient.from("answers").insert({
      response_id: crypto.randomUUID(),
      round_id: closedRoundA.roundId,
      statement_id: closedRoundA.statementIds[0],
      value: 1,
    });
    expect(closedAnswerError).toBeTruthy();

    // The open round accepts the insert — this becomes A's response row,
    // reused by every later test in this file.
    const { error: openInsertError } = await paClient
      .from("responses")
      .insert({ round_id: round1Id });
    expect(openInsertError).toBeNull();

    const { data: paResponse, error: paResponseError } = await paClient
      .from("responses")
      .select("id")
      .eq("round_id", round1Id)
      .single();
    expect(paResponseError).toBeNull();
    paResponseId = paResponse!.id as string;
  });

  test("scale membership on Round 1: out-of-scale values are rejected and never stored; in-scale values succeed", async () => {
    const s101 = await getStatementId("s1_01");
    const s201 = await getStatementId("s2_01");

    async function attempt(statementId: string, value: number) {
      return paClient.from("answers").upsert(
        {
          response_id: paResponseId,
          round_id: round1Id,
          statement_id: statementId,
          value,
        },
        { onConflict: "response_id,statement_id" }
      );
    }
    async function currentValue(statementId: string): Promise<number | null> {
      const { data } = await adminClient()
        .from("answers")
        .select("value")
        .eq("response_id", paResponseId)
        .eq("statement_id", statementId)
        .maybeSingle();
      return (data?.value as number | undefined) ?? null;
    }

    // s1_01 (familiarity, options 1-4): 0, 5, 2.5 are rejected while no row
    // exists yet — stored value stays null throughout.
    for (const bad of [0, 5, 2.5]) {
      const { error } = await attempt(s101, bad);
      expect(error).toBeTruthy();
      expect(await currentValue(s101)).toBeNull();
    }

    // Each accepted value becomes the new stored value, and an immediately
    // following rejection never moves it off that value.
    for (const good of [1, 2, 3, 4]) {
      const { error } = await attempt(s101, good);
      expect(error).toBeNull();
      expect(await currentValue(s101)).toBe(good);

      const { error: rejectedError } = await attempt(s101, 0);
      expect(rejectedError).toBeTruthy();
      expect(await currentValue(s101)).toBe(good);
    }

    // s2_01 (agreement, options 1-5): 6 rejected, 5 accepted.
    const { error: err6 } = await attempt(s201, 6);
    expect(err6).toBeTruthy();
    expect(await currentValue(s201)).toBeNull();

    const { error: err5 } = await attempt(s201, 5);
    expect(err5).toBeNull();
    expect(await currentValue(s201)).toBe(5);
  });

  test("idempotency: repeated upserts of the same statement collapse to one row; re-creating the response is a no-op", async () => {
    const s102 = await getStatementId("s1_02");

    async function upsertS102(value: number) {
      return paClient.from("answers").upsert(
        {
          response_id: paResponseId,
          round_id: round1Id,
          statement_id: s102,
          value,
        },
        { onConflict: "response_id,statement_id" }
      );
    }

    const admin = adminClient();

    await upsertS102(2);
    await upsertS102(2);
    let { data: rows } = await admin
      .from("answers")
      .select("id, value")
      .eq("response_id", paResponseId)
      .eq("statement_id", s102);
    expect(rows).toHaveLength(1);
    expect(rows![0].value).toBe(2);

    await upsertS102(3);
    ({ data: rows } = await admin
      .from("answers")
      .select("id, value")
      .eq("response_id", paResponseId)
      .eq("statement_id", s102));
    expect(rows).toHaveLength(1);
    expect(rows![0].value).toBe(3);

    const { error: reinsertError } = await paClient.from("responses").upsert(
      { round_id: round1Id },
      { onConflict: "round_id,user_id", ignoreDuplicates: true }
    );
    expect(reinsertError).toBeNull();

    const { data: paResponses } = await paClient
      .from("responses")
      .select("id")
      .eq("round_id", round1Id);
    expect(paResponses).toHaveLength(1);
    expect(paResponses![0].id).toBe(paResponseId);
  });

  test("concurrency (participant B): two parallel response upserts give one row; two parallel answer upserts of the same statement give one row", async () => {
    const createFirst = () =>
      pbClient.from("responses").upsert(
        { round_id: round1Id },
        { onConflict: "round_id,user_id", ignoreDuplicates: true }
      );
    const [first, second] = await Promise.all([createFirst(), createFirst()]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const { data: pbResponses } = await pbClient
      .from("responses")
      .select("id")
      .eq("round_id", round1Id);
    expect(pbResponses).toHaveLength(1);
    pbResponseId = pbResponses![0].id as string;

    const s101 = await getStatementId("s1_01");
    const upsertAnswer = (value: number) =>
      pbClient.from("answers").upsert(
        {
          response_id: pbResponseId,
          round_id: round1Id,
          statement_id: s101,
          value,
        },
        { onConflict: "response_id,statement_id" }
      );
    const [a1, a2] = await Promise.all([upsertAnswer(1), upsertAnswer(2)]);
    expect(a1.error).toBeNull();
    expect(a2.error).toBeNull();

    const { data: pbAnswers } = await adminClient()
      .from("answers")
      .select("value")
      .eq("response_id", pbResponseId)
      .eq("statement_id", s101);
    expect(pbAnswers).toHaveLength(1);
    expect([1, 2]).toContain(pbAnswers![0].value);
  });

  test("isolation, as B: zero access to A's rows by id or by an unfiltered scan; writes into A's data are refused; nothing is deletable", async () => {
    const s101 = await getStatementId("s1_01");
    const s202 = await getStatementId("s2_02");
    const admin = adminClient();

    const { data: paAnswerRow } = await admin
      .from("answers")
      .select("id, value")
      .eq("response_id", paResponseId)
      .eq("statement_id", s101)
      .single();
    const paAnswerId = paAnswerRow!.id as string;
    const paAnswerOriginalValue = paAnswerRow!.value as number;

    // 1. Filtered selects by A's ids return nothing.
    const { data: selResp } = await pbClient
      .from("responses")
      .select("id")
      .eq("id", paResponseId);
    expect(selResp ?? []).toHaveLength(0);

    const { data: selAns } = await pbClient
      .from("answers")
      .select("id")
      .eq("id", paAnswerId);
    expect(selAns ?? []).toHaveLength(0);

    // 2. An unfiltered scan of answers returns only B's own rows.
    const { data: allAnswersAsB } = await pbClient
      .from("answers")
      .select("response_id");
    expect(
      (allAnswersAsB ?? []).every((a) => a.response_id === pbResponseId)
    ).toBe(true);

    // 3. Updating A's answer by id changes nothing; A's own client still
    // reads the original value.
    const updateResult = await pbClient
      .from("answers")
      .update({ value: paAnswerOriginalValue === 4 ? 3 : 4 })
      .eq("id", paAnswerId)
      .select();
    expectNoopOrError(updateResult);

    const { data: recheckedAnswer } = await paClient
      .from("answers")
      .select("value")
      .eq("id", paAnswerId)
      .single();
    expect(recheckedAnswer!.value).toBe(paAnswerOriginalValue);

    // 4. Inserting a brand-new answer pointed at A's response errors.
    const { error: insertIntoAError } = await pbClient.from("answers").insert({
      response_id: paResponseId,
      round_id: round1Id,
      statement_id: s202,
      value: 2,
    });
    expect(insertIntoAError).toBeTruthy();

    // 5. Re-pointing B's own answer at A's response errors (identity
    // columns on an answer are immutable).
    const { data: pbAnswerRow } = await admin
      .from("answers")
      .select("id")
      .eq("response_id", pbResponseId)
      .eq("statement_id", s101)
      .single();
    const pbAnswerId = pbAnswerRow!.id as string;

    const { error: repointError } = await pbClient
      .from("answers")
      .update({ response_id: paResponseId })
      .eq("id", pbAnswerId);
    expect(repointError).toBeTruthy();

    // 6. Nothing is deletable by a non-admin — delete is revoked at the
    // grant level for `authenticated`, so every attempt errors and the
    // service-role counts never move.
    const { count: answersCountBefore } = await admin
      .from("answers")
      .select("id", { count: "exact", head: true });
    const { count: responsesCountBefore } = await admin
      .from("responses")
      .select("id", { count: "exact", head: true });

    const { error: delAError } = await pbClient
      .from("answers")
      .delete()
      .eq("id", paAnswerId);
    expect(delAError).toBeTruthy();

    const { error: delBError } = await pbClient
      .from("answers")
      .delete()
      .eq("id", pbAnswerId);
    expect(delBError).toBeTruthy();

    const { error: delRespAError } = await pbClient
      .from("responses")
      .delete()
      .eq("id", paResponseId);
    expect(delRespAError).toBeTruthy();

    const { error: delRespBError } = await pbClient
      .from("responses")
      .delete()
      .eq("id", pbResponseId);
    expect(delRespBError).toBeTruthy();

    const { count: answersCountAfter } = await admin
      .from("answers")
      .select("id", { count: "exact", head: true });
    const { count: responsesCountAfter } = await admin
      .from("responses")
      .select("id", { count: "exact", head: true });
    expect(answersCountAfter).toBe(answersCountBefore);
    expect(responsesCountAfter).toBe(responsesCountBefore);
  });

  test("submit lock (participant A): an incomplete update is refused by the trigger; completion locks it with the DB clock; every further write is refused", async () => {
    const { error: incompleteError } = await paClient
      .from("responses")
      .update({ submitted_at: new Date().toISOString() })
      .eq("id", paResponseId);
    expect(incompleteError).toBeTruthy();
    expect(incompleteError!.message).toContain("Cannot submit");
    // Drives the real responses_before_write trigger's incomplete-submit
    // error and asserts BOTH halves of the condition
    // src/lib/survey/actions.ts's submitResponse() keys its error
    // classification on (`updateError?.code === "23514" &&
    // updateError?.message?.startsWith("Cannot submit")`, see the WR-03
    // code-review fix) — not just the message substring the original
    // assertion above checked. The trigger raises 23514 for three
    // different guards (identity-column change, already-submitted
    // re-touch, incomplete-submit), so the message prefix is what
    // actually disambiguates this case; both must be verified against
    // the live trigger, not assumed.
    expect(incompleteError!.code).toBe("23514");
    expect(incompleteError!.message.startsWith("Cannot submit")).toBe(true);

    await seedOwnAnswers(paClient, {
      exceptKeys: ["s1_01", "s1_02", "s2_01"],
    });

    const { data: lockRows, error: lockError } = await paClient
      .from("responses")
      .update({ submitted_at: "2000-01-01T00:00:00Z" })
      .eq("id", paResponseId)
      .is("submitted_at", null)
      .select("submitted_at");
    expect(lockError).toBeNull();
    expect(lockRows).toHaveLength(1);
    const storedMs = new Date(lockRows![0].submitted_at as string).getTime();
    expect(Math.abs(Date.now() - storedMs)).toBeLessThan(5 * 60 * 1000);

    const s701 = await getStatementId("s7_01");

    const { error: answerUpsertError } = await paClient.from("answers").upsert(
      {
        response_id: paResponseId,
        round_id: round1Id,
        statement_id: s701,
        value: 1,
      },
      { onConflict: "response_id,statement_id" }
    );
    expect(answerUpsertError).toBeTruthy();

    const answerUpdateResult = await paClient
      .from("answers")
      .update({ value: 2 })
      .eq("response_id", paResponseId)
      .eq("statement_id", s701)
      .select();
    expectNoopOrError(answerUpdateResult);

    const unlockResult = await paClient
      .from("responses")
      .update({ submitted_at: null })
      .eq("id", paResponseId)
      .select();
    expectNoopOrError(unlockResult);

    const { error: secondInsertError } = await paClient
      .from("responses")
      .insert({ round_id: round1Id });
    expect(secondInsertError).toBeTruthy();
  });

  test("double submit (B, after completing): two parallel updates produce exactly one transition", async () => {
    await seedOwnAnswers(pbClient, { exceptKeys: ["s1_01"] });

    const submitOnce = () =>
      pbClient
        .from("responses")
        .update({ submitted_at: new Date().toISOString() })
        .eq("id", pbResponseId)
        .is("submitted_at", null)
        .select("id, submitted_at");

    const [first, second] = await Promise.all([submitOnce(), submitOnce()]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const winnerRows = [...(first.data ?? []), ...(second.data ?? [])];
    expect(winnerRows).toHaveLength(1);

    const { data: finalPb } = await pbClient
      .from("responses")
      .select("submitted_at")
      .eq("id", pbResponseId)
      .single();
    expect(finalPb!.submitted_at).toBe(winnerRows[0].submitted_at);
  });

  test("aggregates: non-admins and anon get an error; the admin gets admin-only, identity-free rows; a fixture round's counts match exactly", async () => {
    const anon = anonClient();

    for (const client of [paClient, pbClient, anon]) {
      const { error } = await client.rpc("admin_round_response_counts");
      expect(error).toBeTruthy();
      const { error: stmtError } = await client.rpc(
        "admin_statement_answer_counts",
        { p_round_id: round1Id }
      );
      expect(stmtError).toBeTruthy();
    }

    const { data: roundCounts, error: roundCountsError } =
      await adminTestClient.rpc("admin_round_response_counts");
    expect(roundCountsError).toBeNull();
    for (const row of roundCounts ?? []) {
      expect(Object.keys(row).sort()).toEqual([
        "round_id",
        "started_count",
        "submitted_count",
      ]);
    }

    const { data: stmtCounts, error: stmtCountsError } =
      await adminTestClient.rpc("admin_statement_answer_counts", {
        p_round_id: round1Id,
      });
    expect(stmtCountsError).toBeNull();
    for (const row of stmtCounts ?? []) {
      expect(Object.keys(row).sort()).toEqual([
        "answer_count",
        "statement_id",
        "statement_key",
        "value",
      ]);
    }

    // Explicit fixture on a separate, isolated closed round: A submitted
    // (e2e_01 = 1, e2e_02 = 2); B unsubmitted (e2e_01 = 3 only).
    const service = adminClient();
    const [e2e01, e2e02] = closedAggRound.statementIds;

    await service
      .from("responses")
      .insert({ round_id: closedAggRound.roundId, user_id: paUserId });
    const { data: paAggResp } = await service
      .from("responses")
      .select("id")
      .eq("round_id", closedAggRound.roundId)
      .eq("user_id", paUserId)
      .single();
    await service.from("answers").insert([
      {
        response_id: paAggResp!.id,
        round_id: closedAggRound.roundId,
        statement_id: e2e01,
        value: 1,
      },
      {
        response_id: paAggResp!.id,
        round_id: closedAggRound.roundId,
        statement_id: e2e02,
        value: 2,
      },
    ]);
    await service
      .from("responses")
      .update({ submitted_at: new Date().toISOString() })
      .eq("id", paAggResp!.id);

    await service
      .from("responses")
      .insert({ round_id: closedAggRound.roundId, user_id: pbUserId });
    const { data: pbAggResp } = await service
      .from("responses")
      .select("id")
      .eq("round_id", closedAggRound.roundId)
      .eq("user_id", pbUserId)
      .single();
    await service.from("answers").insert([
      {
        response_id: pbAggResp!.id,
        round_id: closedAggRound.roundId,
        statement_id: e2e01,
        value: 3,
      },
    ]);

    const { data: fixtureRoundCounts } = await adminTestClient.rpc(
      "admin_round_response_counts"
    );
    const roundRow = (fixtureRoundCounts ?? []).find(
      (r: { round_id: string }) => r.round_id === closedAggRound.roundId
    ) as { started_count: number; submitted_count: number } | undefined;
    expect(roundRow).toBeTruthy();
    expect(Number(roundRow!.started_count)).toBe(2);
    expect(Number(roundRow!.submitted_count)).toBe(1);

    const { data: fixtureStmtCounts } = await adminTestClient.rpc(
      "admin_statement_answer_counts",
      { p_round_id: closedAggRound.roundId }
    );
    const simplified = (fixtureStmtCounts ?? [])
      .map((r: { statement_key: string; value: number; answer_count: number }) => ({
        key: r.statement_key,
        value: r.value,
        count: Number(r.answer_count),
      }))
      .sort((a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key));
    expect(simplified).toEqual([
      { key: "e2e_01", value: 1, count: 1 },
      { key: "e2e_02", value: 2, count: 1 },
    ]);
  });

  test("SURV-08 (DB): a submitted response in an earlier, closed round never blocks writing the participant's own open-round response", async () => {
    const service = adminClient();

    await service
      .from("responses")
      .insert({ round_id: closedCRound.roundId, user_id: pcUserId });
    const { data: pcClosedResp } = await service
      .from("responses")
      .select("id")
      .eq("round_id", closedCRound.roundId)
      .eq("user_id", pcUserId)
      .single();
    await service.from("answers").insert(
      closedCRound.statementIds.map((id, i) => ({
        response_id: pcClosedResp!.id,
        round_id: closedCRound.roundId,
        statement_id: id,
        value: i + 1,
      }))
    );
    await service
      .from("responses")
      .update({ submitted_at: new Date().toISOString() })
      .eq("id", pcClosedResp!.id);

    const { error: insertError } = await pcClient
      .from("responses")
      .insert({ round_id: round1Id });
    expect(insertError).toBeNull();

    const { data: pcOpenResp } = await pcClient
      .from("responses")
      .select("id")
      .eq("round_id", round1Id)
      .single();

    const s101 = await getStatementId("s1_01");
    const { error: answerError } = await pcClient.from("answers").upsert(
      {
        response_id: pcOpenResp!.id,
        round_id: round1Id,
        statement_id: s101,
        value: 1,
      },
      { onConflict: "response_id,statement_id" }
    );
    expect(answerError).toBeNull();
  });
});
