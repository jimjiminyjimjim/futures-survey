"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { createRound, type CreateRoundState } from "@/lib/admin/round-actions";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {ADMIN_MESSAGES.createRound}
    </Button>
  );
}

const initialState: CreateRoundState = { error: null };

export function CreateRoundButton() {
  const [state, formAction] = useActionState(createRound, initialState);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <SubmitButton />
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
