"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth/session";
import { ADMIN_MESSAGES, adminErrorMessage } from "@/lib/admin/messages";
import {
  parseAdminDateTimeInput,
  toAdminDateTimeInputValue,
} from "@/lib/admin/datetime";
import type { AdminActionResult } from "@/lib/admin/content-actions";

export type CreateSurveyState = { error: string | null };

/**
 * Creates a brand-new survey with 3 draft sessions, key-preserving-copying
 * the latest survey's sections/statements (public.admin_create_survey,
 * surveys v2 part B). Stays on the dashboard — `refresh()` picks up the new
 * survey at the top of the list. Logs only the RPC name and error code on
 * failure — never any content.
 */
export async function createSurvey(
  _prev: CreateSurveyState,
  _formData: FormData
): Promise<CreateSurveyState> {
  if (!(await isCurrentUserAdmin())) {
    return { error: ADMIN_MESSAGES.createSurveyFailed };
  }

  const supabase = await createClient();
  const { data: newSurveyId, error } = await supabase.rpc(
    "admin_create_survey",
    { p_title: null }
  );

  if (error || !newSurveyId) {
    console.error("admin_create_survey", error?.code);
    return { error: ADMIN_MESSAGES.createSurveyFailed };
  }

  refresh();
  return { error: null };
}

export type UpdateScheduleState = { error: string | null; saved: boolean };

const RoundIdSchema = z.uuid();

const RoundTitleSchema = z
  .string()
  .trim()
  .min(1, ADMIN_MESSAGES.roundTitleBlank)
  .max(120, ADMIN_MESSAGES.roundTitleTooLong);

/**
 * Resolves one date field's p_* value for admin_update_round: an
 * unchanged input (matching the current stored value's own UK wall-time
 * rendering) resubmits the exact stored instant verbatim — never a
 * re-parsed, potentially sub-minute-drifted value (RND-02 precision
 * edge). Only a genuinely edited input is parsed.
 */
function resolveDateField(
  inputValue: string,
  currentIso: string | null
): { ok: true; iso: string | null } | { ok: false; reason: "invalid" | "nonexistent" } {
  if (inputValue === toAdminDateTimeInputValue(currentIso)) {
    return { ok: true, iso: currentIso };
  }
  return parseAdminDateTimeInput(inputValue);
}

/**
 * Edits a round's title/open/close dates (RND-02, public.admin_update_round).
 * No date comparison ever happens in TypeScript — ordering, past/future and
 * overlap are all decided by the database; this function only resolves
 * "unchanged vs. edited" for each field before handing both off as-is.
 */
export async function updateRoundSchedule(
  _prev: UpdateScheduleState,
  formData: FormData
): Promise<UpdateScheduleState> {
  const roundIdResult = RoundIdSchema.safeParse(formData.get("roundId"));
  if (!roundIdResult.success) {
    return { error: ADMIN_MESSAGES.saveFailed, saved: false };
  }

  const titleResult = RoundTitleSchema.safeParse(formData.get("title"));
  if (!titleResult.success) {
    return {
      error: titleResult.error.issues[0]?.message ?? ADMIN_MESSAGES.saveFailed,
      saved: false,
    };
  }

  const opensLocked = formData.get("opensLocked") === "true";
  const currentOpensAtIso =
    (formData.get("currentOpensAtIso") as string | null) || null;
  const currentClosesAtIso =
    (formData.get("currentClosesAtIso") as string | null) || null;
  const opensAtInput = (formData.get("opensAt") as string | null) ?? "";
  const closesAtInput = (formData.get("closesAt") as string | null) ?? "";

  let pOpensAt: string | null;
  if (opensLocked) {
    pOpensAt = currentOpensAtIso;
  } else {
    const resolved = resolveDateField(opensAtInput, currentOpensAtIso);
    if (!resolved.ok) {
      return {
        error:
          resolved.reason === "invalid"
            ? ADMIN_MESSAGES.dateInvalid
            : ADMIN_MESSAGES.dateNonexistent,
        saved: false,
      };
    }
    pOpensAt = resolved.iso;
  }

  const resolvedCloses = resolveDateField(closesAtInput, currentClosesAtIso);
  if (!resolvedCloses.ok) {
    return {
      error:
        resolvedCloses.reason === "invalid"
          ? ADMIN_MESSAGES.dateInvalid
          : ADMIN_MESSAGES.dateNonexistent,
      saved: false,
    };
  }
  const pClosesAt = resolvedCloses.iso;

  if (!(await isCurrentUserAdmin())) {
    return { error: ADMIN_MESSAGES.saveFailed, saved: false };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_round", {
    p_round_id: roundIdResult.data,
    p_title: titleResult.data,
    p_opens_at: pOpensAt,
    p_closes_at: pClosesAt,
  });

  if (error) {
    console.error("admin_update_round", { code: error.code, hint: error.hint });
    return { error: adminErrorMessage(error), saved: false };
  }

  refresh();
  return { error: null, saved: true };
}

const RoundActionInputSchema = z.object({ roundId: z.uuid() });

/**
 * Opens a round now (RND-06, public.admin_open_round). No time ever comes
 * from the browser — the database stamps its own now().
 */
export async function openRoundNow(input: {
  roundId: string;
}): Promise<AdminActionResult> {
  const parsed = RoundActionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: ADMIN_MESSAGES.saveFailed };
  }

  if (!(await isCurrentUserAdmin())) {
    return { ok: false, error: ADMIN_MESSAGES.saveFailed };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_open_round", {
    p_round_id: parsed.data.roundId,
  });

  if (error) {
    console.error("admin_open_round", { code: error.code, hint: error.hint });
    return { ok: false, error: adminErrorMessage(error) };
  }

  refresh();
  return { ok: true };
}

/**
 * Closes an open round early (RND-06, public.admin_close_round). No time
 * ever comes from the browser — the database stamps its own now().
 */
export async function closeRoundEarly(input: {
  roundId: string;
}): Promise<AdminActionResult> {
  const parsed = RoundActionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: ADMIN_MESSAGES.saveFailed };
  }

  if (!(await isCurrentUserAdmin())) {
    return { ok: false, error: ADMIN_MESSAGES.saveFailed };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_close_round", {
    p_round_id: parsed.data.roundId,
  });

  if (error) {
    console.error("admin_close_round", { code: error.code, hint: error.hint });
    return { ok: false, error: adminErrorMessage(error) };
  }

  refresh();
  return { ok: true };
}
