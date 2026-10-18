"use server";

import { createClient } from "@/lib/supabase/server";
import { RESULTS_CONSENT_VERSION } from "@/lib/survey/messages";

export type ConsentActionResult = { ok: true } | { ok: false; error: string };

/**
 * Opts the signed-in participant in to having their questionnaires
 * securely saved and returned. Upserts the caller's own results_consent
 * row (RLS: user_id = auth.uid()) with the current wording version. Never
 * sends a timestamp — the results_consent_before_write trigger stamps
 * consented_at from the DB clock. Logs only the step name and error
 * code/message on failure (PRIV-02).
 */
export async function optInToResults(): Promise<ConsentActionResult> {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) {
    return { ok: false, error: "not-authenticated" };
  }

  const { error } = await supabase
    .from("results_consent")
    .upsert(
      { user_id: userId, consented: true, consent_text_version: RESULTS_CONSENT_VERSION },
      { onConflict: "user_id" }
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
 * false). Zero rows updated (no prior row) still counts as ok — there's
 * nothing to withdraw from, which is an equivalent end state. Never sends
 * a timestamp — the trigger stamps withdrawn_at from the DB clock. Logs
 * only the step name and error code/message on failure (PRIV-02).
 */
export async function withdrawResultsConsent(): Promise<ConsentActionResult> {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) {
    return { ok: false, error: "not-authenticated" };
  }

  const { error } = await supabase
    .from("results_consent")
    .update({ consented: false })
    .eq("user_id", userId);

  if (error) {
    console.error("withdrawResultsConsent: update failed", {
      code: error.code,
      message: error.message,
    });
    return { ok: false, error: error.code ?? "failed" };
  }

  return { ok: true };
}
