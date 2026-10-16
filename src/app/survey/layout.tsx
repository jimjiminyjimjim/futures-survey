import { connection } from "next/server";
import { getSignedInUser, isCurrentUserAdmin } from "@/lib/auth/session";
import { ParticipantHeader } from "@/components/participant-header";

// Shared top bar (email + Sign out) for every /survey page. The pages keep
// their own sign-in/open-round guards; this layout only renders chrome.
export const instant = false;

export default async function SurveyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection(); // avoid cacheComponents speculative-prerender Date.now() error
  const user = await getSignedInUser();
  const isAdmin = user ? await isCurrentUserAdmin() : false;

  return (
    <>
      {user ? <ParticipantHeader email={user.email} isAdmin={isAdmin} /> : null}
      {children}
    </>
  );
}
