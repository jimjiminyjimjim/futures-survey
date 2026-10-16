"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { closeRoundEarly } from "@/lib/admin/round-actions";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";
import { PRESENTATION_MESSAGES } from "@/lib/presentation/messages";
import { canPresent } from "@/lib/presentation/chart-math";
import type { RoundStatus } from "@/lib/admin/rounds-queries";

/**
 * Per-row "..." actions menu on the rounds dashboard (replaces the old
 * always-visible "Present results" button). View always navigates to the
 * round page; Present results only shows when canPresent(status); Close
 * round only shows for an open round and sits behind a confirmation.
 *
 * The confirmation AlertDialog is rendered as a sibling of the
 * DropdownMenu (not nested inside DropdownMenuContent) and its `open`
 * state lives in this component, not the menu's own open state — so
 * closing the menu (which always happens when a menu item is clicked)
 * never unmounts the dialog that the "Close round" item just opened.
 */
export function RoundActionsMenu({
  roundId,
  roundTitle,
  status,
}: {
  roundId: string;
  roundTitle: string;
  status: RoundStatus;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={ADMIN_MESSAGES.actionsFor(roundTitle)}
              className="size-11"
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem render={<Link href={`/admin/rounds/${roundId}`} />}>
            {ADMIN_MESSAGES.viewRound}
          </DropdownMenuItem>
          {canPresent(status) ? (
            <DropdownMenuItem
              render={
                <Link
                  href={`/admin/rounds/${roundId}/present`}
                  prefetch={false}
                />
              }
            >
              {PRESENTATION_MESSAGES.presentResults}
            </DropdownMenuItem>
          ) : null}
          {status === "open" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  setError(null);
                  setConfirmOpen(true);
                }}
              >
                {ADMIN_MESSAGES.closeRoundConfirm}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(nextOpen) => {
          setConfirmOpen(nextOpen);
          if (nextOpen) {
            setError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ADMIN_MESSAGES.closeRoundTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {ADMIN_MESSAGES.closeRoundBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>
              {ADMIN_MESSAGES.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await closeRoundEarly({ roundId });
                  if (result.ok) {
                    setConfirmOpen(false);
                  } else {
                    setError(result.error);
                  }
                });
              }}
            >
              {ADMIN_MESSAGES.closeRoundConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
