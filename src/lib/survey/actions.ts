"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

export type SaveAnswerResult =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid" | "not-open" | "submitted" | "failed";
      error: string;
    };

const SaveAnswerInputSchema = z.object({
  statementId: z.string().uuid(),
  value: z.number().int().min(1).max(10),
});

/**
 * Autosaves one answer under the signed-in participant's own RLS. Never
 * sends user_id or submitted_at — those are the DB's job (auth.uid()
 * default, and the responses_before_write/answers_before_write triggers).
 * Logs only the step name and error code/message on failure — never the
 * answer value, statement text, or email (PRIV-02).
 */
export async function saveAnswer(input: {
  statementId: string;
  value: number;
}): Promise<SaveAnswerResult> {
  const parsed = SaveAnswerInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalid", error: SURVEY_MESSAGES.saveFailed };
  }
  const { statementId, value } = parsed.data;

  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) {
    return { ok: false, reason: "failed", error: SURVEY_MESSAGES.saveFailed };
  }

  const { data: openRoundId, error: openRoundError } = await supabase.rpc(
    "current_open_round_id"
  );
  if (openRoundError) {
    console.error("saveAnswer: current_open_round_id failed", {
      code: openRoundError.code,
      message: openRoundError.message,
    });
    return { ok: false, reason: "failed", error: SURVEY_MESSAGES.saveFailed };
  }
  if (!openRoundId) {
    return { ok: false, reason: "not-open", error: SURVEY_MESSAGES.saveFailed };
  }

  const { data: statement, error: statementError } = await supabase
    .from("statements")
    .select("id, round_id")
    .eq("id", statementId)
    .eq("round_id", openRoundId)
    .maybeSingle();
  if (statementError) {
    console.error("saveAnswer: load statement failed", {
      code: statementError.code,
      message: statementError.message,
    });
    return { ok: false, reason: "failed", error: SURVEY_MESSAGES.saveFailed };
  }
  if (!statement) {
    return { ok: false, reason: "invalid", error: SURVEY_MESSAGES.saveFailed };
  }

  // Create-on-first-answer: safe for two parallel first-answer saves
  // because this upsert ignores a conflicting (round_id, user_id) row
  // rather than racing an insert-then-select.
  const { error: ensureResponseError } = await supabase
    .from("responses")
    .upsert({ round_id: openRoundId }, {
      onConflict: "round_id,user_id",
      ignoreDuplicates: true,
    });
  if (ensureResponseError) {
    console.error("saveAnswer: ensure response failed", {
      code: ensureResponseError.code,
      message: ensureResponseError.message,
    });
    return { ok: false, reason: "failed", error: SURVEY_MESSAGES.saveFailed };
  }

  const { data: response, error: responseError } = await supabase
    .from("responses")
    .select("id, submitted_at")
    .eq("round_id", openRoundId)
    .eq("user_id", userId)
    .maybeSingle();
  if (responseError) {
    console.error("saveAnswer: load response failed", {
      code: responseError.code,
      message: responseError.message,
    });
    return { ok: false, reason: "failed", error: SURVEY_MESSAGES.saveFailed };
  }
  if (!response) {
    return { ok: false, reason: "failed", error: SURVEY_MESSAGES.saveFailed };
  }
  if (response.submitted_at) {
    return {
      ok: false,
      reason: "submitted",
      error: SURVEY_MESSAGES.alreadySubmitted,
    };
  }

  const { data: upserted, error: upsertError } = await supabase
    .from("answers")
    .upsert(
      {
        response_id: response.id,
        round_id: openRoundId,
        statement_id: statementId,
        value,
      },
      { onConflict: "response_id,statement_id" }
    )
    .select("id");

  if (upsertError || !upserted || upserted.length === 0) {
    if (upsertError) {
      console.error("saveAnswer: upsert answer failed", {
        code: upsertError.code,
        message: upsertError.message,
      });
    }

    const { data: recheckedResponse } = await supabase
      .from("responses")
      .select("submitted_at")
      .eq("id", response.id)
      .maybeSingle();

    if (recheckedResponse?.submitted_at) {
      return {
        ok: false,
        reason: "submitted",
        error: SURVEY_MESSAGES.alreadySubmitted,
      };
    }
    return { ok: false, reason: "failed", error: SURVEY_MESSAGES.saveFailed };
  }

  return { ok: true };
}

export type SubmitResult =
  | { ok: true }
  | {
      ok: false;
      reason: "incomplete" | "submitted" | "not-open" | "failed";
      error: string;
    };

/**
 * Submits the signed-in participant's own response for the open round,
 * exactly once. Never creates a response row here — an incomplete submit
 * is rejected without writing anything. The actual submitted_at value sent
 * is irrelevant: the responses_before_write trigger stamps the DB clock
 * and ignores any client-supplied timestamp (SURV-07). Logs only the step
 * name and error code/message on failure — never the answer values or
 * email (PRIV-02).
 */
