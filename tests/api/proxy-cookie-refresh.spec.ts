import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import type { createServerClient } from "@supabase/ssr";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Held-out behavioral test for the 01-VERIFICATION.md backstop truth:
 *
 *   "src/proxy.ts's signed-out redirect copies every refreshed Supabase
 *   cookie and the cache/expires/pragma headers from the in-flight response
 *   onto the redirect"
 *
 * No test in the suite previously constructed a request that is
 * simultaneously (a) in need of a Supabase cookie refresh and (b) ends up
 * redirected to /login in the same pass — app-shell.spec.ts only exercises
 * the fully-signed-out (no cookies at all) case. This test forces exactly
 * that combination by injecting a stub Supabase client (via updateSession's
 * test-only `createClient` parameter) whose `getClaims()` calls the proxy's
 * own `cookies.setAll(cookiesToSet, headers)` — mirroring what
 * @supabase/ssr's `applyServerStorage` does on a real token refresh — and
 * then resolves with null claims, forcing the redirect branch.
 *
 * `@supabase/ssr`'s own type declaration documents this exact
 * `setAll(cookiesToSet, headers)` two-argument shape (see
 * node_modules/@supabase/ssr/dist/main/types.d.ts), and
 * `applyServerStorage` in node_modules/@supabase/ssr/dist/main/cookies.js
 * calls `setAll` with a second argument of
 * `{ "Cache-Control": "...", Expires: "0", Pragma: "no-cache" }` on every
 * real cookie write. This test reconstructs that contract rather than
 * inventing arbitrary header values.
 */

type FakeFactoryOptions = {
  cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[];
  headersToApply: Record<string, string>;
  claims: Record<string, unknown> | null;
};

function fakeCreateServerClient(
  opts: FakeFactoryOptions
): typeof createServerClient {
  function fakeFactory(
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          cookies: FakeFactoryOptions["cookiesToSet"],
          headers: Record<string, string>
        ) => void | Promise<void>;
      };
    }
  ) {
    return {
      auth: {
        async getClaims() {
          // Mirrors @supabase/ssr's applyServerStorage: a token refresh
          // calls setAll with both the refreshed cookies AND the no-cache
          // header triplet, in the same call, before claims resolve.
          await options.cookies.setAll(opts.cookiesToSet, opts.headersToApply);
          return { data: opts.claims ? { claims: opts.claims } : null };
        },
      },
    };
  }

  // This stub only implements the single method (`auth.getClaims`) that
  // `updateSession` actually calls, so its shape deliberately doesn't
  // overlap with the real `createServerClient` signature — cast through
  // `unknown` rather than suppressing the mismatch.
  return fakeFactory as unknown as typeof createServerClient;
}

const REFRESHED_ACCESS_TOKEN = "refreshed-access-token-value";
const REFRESHED_REFRESH_TOKEN = "refreshed-refresh-token-value";

const REFRESH_COOKIES: FakeFactoryOptions["cookiesToSet"] = [
  {
    name: "sb-access-token",
    value: REFRESHED_ACCESS_TOKEN,
    options: { path: "/", httpOnly: true, sameSite: "lax" },
  },
  {
    name: "sb-refresh-token",
    value: REFRESHED_REFRESH_TOKEN,
    options: { path: "/", httpOnly: true, sameSite: "lax" },
  },
];

// Verbatim values @supabase/ssr's applyServerStorage passes as the second
// setAll argument on a real refresh (dist/main/cookies.js).
const REFRESH_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

test.describe("updateSession cookie-refresh-on-redirect @proxy-cookie-refresh", () => {
  test("a same-request refresh-then-redirect carries the refreshed cookies and cache headers onto the /login redirect", async () => {
    const request = new NextRequest("http://localhost:3107/admin", {
      headers: { cookie: "sb-access-token=soon-to-expire-value" },
    });

    const response = await updateSession(
      request,
      fakeCreateServerClient({
        cookiesToSet: REFRESH_COOKIES,
        headersToApply: REFRESH_HEADERS,
        claims: null, // forces the redirect branch on the same pass
      })
    );

    // It must actually be a redirect to /login (the claims were null).
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const location = response.headers.get("location");
    expect(location).not.toBeNull();
    expect(new URL(location!).pathname).toBe("/login");

    // The refreshed cookies from setAll() must survive onto the redirect.
    const accessCookie = response.cookies.get("sb-access-token");
    const refreshCookie = response.cookies.get("sb-refresh-token");
    expect(accessCookie?.value).toBe(REFRESHED_ACCESS_TOKEN);
    expect(refreshCookie?.value).toBe(REFRESHED_REFRESH_TOKEN);

    // The cache/expires/pragma headers from the same setAll() call must
    // also survive onto the redirect — this is the specific assertion the
    // VERIFICATION.md backstop item calls out as previously unproven.
    expect(response.headers.get("cache-control")).toBe(
      REFRESH_HEADERS["Cache-Control"]
    );
    expect(response.headers.get("expires")).toBe(REFRESH_HEADERS["Expires"]);
    expect(response.headers.get("pragma")).toBe(REFRESH_HEADERS["Pragma"]);
  });

  test("a refresh on a request that stays authenticated keeps the refreshed cookies without redirecting", async () => {
    const request = new NextRequest("http://localhost:3107/admin", {
      headers: { cookie: "sb-access-token=soon-to-expire-value" },
    });

    const response = await updateSession(
      request,
      fakeCreateServerClient({
        cookiesToSet: REFRESH_COOKIES,
        headersToApply: REFRESH_HEADERS,
        claims: { sub: "user-123" }, // claims resolve, no redirect
      })
    );

    expect(response.headers.get("location")).toBeNull();
    const accessCookie = response.cookies.get("sb-access-token");
    expect(accessCookie?.value).toBe(REFRESHED_ACCESS_TOKEN);
  });

  test("a refresh on /login itself is never redirected, even mid-refresh", async () => {
    const request = new NextRequest("http://localhost:3107/login", {
      headers: { cookie: "sb-access-token=soon-to-expire-value" },
    });

    const response = await updateSession(
      request,
      fakeCreateServerClient({
        cookiesToSet: REFRESH_COOKIES,
        headersToApply: REFRESH_HEADERS,
        claims: null,
      })
    );

    expect(response.headers.get("location")).toBeNull();
  });
});
