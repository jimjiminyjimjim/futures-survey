"use client";

import { useActionState, useRef } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { verifyCode, type AuthFormState } from "@/lib/auth/actions";

const initialState: AuthFormState = { error: null };
const CODE_LENGTH = 6;

export function VerifyCodeForm() {
  const [state, formAction, pending] = useActionState(
    verifyCode,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="code">6-digit code</Label>
        <InputOTP
          id="code"
          name="code"
          aria-label="6-digit code"
          maxLength={CODE_LENGTH}
          pattern={REGEXP_ONLY_DIGITS}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          disabled={pending}
          // Paste or one-time-code autofill fills all six at once; submit for them.
          onComplete={() => formRef.current?.requestSubmit()}
        >
          <InputOTPGroup>
            {Array.from({ length: CODE_LENGTH }, (_, i) => (
              <InputOTPSlot
                key={i}
                index={i}
                aria-invalid={state.error ? true : undefined}
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        Sign in
      </Button>
    </form>
  );
}
