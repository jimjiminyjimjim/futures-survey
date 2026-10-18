"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { createSurvey, type CreateSurveyState } from "@/lib/admin/round-actions";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {ADMIN_MESSAGES.createSurvey}
    </Button>
  );
}

const initialState: CreateSurveyState = { error: null };

/**
 * "Create new survey" (surveys v2 part B, replaces the old "Create new
 * round"): creates a whole new survey with its 3 draft sessions, copying
 * the latest survey's content. Stays on the dashboard on success.
 */
export function CreateSurveyButton() {
  const [state, formAction] = useActionState(createSurvey, initialState);

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
