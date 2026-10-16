// One-off admin helper: add an allowed sign-in domain (service role).
// Usage: node scripts/allow-domain.ts gmail.com
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const domain = (process.argv[2] ?? "").trim().toLowerCase();
if (!domain || domain.includes("@") || !domain.includes(".")) {
  console.error("usage: node scripts/allow-domain.ts <domain>");
  process.exit(1);
}
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const { error } = await supabase
  .from("allowed_domains")
  .upsert({ domain }, { onConflict: "domain", ignoreDuplicates: true });
if (error) {
  console.error("failed:", error.code, error.message);
  process.exit(1);
}
const { data } = await supabase.from("allowed_domains").select("domain").order("domain");
console.log("allowed_domains now:", (data ?? []).map((r) => r.domain).join(", "));
