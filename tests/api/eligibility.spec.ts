import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe("is_email_eligible edge matrix @eligibility-rpc", () => {
  const trueCases = [
    "x@network.rca.ac.uk",
    "RHODES.JAMES@GMAIL.COM",
    " James.Carrigan@Network.RCA.ac.uk ",
    "james.carrigan@network.rca.ac.uk",
    "rhodes.james@gmail.com",
  ];

  const falseCases = [
    "x@sub.network.rca.ac.uk",
    "x@evilnetwork.rca.ac.uk",
    "x@network.rca.ac.uk.evil.com",
    "someone@hotmail.com",
    "a@b@network.rca.ac.uk",
    '"a@network.rca.ac.uk"@evil.com',
    "network.rca.ac.uk",
    "",
    "   ",
    null,
  ];

  for (const input of trueCases) {
    test(`true for ${JSON.stringify(input)}`, async () => {
      const client = anonClient();
      const { data, error } = await client.rpc("is_email_eligible", {
        p_email: input,
      });
      expect(error).toBeNull();
      expect(data).toBe(true);
    });
  }

  for (const input of falseCases) {
    test(`false for ${JSON.stringify(input)}`, async () => {
      const client = anonClient();
      const { data, error } = await client.rpc("is_email_eligible", {
        p_email: input,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    });
  }
});
