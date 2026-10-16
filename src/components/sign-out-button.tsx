"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";

// signOut() never returns an error state (it always redirects or throws),
// so there's no useActionState here — but it's still a network round trip
// to Supabase Auth, so it needs the same disabled-while-pending treatment
// RequestCodeForm/VerifyCodeForm give their submit buttons: without it,
// nothing on screen signals the click registered until the redirect lands,
// which is both a double-submit risk and what made the e2e sign-out
// assertion racy against hydration/network timing.
function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="outline" disabled={pending}>
      Sign out
    </Button>
  );
}

export function SignOutButton() {
  return (
    <form action={signOut}>
      <SubmitButton />
    </form>
  );
}
