/**
 * Fail-fast reader for the two public Supabase env vars.
 *
 * No imports: callers must pass literal `process.env.NEXT_PUBLIC_*` reads so
 * Next.js can statically inline them into client bundles.
 */
export function readSupabaseEnv(values: {
  url: string | undefined;
  publishableKey: string | undefined;
}): { url: string; publishableKey: string } {
  const url = values.url?.trim();
  if (!url) {
    throw new Error(
      "Missing environment variable NEXT_PUBLIC_SUPABASE_URL — see .env.example"
    );
  }

  const publishableKey = values.publishableKey?.trim();
  if (!publishableKey) {
    throw new Error(
      "Missing environment variable NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — see .env.example"
    );
  }

  return { url, publishableKey };
}
