import { createClient } from "@/lib/supabase/server";

export async function getSignedInUser(): Promise<{
  id: string;
  email: string;
} | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  const claims = data?.claims;
  const id = claims?.sub;
  const email = claims?.email;

  if (!id || !email) {
    return null;
  }

  return { id, email };
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_admin");

  if (error) {
    return false;
  }

  return data === true;
}
