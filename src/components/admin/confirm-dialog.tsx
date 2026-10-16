"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";
import type { AdminActionResult } from "@/lib/admin/content-actions";

/**
 * The only confirmation mechanism in this phase — reserved strictly for
 * destructive actions (close round, delete section/statement, remove
 * admin/domain). Every other action commits immediately with no modal.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: {
    label: string;
    icon?: ReactNode;
    variant?: "destructive" | "outline" | "default";
    disabled?: boolean;
  };
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<AdminActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setError(null);
        }
      }}
    >
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant={trigger.variant ?? "outline"}
            aria-label={trigger.label}
            disabled={trigger.disabled}
            size={trigger.icon ? "icon" : "default"}
            className={trigger.icon ? "size-11" : undefined}
          />
        }
      >
        {trigger.icon ?? trigger.label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
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
                const result = await onConfirm();
                if (result.ok) {
                  setOpen(false);
                } else {
                  setError(result.error);
                }
              });
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
