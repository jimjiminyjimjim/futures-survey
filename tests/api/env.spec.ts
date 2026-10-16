import { test, expect } from "@playwright/test";
import { readSupabaseEnv } from "@/lib/supabase/env";

test.describe("readSupabaseEnv", () => {
  test("throws naming NEXT_PUBLIC_SUPABASE_URL when both values are absent", () => {
    expect(() =>
      readSupabaseEnv({ url: undefined, publishableKey: undefined })
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  test("throws naming NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY when only a URL is present", () => {
    expect(() =>
      readSupabaseEnv({
        url: "https://example.supabase.co",
        publishableKey: undefined,
      })
    ).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  test("treats whitespace-only values as missing", () => {
    expect(() =>
      readSupabaseEnv({ url: "   ", publishableKey: "   " })
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);

    expect(() =>
      readSupabaseEnv({ url: "https://example.supabase.co", publishableKey: "   " })
    ).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  test("returns valid values trimmed", () => {
    const result = readSupabaseEnv({
      url: "  https://example.supabase.co  ",
      publishableKey: "  sb_publishable_abc  ",
    });
    expect(result).toEqual({
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_abc",
    });
  });
});

test("the linked hosted project answers /auth/v1/health", async () => {
  const { url, publishableKey } = readSupabaseEnv({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  const response = await fetch(`${url}/auth/v1/health`, {
    headers: { apikey: publishableKey },
  });

  expect(response.status).toBe(200);
});
