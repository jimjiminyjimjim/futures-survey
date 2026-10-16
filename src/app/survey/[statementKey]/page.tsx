import { redirect, notFound } from "next/navigation";
import { connection } from "next/server";
import { Card, CardContent } from "@/components/ui/card";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { getSignedInUser } from "@/lib/auth/session";
import { getSurveySnapshot } from "@/lib/survey/queries";
import { buildSectionSummaries, resolveStatementNav } from "@/lib/survey/state";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import { StatementForm } from "./statement-form";

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
  if (!snapshot.openRound || snapshot.response?.submittedAt) {
    redirect("/");
  }

  // Exact, case-sensitive match — no trimming or lowercasing. An unknown
  // or differently-cased key (e.g. /survey/zz_99, /survey/S1_01) 404s.
  const index = snapshot.statements.findIndex((s) => s.key === statementKey);
  if (index === -1) {
    notFound();
  }

  const statement = snapshot.statements[index];
  const total = snapshot.statements.length;
  const position = statement.position;

  const sections = buildSectionSummaries(snapshot.statements);
  const nav = resolveStatementNav(sections, statementKey);
  // Unreachable in practice: statementKey was just found in
  // snapshot.statements above, and buildSectionSummaries groups every one
  // of those statements into a section.
  if (!nav) {
    notFound();
  }

  const initialValue = snapshot.answers.get(statement.id) ?? null;
  const statementTextId = `statement-${statement.id}`;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-8 dark:bg-black">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold break-words">
            {statement.sectionTitle}
          </h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400 break-words">
            {statement.sectionPrompt}
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-6">
            <Progress value={position} max={total} min={0} className="w-full flex-col items-stretch gap-1.5">
              <ProgressLabel className="text-sm text-zinc-600 dark:text-zinc-400">
                {SURVEY_MESSAGES.sectionProgress(
                  nav.position.sectionNumber,
                  nav.position.totalSections,
                  nav.position.positionInSection,
                  nav.position.countInSection
                )}
              </ProgressLabel>
            </Progress>
            <p
              id={statementTextId}
              className="text-lg font-semibold leading-tight break-words"
            >
              {statement.text}
            </p>
            <StatementForm
              statementId={statement.id}
              labelledById={statementTextId}
              options={statement.options}
              initialValue={initialValue}
              prevHref={nav.prevHref}
              nextHref={nav.nextHref}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
