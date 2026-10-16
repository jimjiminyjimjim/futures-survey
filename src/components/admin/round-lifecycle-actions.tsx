"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { openRoundNow, closeRoundEarly } from "@/lib/admin/round-actions";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";
import type { RoundStatus } from "@/lib/admin/rounds-queries";

/**
 * Open now / Close early (RND-06). Open now commits immediately (no
 * dialog — only destructive actions confirm, per UI-SPEC); Close early
 * sits behind a confirmation. Renders nothing once a round has closed.
 */
export function RoundLifecycleActions({
  roundId,
  status,
}: {
  roundId: string;
  status: RoundStatus;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (status === "closed") {
    return null;
  }

  if (status === "draft" || status === "scheduled") {
    return (
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await openRoundNow({ roundId });
              if (!result.ok) {
                setError(result.error);
              }
            });
          }}
        >
          {ADMIN_MESSAGES.openNow}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  // status === "open"
  return (
    <div className="flex flex-col gap-1">
      <ConfirmDialog
        trigger={{
          label: ADMIN_MESSAGES.closeEarly,
          variant: "destructive",
          disabled: isPending,
        }}
        title={ADMIN_MESSAGES.closeRoundTitle}
        description={ADMIN_MESSAGES.closeRoundBody}
        confirmLabel={ADMIN_MESSAGES.closeRoundConfirm}
        onConfirm={() => closeRoundEarly({ roundId })}
      />
    </div>
  );
}
