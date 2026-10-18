import { connection } from "next/server";
import { getSignedInUser, isCurrentUserAdmin } from "@/lib/auth/session";
import { ParticipantHeader } from "@/components/participant-header";

// No visible menu bar on /survey pages — full-bleed black background
// behind the question panel. The signed-in email + Sign out (and the admin
// link) still need to be reachable, so they float top-right instead of
// sitting in a bordered bar. The pages keep their own sign-in/open-round
// guards; this layout only renders chrome.
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
      {user ? (
        <ParticipantHeader email={user.email} isAdmin={isAdmin} variant="floating" />
      ) : null}
      {children}
    </>
  );
}
