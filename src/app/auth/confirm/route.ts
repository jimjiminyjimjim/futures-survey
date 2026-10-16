import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

// Route Handlers under cacheComponents must not export dynamic/revalidate/
// fetchCache/instant (build error); reading cookies via createClient already
// makes this handler dynamic. Cache-Control replaces the dynamic export.

// Only ever redirect to a relative, same-origin path — never follow an
// absolute/protocol-relative `next` value (open-redirect guard).
function safeNext(nextParam: string | null): string {
  if (!nextParam) {
    return "/";
  }
  if (!nextParam.startsWith("/") || nextParam.startsWith("//")) {
    return "/";
  }
  return nextParam;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  const supabase = await createClient();

  let verified = false;

  if (code) {
    // PKCE flow (Supabase's default confirmation-link format).
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    verified = !error;
  } else if (tokenHash && type) {
    // Implicit/token-hash flow (magiclink / recovery / signup links).
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    verified = !error;
  }

  const redirectUrl = verified
    ? new URL(next, origin)
    : new URL("/login?error=link", origin);

  const response = NextResponse.redirect(redirectUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
