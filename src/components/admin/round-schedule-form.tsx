"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateRoundSchedule,
  type UpdateScheduleState,
} from "@/lib/admin/round-actions";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";
import type { RoundStatus } from "@/lib/admin/rounds-queries";

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {ADMIN_MESSAGES.save}
    </Button>
  );
}

const initialState: UpdateScheduleState = { error: null, saved: false };

/**
 * The round title/open/close schedule form (RND-02). The server passes
 * opens/closesInputValue (toAdminDateTimeInputValue of the stored iso), so
 * there is no hydration mismatch — the UK wall-time conversion runs only
 * on the server at render time and only on the server again inside
 * updateRoundSchedule on submit. Keyed on the saved values so a successful
 * save (which revalidates this page) remounts the form with fresh
 * defaults instead of leaving stale uncontrolled input values behind.
 */
export function RoundScheduleForm({
  roundId,
  title,
  opensAtIso,
  closesAtIso,
  opensInputValue,
  closesInputValue,
  status,
}: {
  roundId: string;
  title: string;
  opensAtIso: string | null;
  closesAtIso: string | null;
  opensInputValue: string;
  closesInputValue: string;
  status: RoundStatus;
}) {
  const [state, formAction] = useActionState(
    updateRoundSchedule,
    initialState
  );
  const opensLocked = status === "open";

  return (
    <form
      key={`${title}:${opensAtIso}:${closesAtIso}`}
      data-slot="schedule-form"
      action={formAction}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="roundId" value={roundId} />
      <input
        type="hidden"
        name="currentOpensAtIso"
        value={opensAtIso ?? ""}
      />
      <input
        type="hidden"
        name="currentClosesAtIso"
        value={closesAtIso ?? ""}
      />
      <input
        type="hidden"
        name="opensLocked"
        value={opensLocked ? "true" : "false"}
      />

      <div className="flex flex-col gap-1">
        <Label htmlFor="round-title">{ADMIN_MESSAGES.roundTitleLabel}</Label>
        <Input id="round-title" name="title" defaultValue={title} />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="round-opens-at">{ADMIN_MESSAGES.opensLabel}</Label>
        <Input
          id="round-opens-at"
          name="opensAt"
          type="datetime-local"
          defaultValue={opensInputValue}
          disabled={opensLocked}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="round-closes-at">{ADMIN_MESSAGES.closesLabel}</Label>
        <Input
          id="round-closes-at"
          name="closesAt"
          type="datetime-local"
          defaultValue={closesInputValue}
        />
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {ADMIN_MESSAGES.scheduleHelp}
      </p>

      <div>
        <SaveButton />
      </div>

      {state.saved ? (
        <p role="status" className="text-sm">
          {ADMIN_MESSAGES.scheduleSaved}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
