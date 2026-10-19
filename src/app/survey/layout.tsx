import { connection } from "next/server";
import { getSignedInUser, isCurrentUserAdmin } from "@/lib/auth/session";
import { getSurveySnapshot } from "@/lib/survey/queries";
import { partLabel, partAndQuestionsLabel } from "@/lib/survey/state";
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

  const [isAdmin, snapshot] = user
    ? await Promise.all([isCurrentUserAdmin(), getSurveySnapshot(user.id)])
    : [false, null];

  // getSurveySnapshot is React-`cache`d, so this call reuses the same
  // result the page itself fetches in the same request — no extra query.
  const sessionIntro =
    snapshot?.openRound && !snapshot.hasError
      ? {
          surveyTitle: snapshot.openRound.surveyTitle,
          roundTitle: snapshot.openRound.title,
          intro: snapshot.openRound.intro,
          partLabel: snapshot.openRound.intro
            ? partLabel(snapshot.openRound.partNumber, snapshot.openRound.totalParts)
            : partAndQuestionsLabel(
                snapshot.openRound.partNumber,
                snapshot.openRound.totalParts,
                new Set(snapshot.statements.map((s) => s.sectionId)).size
              ),
        }
      : null;

  return (
    <>
      {user ? (
        <ParticipantHeader
          email={user.email}
          isAdmin={isAdmin}
          variant="floating"
          sessionIntro={sessionIntro}
        />
      ) : null}
      {children}
    </>
  );
}
