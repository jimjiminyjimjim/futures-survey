"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { addSampleAnswers, clearTestAnswers } from "@/lib/admin/test-actions";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";

/**
 * Admin test mode controls for an unopened draft (quick task 261117-it4).
 * "Add sample answers" commits immediately: it replaces the previous sample
 * set with the same deterministic one, so pressing it twice changes
 * nothing. "Clear test answers" deletes every answer on the draft, so it
 * confirms first. The database refuses both for any round with a date.
 */
export function RoundTestActions({ roundId }: { roundId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-start gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                const result = await addSampleAnswers({ roundId });
                if (!result.ok) {
                  setError(result.error);
                }
              } catch {
                setError(ADMIN_MESSAGES.testActionFailed);
              }
            });
          }}
        >
          {ADMIN_MESSAGES.testAddSamplesCta}
        </Button>
        <ConfirmDialog
          trigger={{
            label: ADMIN_MESSAGES.testClearCta,
            variant: "destructive",
            disabled: isPending,
          }}
          title={ADMIN_MESSAGES.testClearTitle}
          description={ADMIN_MESSAGES.testClearBody}
          confirmLabel={ADMIN_MESSAGES.testClearConfirm}
          onConfirm={() => clearTestAnswers({ roundId })}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
