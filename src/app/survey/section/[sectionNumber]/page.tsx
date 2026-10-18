import { redirect, notFound } from "next/navigation";
import { connection } from "next/server";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { getSignedInUser } from "@/lib/auth/session";
import { getSurveySnapshot } from "@/lib/survey/queries";
import {
  buildSectionSummaries,
  resolveSectionScreen,
  parentSectionHeading,
  sectionHeading,
} from "@/lib/survey/state";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import { SectionNav } from "./section-nav";

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
  if (!snapshot.openRound || snapshot.response?.submittedAt) {
    redirect("/");
  }

  const sectionNumber = Number(sectionNumberParam);
  const sections = buildSectionSummaries(snapshot.statements);
  const screen = resolveSectionScreen(sections, sectionNumber);
  if (!screen) {
    notFound();
  }
  const parentLine = parentSectionHeading(screen.label, screen.parentTitle);

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-black px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardDescription className="text-sm">
            {SURVEY_MESSAGES.sectionOf(screen.sectionNumber, screen.totalSections)}
          </CardDescription>
          {parentLine ? (
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 break-words">
              {parentLine}
            </p>
          ) : null}
          <CardTitle
            role="heading"
            aria-level={1}
            className="text-2xl font-semibold break-words"
          >
            {sectionHeading(screen.label, screen.title)}
          </CardTitle>
          <CardDescription className="text-base">
            {screen.prompt}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SectionNav continueHref={screen.continueHref} backHref={screen.backHref} />
        </CardContent>
      </Card>
    </div>
  );
}
