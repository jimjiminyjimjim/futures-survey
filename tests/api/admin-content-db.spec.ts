import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { adminErrorMessage, ADMIN_MESSAGES } from "../../src/lib/admin/messages";
import { isContentEditable } from "../../src/lib/admin/rounds-queries";
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
  deleteTestCreatedRound,
  assertTestRound,
  snapshotRound1,
} from "../support/survey-fixtures";

/**
 * RND-01/RND-03/RND-04: every DB case for round copy (keys preserved,
 * sort_order remapped by position), statement/section CRUD + reorder,
 * the content-lock trigger/RLS for every role, and non-admin refusals —
 * all against the live hosted project. admin_create_round makes a
 * REAL-numbered round: every test that calls it deletes what it created
 * via deleteTestCreatedRound before moving on. Round 1 is read-only here.
 */

test.describe("admin content DB — @static (no DB)", () => {
  test("adminErrorMessage maps hints to copy, with a safe fallback", () => {
    expect(adminErrorMessage({ hint: "round_locked" })).toBe(
      ADMIN_MESSAGES.roundLockedOpen
    );
    expect(adminErrorMessage({ hint: "text_blank" })).toBe(
      ADMIN_MESSAGES.textBlank
    );
    for (const hint of [
      "not_admin",
      "round_not_found",
      "section_not_found",
      "statement_not_found",
      "invalid_order",
      "immutable",
      "key_immutable",
      "invalid_scale",
      "something_unknown",
    ]) {
      expect(adminErrorMessage({ hint })).toBe(ADMIN_MESSAGES.saveFailed);
    }
    expect(adminErrorMessage(null)).toBe(ADMIN_MESSAGES.saveFailed);
    expect(adminErrorMessage(undefined)).toBe(ADMIN_MESSAGES.saveFailed);
  });

  test("isContentEditable is true for draft/scheduled, false for open/closed", () => {
    expect(isContentEditable("draft")).toBe(true);
    expect(isContentEditable("scheduled")).toBe(true);
    expect(isContentEditable("open")).toBe(false);
    expect(isContentEditable("closed")).toBe(false);
  });
});

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe.serial("admin content DB — @admin-content-db", () => {
  const adminEmail = testEmail("admin", "cdb");
  const participantEmail = testEmail("participant", "cdb");

  let round1SnapshotBefore: string;
  let adminTestClient: ReturnType<typeof adminClient>;
  let participantClient: ReturnType<typeof adminClient>;

  // Tracks every round this suite creates through admin_create_round (real
  // numbered) or createTestRound (draft/closed fixtures), for guaranteed
  // cleanup in afterAll even if an individual test throws mid-way.
  const createdRoundIds: string[] = [];
  const fixtureRoundIds: string[] = [];

  test.beforeAll(async () => {
    await sweepStaleTestData();
    round1SnapshotBefore = await snapshotRound1();

    await grantTestAdmin(adminEmail);
    adminTestClient = await signInAsTestUser(adminEmail);
    participantClient = await signInAsTestUser(participantEmail);
  });

  test.afterAll(async () => {
    for (const id of [...createdRoundIds]) {
      await deleteTestCreatedRound(id).catch(() => undefined);
    }
    for (const id of [...fixtureRoundIds]) {
      await deleteTestRound(id).catch(() => undefined);
    }

    await revokeTestAdmin(adminEmail);
    await deleteAuthUserByEmail(adminEmail);
    await deleteAuthUserByEmail(participantEmail);
    expect(await countAuthUsersByEmail(adminEmail)).toBe(0);
    expect(await countAuthUsersByEmail(participantEmail)).toBe(0);

    const round1SnapshotAfter = await snapshotRound1();
    expect(round1SnapshotAfter).toBe(round1SnapshotBefore);
  });

  // -------------------------------------------------------------------
  // round_content_editable_at: the must_haves 5-case matrix
  // -------------------------------------------------------------------

  test("round_content_editable_at: the must_haves matrix", async () => {
    const admin = adminClient();
    const T = "2030-01-01T00:00:00.000000Z";
    const TPlus1us = "2030-01-01T00:00:00.000001Z";
    const TMinus1us = "2029-12-31T23:59:59.999999Z";

    const cases: Array<{
      opensAt: string | null;
      at: string | null;
      expected: boolean;
    }> = [
      { opensAt: null, at: T, expected: true },
      { opensAt: TPlus1us, at: T, expected: true },
      { opensAt: T, at: T, expected: false },
      { opensAt: TMinus1us, at: T, expected: false },
      { opensAt: T, at: null, expected: false },
    ];

    for (const c of cases) {
      const { data, error } = await admin.rpc("round_content_editable_at", {
        p_opens_at: c.opensAt,
        p_at: c.at,
      });
      expect(error).toBeNull();
      expect(data).toBe(c.expected);
    }
  });

  // -------------------------------------------------------------------
  // Copy: admin_create_round (RND-01/RND-04)
  // -------------------------------------------------------------------

  test("copy: multi-section source (incl. an empty section) is copied exactly, keys preserved", async () => {
    const source = await createTestRound({
      window: "draft",
      highest: true,
      sections: [
        { scaleKey: "familiarity", statementCount: 2 },
        { scaleKey: "agreement", statementCount: 3 },
        { scaleKey: "agreement", statementCount: 0 },
      ],
    });
    fixtureRoundIds.push(source.roundId);
    await assertTestRound(source.roundId);

    const admin = adminClient();
    const { data: maxRow } = await admin
      .from("rounds")
      .select("round_number")
      .order("round_number", { ascending: false })
      .limit(1)
      .single();
    expect(maxRow!.round_number).toBe(source.roundNumber);

    const { data: sourceBefore } = await admin
      .from("rounds")
      .select("title")
      .eq("id", source.roundId)
      .single();

    const { data: newRoundId, error } = await adminTestClient.rpc(
      "admin_create_round",
      { p_title: `e2e-copy-${source.roundNumber}` }
    );
    expect(error).toBeNull();
    createdRoundIds.push(newRoundId as string);

    const { data: newRound } = await admin
      .from("rounds")
      .select("round_number, opens_at, closes_at")
      .eq("id", newRoundId as string)
      .single();
    expect(newRound!.round_number).toBe(source.roundNumber + 1);
    expect(newRound!.opens_at).toBeNull();
    expect(newRound!.closes_at).toBeNull();

    async function sectionsWithStatements(roundId: string) {
      const { data } = await admin
        .from("sections")
        .select("sort_order, title, prompt, scale_key, statements(sort_order, key, text)")
        .eq("round_id", roundId)
        .order("sort_order");
      return (data ?? []).map((s) => ({
        sortOrder: s.sort_order,
        title: s.title,
        prompt: s.prompt,
        scaleKey: s.scale_key,
        statements: (
          (s.statements as { sort_order: number; key: string; text: string }[]) ?? []
        )
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((st) => ({ sortOrder: st.sort_order, key: st.key, text: st.text })),
      }));
    }

    const sourceRows = await sectionsWithStatements(source.roundId);
    const newRows = await sectionsWithStatements(newRoundId as string);
    expect(newRows).toEqual(sourceRows);
    expect(newRows[2].statements).toEqual([]);

    const { data: sourceAfter } = await admin
      .from("rounds")
      .select("title")
      .eq("id", source.roundId)
      .single();
    expect(sourceAfter!.title).toBe(sourceBefore!.title);
  });

  test("copy: zero-section highest source copies with zero sections", async () => {
    const source = await createTestRound({
      window: "draft",
      highest: true,
      sections: [],
    });
    fixtureRoundIds.push(source.roundId);

    const { data: newRoundId, error } = await adminTestClient.rpc(
      "admin_create_round",
      { p_title: null }
    );
    expect(error).toBeNull();
    createdRoundIds.push(newRoundId as string);

    const admin = adminClient();
    const { data: sections } = await admin
      .from("sections")
      .select("id")
      .eq("round_id", newRoundId as string);
    expect(sections ?? []).toHaveLength(0);
  });

  test("copy: null title defaults to 'Round {N}'; a padded title is trimmed", async () => {
    const source = await createTestRound({ window: "draft", highest: true });
    fixtureRoundIds.push(source.roundId);

    const { data: defaultedRoundId, error: defaultError } = await adminTestClient.rpc(
      "admin_create_round",
      { p_title: null }
    );
    expect(defaultError).toBeNull();
    createdRoundIds.push(defaultedRoundId as string);

    const admin = adminClient();
    const { data: defaultedRound } = await admin
      .from("rounds")
      .select("round_number, title")
      .eq("id", defaultedRoundId as string)
      .single();
    expect(defaultedRound!.title).toBe(`Round ${defaultedRound!.round_number}`);

    const paddedTitle = `  e2e-trim-${source.roundNumber}  `;
    const { data: trimmedRoundId, error: trimmedError } = await adminTestClient.rpc(
      "admin_create_round",
      { p_title: paddedTitle }
    );
    expect(trimmedError).toBeNull();
    createdRoundIds.push(trimmedRoundId as string);

    const { data: trimmedRound } = await admin
      .from("rounds")
      .select("title")
      .eq("id", trimmedRoundId as string)
      .single();
    expect(trimmedRound!.title).toBe(paddedTitle.trim());
  });

  test("copy: two parallel creates both succeed with distinct, consecutive round numbers", async () => {
    const source = await createTestRound({ window: "draft", highest: true });
    fixtureRoundIds.push(source.roundId);

    const [first, second] = await Promise.all([
      adminTestClient.rpc("admin_create_round", {
        p_title: `e2e-concurrent-a-${source.roundNumber}`,
      }),
      adminTestClient.rpc("admin_create_round", {
        p_title: `e2e-concurrent-b-${source.roundNumber}`,
      }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    createdRoundIds.push(first.data as string, second.data as string);

    const admin = adminClient();
    const { data: rows } = await admin
      .from("rounds")
      .select("id, round_number")
      .in("id", [first.data as string, second.data as string])
      .order("round_number");
    expect(rows).toHaveLength(2);
    expect(rows![0].round_number).toBe(source.roundNumber + 1);
    expect(rows![1].round_number).toBe(source.roundNumber + 2);

    for (const row of rows ?? []) {
      const { data: sections } = await admin
        .from("sections")
        .select("id")
        .eq("round_id", row.id as string);
      expect(sections ?? []).toHaveLength(1);
    }
  });

  // -------------------------------------------------------------------
  // Statements on a draft copy (RND-03/RND-04)
  // -------------------------------------------------------------------

  test("statements: key generation (incl. r{N}_100), update, delete, parallel add, reorder, key_immutable, duplicate key", async () => {
    const round = await createTestRound({ window: "draft", statementCount: 0 });
    fixtureRoundIds.push(round.roundId);
    const sectionId = round.sectionId;
    const n = round.roundNumber;
    const admin = adminClient();

    const { data: firstId, error: firstError } = await adminTestClient.rpc(
      "admin_add_statement",
      { p_section_id: sectionId, p_text: "First statement" }
    );
    expect(firstError).toBeNull();
    const { data: firstRow } = await admin
      .from("statements")
      .select("key, sort_order")
      .eq("id", firstId as string)
      .single();
    expect(firstRow!.key).toBe(`r${n}_01`);
    expect(firstRow!.sort_order).toBe(1);

    const { data: secondId, error: secondError } = await adminTestClient.rpc(
      "admin_add_statement",
      { p_section_id: sectionId, p_text: "Second statement" }
    );
    expect(secondError).toBeNull();
    const { data: secondRow } = await admin
      .from("statements")
      .select("key, sort_order")
      .eq("id", secondId as string)
      .single();
    expect(secondRow!.key).toBe(`r${n}_02`);
    expect(secondRow!.sort_order).toBe(2);

    // Service-role bulk insert r{n}_03..r{n}_99 so the next add must roll
    // over to 3 digits without truncation.
    const bulkRows = Array.from({ length: 97 }, (_, i) => ({
      round_id: round.roundId,
      section_id: sectionId,
      sort_order: i + 3,
      key: `r${n}_${String(i + 3).padStart(2, "0")}`,
      text: `filler ${i + 3}`,
    }));
    const { error: bulkError } = await admin.from("statements").insert(bulkRows);
    expect(bulkError).toBeNull();

    const { data: hundredthId, error: hundredthError } = await adminTestClient.rpc(
      "admin_add_statement",
      { p_section_id: sectionId, p_text: "Hundredth statement" }
    );
    expect(hundredthError).toBeNull();
    const { data: hundredthRow } = await admin
      .from("statements")
      .select("key, sort_order")
      .eq("id", hundredthId as string)
      .single();
    expect(hundredthRow!.key).toBe(`r${n}_100`);
    expect(hundredthRow!.sort_order).toBe(100);

    // Update text.
    const { error: updateError } = await adminTestClient.rpc(
      "admin_update_statement",
      { p_statement_id: firstId as string, p_text: "Updated first" }
    );
    expect(updateError).toBeNull();
    const { data: updatedRow } = await admin
      .from("statements")
      .select("text, key")
      .eq("id", firstId as string)
      .single();
    expect(updatedRow!.text).toBe("Updated first");
    expect(updatedRow!.key).toBe(`r${n}_01`);

    // Delete, then delete again.
    const { error: deleteError } = await adminTestClient.rpc(
      "admin_delete_statement",
      { p_statement_id: firstId as string }
    );
    expect(deleteError).toBeNull();
    const { data: goneRow } = await admin
      .from("statements")
      .select("id")
      .eq("id", firstId as string)
      .maybeSingle();
    expect(goneRow).toBeNull();

    const { error: deleteAgainError } = await adminTestClient.rpc(
      "admin_delete_statement",
      { p_statement_id: firstId as string }
    );
    expect(deleteAgainError).toBeTruthy();
    expect((deleteAgainError as { hint: string }).hint).toBe(
      "statement_not_found"
    );

    // Parallel adds get distinct sort_order and key.
    const [parallelA, parallelB] = await Promise.all([
      adminTestClient.rpc("admin_add_statement", {
        p_section_id: sectionId,
        p_text: "Parallel A",
      }),
      adminTestClient.rpc("admin_add_statement", {
        p_section_id: sectionId,
        p_text: "Parallel B",
      }),
    ]);
    expect(parallelA.error).toBeNull();
    expect(parallelB.error).toBeNull();
    expect(parallelA.data).not.toBe(parallelB.data);
    const { data: parallelRows } = await admin
      .from("statements")
      .select("id, sort_order, key")
      .in("id", [parallelA.data as string, parallelB.data as string]);
    expect(parallelRows).toHaveLength(2);
    expect(parallelRows![0].sort_order).not.toBe(parallelRows![1].sort_order);
    expect(parallelRows![0].key).not.toBe(parallelRows![1].key);

    // Valid reorder: a permutation sets sort_order exactly 1..n in order.
    const { data: allStatements } = await admin
      .from("statements")
      .select("id")
      .eq("section_id", sectionId)
      .order("sort_order");
    const orderedIds = (allStatements ?? []).map((r) => r.id as string);
    const reversedIds = [...orderedIds].reverse();
    const { error: reorderError } = await adminTestClient.rpc(
      "admin_reorder_statements",
      { p_section_id: sectionId, p_statement_ids: reversedIds }
    );
    expect(reorderError).toBeNull();
    const { data: reorderedRows } = await admin
      .from("statements")
      .select("id, sort_order")
      .in("id", reversedIds);
    const sortOrderById = new Map(
      (reorderedRows ?? []).map((r) => [r.id as string, r.sort_order as number])
    );
    reversedIds.forEach((id, index) => {
      expect(sortOrderById.get(id)).toBe(index + 1);
    });

    // Invalid reorders (missing id, duplicated id, foreign id) are refused,
    // and the order from the valid reorder above stays unchanged.
    const snapshotBefore = new Map(sortOrderById);
    const missing = reversedIds.slice(1); // too short
    const { error: missingError } = await adminTestClient.rpc(
      "admin_reorder_statements",
      { p_section_id: sectionId, p_statement_ids: missing }
    );
    expect(missingError).toBeTruthy();
    expect((missingError as { hint: string }).hint).toBe("invalid_order");

    const duplicated = [reversedIds[0], ...reversedIds];
    const { error: duplicatedError } = await adminTestClient.rpc(
      "admin_reorder_statements",
      { p_section_id: sectionId, p_statement_ids: duplicated }
    );
    expect(duplicatedError).toBeTruthy();
    expect((duplicatedError as { hint: string }).hint).toBe("invalid_order");

    const foreign = [...reversedIds.slice(1), hundredthId as string];
    // hundredthId already belongs to this section, so swap in Round 1's id
    // (definitely foreign to this section) instead.
    const { data: round1Statement } = await admin
      .from("statements")
      .select("id")
      .eq("round_id", (await admin
        .from("rounds")
        .select("id")
        .eq("round_number", 1)
        .single()).data!.id as string)
      .limit(1)
      .single();
    foreign[foreign.length - 1] = round1Statement!.id as string;
    const { error: foreignError } = await adminTestClient.rpc(
      "admin_reorder_statements",
      { p_section_id: sectionId, p_statement_ids: foreign }
    );
    expect(foreignError).toBeTruthy();
    expect((foreignError as { hint: string }).hint).toBe("invalid_order");

    const { data: unchangedRows } = await admin
      .from("statements")
      .select("id, sort_order")
      .in("id", reversedIds);
    for (const row of unchangedRows ?? []) {
      expect(row.sort_order).toBe(snapshotBefore.get(row.id as string));
    }

    // An admin's direct update of a key is refused (key_immutable).
    const { error: keyChangeError } = await adminTestClient
      .from("statements")
      .update({ key: "r999_99" })
      .eq("id", secondId as string);
    expect(keyChangeError).toBeTruthy();
    expect((keyChangeError as { hint?: string }).hint).toBe("key_immutable");

    // A service-role insert duplicating a key in the same round is a
    // plain unique violation.
    const { error: dupKeyError } = await admin.from("statements").insert({
      round_id: round.roundId,
      section_id: sectionId,
      sort_order: 9999,
      key: `r${n}_02`,
      text: "dup",
    });
    expect(dupKeyError).toBeTruthy();
    expect((dupKeyError as { code: string }).code).toBe("23505");
  });

  // -------------------------------------------------------------------
  // Sections on a draft copy (RND-03)
  // -------------------------------------------------------------------

  test("sections: validation, update, reorder, delete cascades its statements", async () => {
    const round = await createTestRound({ window: "draft" });
    fixtureRoundIds.push(round.roundId);
    const admin = adminClient();

    const { error: blankTitleError } = await adminTestClient.rpc(
      "admin_add_section",
      {
        p_round_id: round.roundId,
        p_title: "   ",
        p_prompt: "A prompt",
        p_scale_key: "agreement",
      }
    );
    expect(blankTitleError).toBeTruthy();
    expect((blankTitleError as { hint: string }).hint).toBe("title_blank");

    const { error: invalidScaleError } = await adminTestClient.rpc(
      "admin_add_section",
      {
        p_round_id: round.roundId,
        p_title: "A title",
        p_prompt: "A prompt",
        p_scale_key: "nope",
      }
    );
    expect(invalidScaleError).toBeTruthy();
    expect((invalidScaleError as { hint: string }).hint).toBe("invalid_scale");

    const { data: newSectionId, error: addError } = await adminTestClient.rpc(
      "admin_add_section",
      {
        p_round_id: round.roundId,
        p_title: "Second section",
        p_prompt: "Second prompt",
        p_scale_key: "familiarity",
      }
    );
    expect(addError).toBeNull();
    const { data: newSectionRow } = await admin
      .from("sections")
      .select("sort_order")
      .eq("id", newSectionId as string)
      .single();
    expect(newSectionRow!.sort_order).toBe(2);

    const { error: updateError } = await adminTestClient.rpc(
      "admin_update_section",
      {
        p_section_id: newSectionId as string,
        p_title: "Updated title",
        p_prompt: "Updated prompt",
        p_scale_key: "agreement",
      }
    );
    expect(updateError).toBeNull();
    const { data: updatedSection } = await admin
      .from("sections")
      .select("title, prompt, scale_key")
      .eq("id", newSectionId as string)
      .single();
    expect(updatedSection).toEqual({
      title: "Updated title",
      prompt: "Updated prompt",
      scale_key: "agreement",
    });

    const { error: reorderError } = await adminTestClient.rpc(
      "admin_reorder_sections",
      {
        p_round_id: round.roundId,
        p_section_ids: [newSectionId as string, round.sectionId],
      }
    );
    expect(reorderError).toBeNull();
    const { data: reorderedSections } = await admin
      .from("sections")
      .select("id, sort_order")
      .eq("round_id", round.roundId);
    const byId = new Map(
      (reorderedSections ?? []).map((s) => [s.id as string, s.sort_order as number])
    );
    expect(byId.get(newSectionId as string)).toBe(1);
    expect(byId.get(round.sectionId)).toBe(2);

    const { error: invalidReorderError } = await adminTestClient.rpc(
      "admin_reorder_sections",
      {
        p_round_id: round.roundId,
        p_section_ids: [newSectionId as string],
      }
    );
    expect(invalidReorderError).toBeTruthy();
    expect((invalidReorderError as { hint: string }).hint).toBe(
      "invalid_order"
    );

    // Deleting the original section cascades its statements.
    const { error: deleteError } = await adminTestClient.rpc(
      "admin_delete_section",
      { p_section_id: round.sectionId }
    );
    expect(deleteError).toBeNull();
    const { data: orphanStatements } = await admin
      .from("statements")
      .select("id")
      .eq("section_id", round.sectionId);
    expect(orphanStatements ?? []).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // Lock: every content RPC refuses on a closed/opened round (RND-03)
  // -------------------------------------------------------------------

  test("lock: every content RPC, a direct admin write, and a service-role write are refused on a closed round", async () => {
    const closedFixture = await createTestRound({ window: "closed" });
    fixtureRoundIds.push(closedFixture.roundId);
    const admin = adminClient();

    const rpcCalls: Array<[string, Record<string, unknown>]> = [
      [
        "admin_add_statement",
        { p_section_id: closedFixture.sectionId, p_text: "x" },
      ],
      [
        "admin_update_statement",
        { p_statement_id: closedFixture.statementIds[0], p_text: "x" },
      ],
      [
        "admin_delete_statement",
        { p_statement_id: closedFixture.statementIds[0] },
      ],
      [
        "admin_reorder_statements",
        {
          p_section_id: closedFixture.sectionId,
          p_statement_ids: closedFixture.statementIds,
        },
      ],
      [
        "admin_add_section",
        {
          p_round_id: closedFixture.roundId,
          p_title: "t",
          p_prompt: "p",
          p_scale_key: "agreement",
        },
      ],
      [
        "admin_update_section",
        {
          p_section_id: closedFixture.sectionId,
          p_title: "t",
          p_prompt: "p",
          p_scale_key: "agreement",
        },
      ],
      ["admin_delete_section", { p_section_id: closedFixture.sectionId }],
      [
        "admin_reorder_sections",
        {
          p_round_id: closedFixture.roundId,
          p_section_ids: [closedFixture.sectionId],
        },
      ],
    ];

    for (const [fn, args] of rpcCalls) {
      const { error } = await adminTestClient.rpc(fn, args);
      expect(error, `${fn} should be refused on a closed round`).toBeTruthy();
      expect((error as { hint: string }).hint).toBe("round_locked");
    }

    // A direct admin insert errors (RLS refuses); direct update/delete
    // affect zero rows (RLS filters them out, no exception).
    const { error: directInsertError } = await adminTestClient
      .from("statements")
      .insert({
        round_id: closedFixture.roundId,
        section_id: closedFixture.sectionId,
        sort_order: 999,
        key: "r999999_99",
        text: "nope",
      });
    expect(directInsertError).toBeTruthy();

    const { data: directUpdateRows, error: directUpdateError } =
      await adminTestClient
        .from("statements")
        .update({ text: "nope" })
        .eq("id", closedFixture.statementIds[0])
        .select();
    if (directUpdateError) {
      expect(directUpdateError).toBeTruthy();
    } else {
      expect(directUpdateRows ?? []).toHaveLength(0);
    }

    const { data: directDeleteRows, error: directDeleteError } =
      await adminTestClient
        .from("statements")
        .delete()
        .eq("id", closedFixture.statementIds[0])
        .select();
    if (directDeleteError) {
      expect(directDeleteError).toBeTruthy();
    } else {
      expect(directDeleteRows ?? []).toHaveLength(0);
    }

    const { data: unchangedStatement } = await admin
      .from("statements")
      .select("text")
      .eq("id", closedFixture.statementIds[0])
      .single();
    expect(unchangedStatement!.text).not.toBe("nope");

    // A service-role insert of a statement into the closed fixture also
    // errors with round_locked — the trigger fires for every role.
    const { error: serviceInsertError } = await admin.from("statements").insert({
      round_id: closedFixture.roundId,
      section_id: closedFixture.sectionId,
      sort_order: 1000,
      key: "r999999_98",
      text: "nope",
    });
    expect(serviceInsertError).toBeTruthy();
    expect((serviceInsertError as { hint: string }).hint).toBe("round_locked");

    // A no-op update of a Round 1 statement (same text) is refused too.
    const { data: round1 } = await admin
      .from("rounds")
      .select("id")
      .eq("round_number", 1)
      .single();
    const { data: round1Statement } = await admin
      .from("statements")
      .select("id, text")
      .eq("round_id", round1!.id as string)
      .limit(1)
      .single();
    const { data: noopRows, error: noopError } = await adminTestClient
      .from("statements")
      .update({ text: round1Statement!.text as string })
      .eq("id", round1Statement!.id as string)
      .select();
    if (noopError) {
      expect(noopError).toBeTruthy();
    } else {
      expect(noopRows ?? []).toHaveLength(0);
    }
  });

  // -------------------------------------------------------------------
  // Non-admin refusals
  // -------------------------------------------------------------------

  test("non-admin: participant and anon are refused by every content RPC and admin_create_round", async () => {
    const round = await createTestRound({ window: "draft" });
    fixtureRoundIds.push(round.roundId);
    const anon = anonClient();

    for (const client of [participantClient, anon]) {
      const { error: createError } = await client.rpc("admin_create_round", {
        p_title: null,
      });
      expect(createError).toBeTruthy();

      const { error: addError } = await client.rpc("admin_add_statement", {
        p_section_id: round.sectionId,
        p_text: "nope",
      });
      expect(addError).toBeTruthy();

      const { error: updateSectionError } = await client.rpc(
        "admin_update_section",
        {
          p_section_id: round.sectionId,
          p_title: "nope",
          p_prompt: "nope",
          p_scale_key: "agreement",
        }
      );
      expect(updateSectionError).toBeTruthy();

      const { error: reorderError } = await client.rpc(
        "admin_reorder_sections",
        {
          p_round_id: round.roundId,
          p_section_ids: [round.sectionId],
        }
      );
      expect(reorderError).toBeTruthy();
    }

    const admin = adminClient();
    const { data: sectionRow } = await admin
      .from("sections")
      .select("title")
      .eq("id", round.sectionId)
      .single();
    expect(sectionRow!.title).not.toBe("nope");
  });
});
