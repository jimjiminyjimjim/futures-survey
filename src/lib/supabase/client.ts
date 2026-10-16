import { createBrowserClient } from "@supabase/ssr";
import { readSupabaseEnv } from "@/lib/supabase/env";

export function createClient() {
  const { url, publishableKey } = readSupabaseEnv({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  return createBrowserClient(url, publishableKey);
}