export async function submitResponse(): Promise<SubmitResult> {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) {
    return { ok: false, reason: "failed", error: SURVEY_MESSAGES.submitFailed };
  }

  const { data: openRoundId, error: openRoundError } = await supabase.rpc(
    "current_open_round_id"
  );
  if (openRoundError) {
    console.error("submitResponse: current_open_round_id failed", {
      code: openRoundError.code,
      message: openRoundError.message,
    });
    return { ok: false, reason: "failed", error: SURVEY_MESSAGES.submitFailed };
  }
  if (!openRoundId) {
    return {
      ok: false,
      reason: "not-open",
      error: SURVEY_MESSAGES.noRoundHeading,
    };
  }

  const [totalResult, responseResult] = await Promise.all([
    supabase
      .from("statements")
      .select("id", { count: "exact", head: true })
      .eq("round_id", openRoundId),
    supabase
      .from("responses")
      .select("id, submitted_at")
      .eq("round_id", openRoundId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (totalResult.error) {
    console.error("submitResponse: count statements failed", {
      code: totalResult.error.code,
      message: totalResult.error.message,
    });
    return { ok: false, reason: "failed", error: SURVEY_MESSAGES.submitFailed };
  }
  const total = totalResult.count ?? 0;
  if (total === 0) {
    return {
      ok: false,
      reason: "not-open",
      error: SURVEY_MESSAGES.noRoundHeading,
    };
  }

  if (responseResult.error) {
    console.error("submitResponse: load response failed", {
      code: responseResult.error.code,
      message: responseResult.error.message,
    });
    return { ok: false, reason: "failed", error: SURVEY_MESSAGES.submitFailed };
  }
  const response = responseResult.data;

  if (response?.submitted_at) {
    return {
      ok: false,
      reason: "submitted",
      error: SURVEY_MESSAGES.alreadySubmitted,
    };
  }

  async function countAnswered(responseId: string): Promise<number | null> {
    const { count, error } = await supabase
      .from("answers")
      .select("id", { count: "exact", head: true })
      .eq("response_id", responseId);
    if (error) {
      console.error("submitResponse: count answers failed", {
        code: error.code,
        message: error.message,
      });
      return null;
    }
    return count ?? 0;
  }

  let answered = 0;
  if (response) {
    const counted = await countAnswered(response.id);
    if (counted === null) {
      return { ok: false, reason: "failed", error: SURVEY_MESSAGES.submitFailed };
    }
    answered = counted;
  }

  const remaining = total - answered;
  if (remaining > 0) {
    return {
      ok: false,
      reason: "incomplete",
      error: SURVEY_MESSAGES.incompleteSubmit(remaining),
    };
  }

  // remaining <= 0 with answered > 0 implies a response row exists (if
  // there were no response, answered would be 0 and total > 0 would have
  // already returned "incomplete" above).
  const responseId = response!.id;

  const { data: updated, error: updateError } = await supabase
    .from("responses")
    .update({ submitted_at: new Date().toISOString() })
    .eq("id", responseId)
    .is("submitted_at", null)
    .select("id");

  if (updateError || !updated || updated.length === 0) {
    if (updateError) {
      console.error("submitResponse: update failed", {
        code: updateError.code,
        message: updateError.message,
      });
    }

    const { data: recheckedResponse } = await supabase
      .from("responses")
      .select("submitted_at")
      .eq("id", responseId)
      .maybeSingle();

    if (recheckedResponse?.submitted_at) {
      return {
        ok: false,
        reason: "submitted",
        error: SURVEY_MESSAGES.alreadySubmitted,
      };
    }

    // responses_before_write (supabase/migrations/20261015000300_survey_responses.sql)
    // raises errcode 23514 for every guard it enforces on this trigger
    // (identity-column change, already-submitted re-touch, and this
    // incomplete-submit case) — there is no more specific/distinctive
    // errcode it raises. The already-submitted case is already
    // disambiguated above via recheckedResponse?.submitted_at, and the
    // identity-column guard cannot fire here (this update only ever sets
    // submitted_at), so narrowing on 23514 at this point is safe. Message
    // text is kept only as a secondary guard in case a future 23514 from
    // this trigger is NOT the incomplete-submit case.
    if (
      updateError?.code === "23514" &&
      updateError?.message?.startsWith("Cannot submit")
    ) {
      const recounted = await countAnswered(responseId);
      const recountedRemaining = total - (recounted ?? 0);
      return {
        ok: false,
        reason: "incomplete",
        error: SURVEY_MESSAGES.incompleteSubmit(recountedRemaining),
      };
    }

    return { ok: false, reason: "failed", error: SURVEY_MESSAGES.submitFailed };
  }

  return { ok: true };
}
