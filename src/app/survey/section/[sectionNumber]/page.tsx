import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSignedInUser } from "@/lib/auth/session";
import { getSurveySnapshot } from "@/lib/survey/queries";
import { LIVE_SURVEY_PATHS } from "@/lib/survey/paths";
import { SectionScreen } from "./section-screen";

// This route reads cookies() (via getSignedInUser()) on every request,
// which alone makes it dynamic under next.config.ts's cacheComponents.
// `instant = false` only opts this segment out of Instant Navigation
// (prefetch); it has no effect on prerendering/caching eligibility.
export const instant = false;

export default async function SectionPage({
  params,
}: {
  params: Promise<{ sectionNumber: string }>;
}) {
  // See the matching comment in src/app/page.tsx: cacheComponents still
  // speculatively prerenders a shell for this route, and that shell pass
  // hits an unguarded `Date.now()` somewhere inside the Supabase client
  // chain used by getSurveySnapshot. `connection()` is Next's documented
  // fix.
  await connection();

  const { sectionNumber: sectionNumberParam } = await params;

  const user = await getSignedInUser();
  if (!user) {
    redirect("/login");
  }

  const snapshot = await getSurveySnapshot(user.id);

  // The screen body lives in section-screen.tsx so the admin test route
  // reuses it unchanged.
  return (
    <SectionScreen
      snapshot={snapshot}
      sectionNumberParam={sectionNumberParam}
      paths={LIVE_SURVEY_PATHS}
    />
  );
}
