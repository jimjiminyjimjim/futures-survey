import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSignedInUser } from "@/lib/auth/session";
import { getSurveySnapshot, getResultsConsent } from "@/lib/survey/queries";
import { LIVE_SURVEY_PATHS } from "@/lib/survey/paths";
import { ReviewScreen } from "./review-screen";

// This route reads cookies() (via getSignedInUser()) on every request,
// which alone makes it dynamic under next.config.ts's cacheComponents.
// `instant = false` only opts this segment out of Instant Navigation
// (prefetch); it has no effect on prerendering/caching eligibility.
export const instant = false;

export default async function ReviewPage() {
  // See the matching comment in src/app/page.tsx: cacheComponents still
  // speculatively prerenders a shell for this route, and that shell pass
  // hits an unguarded `Date.now()` somewhere inside the Supabase client
  // chain used by getSurveySnapshot — surfacing as an intermittent real
  // load failure, not just build-time noise (found running the full e2e
  // suite). `connection()` is Next's documented fix.
  await connection();

  const user = await getSignedInUser();
  if (!user) {
    redirect("/login");
  }

  // Consent is per session: load the snapshot first (it resolves the open
  // round), then look consent up for that round.
  const snapshot = await getSurveySnapshot(user.id);
  const resultsConsent = await getResultsConsent(
    user.id,
    snapshot.openRound?.id ?? null
  );

  // The screen body (guards, completeness, submit) lives in
  // review-screen.tsx so the admin test route reuses it unchanged.
  return (
    <ReviewScreen
      snapshot={snapshot}
      paths={LIVE_SURVEY_PATHS}
      consent={{ optedIn: resultsConsent.optedIn }}
    />
  );
}
