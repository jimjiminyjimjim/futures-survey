import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSignedInUser } from "@/lib/auth/session";
import { getSurveySnapshot } from "@/lib/survey/queries";
import { LIVE_SURVEY_PATHS } from "@/lib/survey/paths";
import { StatementScreen } from "./statement-screen";

// This route reads cookies() (via getSignedInUser()) on every request,
// which alone makes it dynamic under next.config.ts's cacheComponents.
// `instant = false` only opts this segment out of Instant Navigation
// (prefetch); it has no effect on prerendering/caching eligibility.
export const instant = false;

export default async function StatementPage({
  params,
}: {
  params: Promise<{ statementKey: string }>;
}) {
  // See the matching comment in src/app/page.tsx: cacheComponents still
  // speculatively prerenders a shell for this route, and that shell pass
  // hits an unguarded `Date.now()` somewhere inside the Supabase client
  // chain used by getSurveySnapshot — surfacing as an intermittent real
  // save/navigation failure, not just build-time noise (found running
  // the full e2e suite). `connection()` is Next's documented fix.
  await connection();

  const { statementKey } = await params;

  const user = await getSignedInUser();
  if (!user) {
    redirect("/login");
  }

  const snapshot = await getSurveySnapshot(user.id);

  // The screen body (guards, nav, every question kind) lives in
  // statement-screen.tsx so the admin test route reuses it unchanged.
  return (
    <StatementScreen
      snapshot={snapshot}
      statementKey={statementKey}
      paths={LIVE_SURVEY_PATHS}
    />
  );
}
