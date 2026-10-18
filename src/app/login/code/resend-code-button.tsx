"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { resendCode, type ResendState } from "@/lib/auth/actions";

const COOLDOWN_SECONDS = 60;
const initialState: ResendState = { error: null, sentAt: null };

/** "Resend code" with a 60s cooldown (matches Supabase's max_frequency). */
export function ResendCodeButton() {
  const [state, formAction, pending] = useActionState(resendCode, initialState);
  // The page is only shown right after a code was sent, so start cooling down.
  const [pageReadyAt] = useState(() => Date.now() + COOLDOWN_SECONDS * 1000);
  const [now, setNow] = useState(() => Date.now());
  const readyAt = state.sentAt
    ? state.sentAt + COOLDOWN_SECONDS * 1000
    : pageReadyAt;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = Math.max(0, Math.ceil((readyAt - now) / 1000));

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button
        type="submit"
        variant="outline"
        disabled={pending || secondsLeft > 0}
      >
        {pending
          ? "Sending…"
          : secondsLeft > 0
            ? `Resend code (${secondsLeft}s)`
            : "Resend code"}
      </Button>
      <p aria-live="polite" className="text-sm">
        {state.error ? (
          <span role="alert" className="text-destructive">
            {state.error}
          </span>
        ) : state.sentAt ? (
          <span className="text-muted-foreground">
            A new code is on its way. Use the newest one.
          </span>
        ) : null}
      </p>
    </form>
  );
}
