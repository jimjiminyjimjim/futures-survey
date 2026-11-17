"use server";

import { createClient } from "@/lib/supabase/server";
import { RESULTS_CONSENT_VERSION } from "@/lib/survey/messages";

export type ConsentActionResult = { ok: true } | { ok: false; error: string };

/**
 * Resolves the open round server-side. Consent is per session and the
 * client never supplies a round id, so a participant can only ever record
 * consent for the session that is open right now. Returns null when no
 * session is open or the lookup fails (logging only the step name and
 * error code/message — PRIV-02).
 */
async function resolveOpenRoundId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  step: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc("current_open_round_id");
  if (error) {
    console.error(`${step}: current_open_round_id failed`, {
      code: error.code,
      message: error.message,
    });
    return null;
  }
  return typeof data === "string" ? data : null;
}

/**
 * Opts the signed-in participant in to having their questionnaires
 * securely saved and returned, for the session that is open right now.
 * Upserts the caller's own results_consent_rounds row (RLS: user_id =
 * auth.uid() and round_id = the open round) with the current wording
 * version. Never sends a timestamp — the results_consent_rounds_before_write
 * trigger stamps consented_at from the DB clock. Session 1's legacy
 * results_consent table is never written. Logs only the step name and
 * error code/message on failure (PRIV-02).
 */
export async function optInToResults(): Promise<ConsentActionResult> {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) {
    return { ok: false, error: "not-authenticated" };
  }

  const roundId = await resolveOpenRoundId(supabase, "optInToResults");
  if (!roundId) {
    return { ok: false, error: "not-open" };
  }

  const { error } = await supabase.from("results_consent_rounds").upsert(
    {
      user_id: userId,
      round_id: roundId,
      consented: true,
      consent_text_version: RESULTS_CONSENT_VERSION,
    },
    { onConflict: "user_id,round_id" }
  );

  if (error) {
    console.error("optInToResults: upsert failed", {
      code: error.code,
      message: error.message,
    });
    return { ok: false, error: error.code ?? "failed" };
  }

  return { ok: true };
}

/**
 * Withdraws the signed-in participant's own consent (sets consented:
 * false) for the session that is open right now. Zero rows updated (no
 * prior row) still counts as ok — there's nothing to withdraw from, which
 * is an equivalent end state, and "do not save" therefore still creates no
 * row. Never sends a timestamp — the trigger stamps withdrawn_at from the
 * DB clock. Logs only the step name and error code/message on failure
 * (PRIV-02).
 */
export async function withdrawResultsConsent(): Promise<ConsentActionResult> {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) {
    return { ok: false, error: "not-authenticated" };
  }

  const roundId = await resolveOpenRoundId(supabase, "withdrawResultsConsent");
  if (!roundId) {
    return { ok: false, error: "not-open" };
  }

  const { error } = await supabase
    .from("results_consent_rounds")
    .update({ consented: false })
    .eq("user_id", userId)
    .eq("round_id", roundId);

  if (error) {
    console.error("withdrawResultsConsent: update failed", {
      code: error.code,
      message: error.message,
    });
    return { ok: false, error: error.code ?? "failed" };
  }

  return { ok: true };
}
