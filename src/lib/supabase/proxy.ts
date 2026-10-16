import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseEnv } from "@/lib/supabase/env";

const COPIED_HEADERS = ["cache-control", "expires", "pragma"] as const;

function isLoginPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/");
}

// /auth/confirm is the email-link landing route: a signed-out visitor must
// be able to reach it (that's the whole point — they're not signed in yet),
// so it needs the same bypass as /login/**.
function isAuthConfirmPath(pathname: string): boolean {
  return pathname === "/auth/confirm";
}

// Injectable so tests can stub the Supabase client without touching the
// live project — defaults to the real `createServerClient` in production.
type CreateServerClientFn = typeof createServerClient;

export async function updateSession(
  request: NextRequest,
  createClient: CreateServerClientFn = createServerClient
): Promise<NextResponse> {
  const { url, publishableKey } = readSupabaseEnv({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  let response = NextResponse.next({ request });

  const supabase = createClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      // @supabase/ssr calls setAll(cookiesToSet, headers) on a token
      // refresh — `headers` carries the no-cache Cache-Control/Expires/Pragma
      // triplet that must land on `response` so the COPIED_HEADERS logic
      // below has something real to copy onto a same-request redirect.
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        }
      },
    },
  });

  // No code may run between createServerClient and getClaims(): the proxy
  // relies on the auth lib's own setAll call above having already recreated
  // `response` from the (possibly refreshed) request cookies.
  const { data } = await supabase.auth.getClaims();

  if (
    !data?.claims &&
    !isLoginPath(request.nextUrl.pathname) &&
    !isAuthConfirmPath(request.nextUrl.pathname)
  ) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";

    const redirectResponse = NextResponse.redirect(redirectUrl);

    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }

    for (const header of COPIED_HEADERS) {
      const value = response.headers.get(header);
      if (value !== null) {
        redirectResponse.headers.set(header, value);
      }
    }

    return redirectResponse;
  }

  return response;
}
