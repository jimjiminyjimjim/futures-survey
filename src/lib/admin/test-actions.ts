"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth/session";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";
import type { AdminActionResult } from "@/lib/admin/content-actions";

/**
 * Admin test mode for an unopened draft round (quick task 261117-it4).
 * Each action is admin-only here AND in the database (the admin_test_*
 * functions raise 42501 for non-admins and refuse any round that has an
 * open or close date). Logs only the RPC name and error code/hint — never
 * an email, a token or an answer value.
 */

const RoundActionInputSchema = z.object({ roundId: z.uuid() });

async function runTestRpc(
  input: { roundId: string },
  rpc: "admin_test_reset" | "admin_test_clear" | "admin_test_add_samples",
  extra: Record<string, number> = {}
): Promise<AdminActionResult> {
  const parsed = RoundActionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: ADMIN_MESSAGES.testActionFailed };
  }

  if (!(await isCurrentUserAdmin())) {
    return { ok: false, error: ADMIN_MESSAGES.testActionFailed };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc(rpc, {
    p_round_id: parsed.data.roundId,
    ...extra,
  });

  if (error) {
    console.error(rpc, { code: error.code, hint: error.hint });
    return { ok: false, error: ADMIN_MESSAGES.testActionFailed };
  }

  refresh();
  return { ok: true };
}

/** "Start again": deletes the admin's own test response on the draft. */
export async function resetMyTestAnswers(input: {
  roundId: string;
}): Promise<AdminActionResult> {
  return runTestRpc(input, "admin_test_reset");
}

/**
 * "Add sample answers": replaces the draft's sample answers with 20
 * submitted, deterministic responses that have no participant. Pressing it
 * again gives the same set; the admin's own test response is kept.
 */
export async function addSampleAnswers(input: {
  roundId: string;
}): Promise<AdminActionResult> {
  return runTestRpc(input, "admin_test_add_samples", { p_count: 20 });
}

/** "Clear test answers": deletes every response on the draft. */
export async function clearTestAnswers(input: {
  roundId: string;
}): Promise<AdminActionResult> {
  return runTestRpc(input, "admin_test_clear");
}
