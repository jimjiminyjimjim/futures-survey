import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { Presentation } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSignedInUser } from "@/lib/auth/session";
import { getSurveySnapshot } from "@/lib/survey/queries";
import {
  buildSectionSummaries,
  countQuestions,
  partAndQuestionsLabel,
  partLabel,
  resolveSurveyScreen,
} from "@/lib/survey/state";
import {
  reviewHref,
  sectionHref,
  statementHref,
  testSurveyPaths,
} from "@/lib/survey/paths";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";
import { StartCard } from "@/components/survey/start-card";
import { SurveyErrorScreen } from "@/components/survey/status-screens";
import { TestRestartButton } from "@/components/survey/test-banner";

// Admin test mode start page for an unopened draft (quick task 261117-it4).
// Mirrors the live home page (src/app/page.tsx): resume and review redirect
// into the test survey, a fresh start shows the same StartCard. There is
// no results consent in test mode.
export const instant = false;

const RoundIdSchema = z.uuid();

const LINK_CLASS =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted";

export default async function TestRoundStartPage({
  params,
}: {
  params: Promise<{ roundId: string }>;
}) {
  await connection();

  const { roundId } = await params;
  const parsedRoundId = RoundIdSchema.safeParse(roundId);
  if (!parsedRoundId.success) {
    notFound();
  }
  const id = parsedRoundId.data;

  const user = await getSignedInUser();
  if (!user) {
    redirect("/login");
  }

  const paths = testSurveyPaths(id);
  const snapshot = await getSurveySnapshot(user.id, id);
  const roundHref = `/admin/rounds/${id}`;

  if (!snapshot.openRound) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-4 py-12 dark:bg-black">
        {snapshot.hasError ? (
          <SurveyErrorScreen />
        ) : (
          <Card className="w-full max-w-md">
            <CardContent className="flex flex-col gap-4">
              <p className="text-base">{ADMIN_MESSAGES.testNotDraft}</p>
              <Link href={roundHref} className={`${LINK_CLASS} self-start`}>
                {ADMIN_MESSAGES.backToRound}
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  if (snapshot.statements.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-4 py-12 dark:bg-black">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col gap-4">
            <p className="text-base">{ADMIN_MESSAGES.testNoQuestions}</p>
            <Link href={roundHref} className={`${LINK_CLASS} self-start`}>
              {ADMIN_MESSAGES.backToRound}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const answeredKeys = new Set<string>();
  for (const statement of snapshot.statements) {
    if (snapshot.answers.has(statement.id)) {
      answeredKeys.add(statement.key);
    }
  }

  const sections = buildSectionSummaries(snapshot.statements);
  const screen = resolveSurveyScreen({
    openRound: { title: snapshot.openRound.title },
    orderedStatementKeys: snapshot.statements.map((s) => s.key),
    requiredStatementKeys: snapshot.statements
      .filter((s) => !s.optional)
      .map((s) => s.key),
    response: snapshot.response
      ? { submittedAt: snapshot.response.submittedAt }
      : null,
    answeredKeys,
    sections,
  });

  if (screen.kind === "resume") {
    redirect(statementHref(paths, screen.statementKey));
  }
  if (screen.kind === "review") {
    redirect(reviewHref(paths));
  }

  const round = snapshot.openRound;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-4 py-12 dark:bg-black">
      {screen.kind === "start" ? (
        <StartCard
          surveyTitle={round.surveyTitle}
          roundTitle={screen.roundTitle}
          partText={
            round.intro
              ? partLabel(round.partNumber, round.totalParts)
              : partAndQuestionsLabel(
                  round.partNumber,
                  round.totalParts,
                  countQuestions(sections)
                )
          }
          intro={round.intro}
          beginHref={sectionHref(paths, 1)}
        />
      ) : null}
      {screen.kind === "thanks" ? (
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle
              role="heading"
              aria-level={1}
              className="text-2xl font-semibold"
            >
              {ADMIN_MESSAGES.testSubmittedHeading}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-base">{ADMIN_MESSAGES.testSubmittedBody}</p>
            <div className="flex flex-wrap items-start gap-3">
              <TestRestartButton
                roundId={id}
                homeHref={paths.home}
                label={ADMIN_MESSAGES.testAnswerAgainCta}
                className="h-8 px-3 text-sm"
              />
              <Link href={`${roundHref}/present`} className={LINK_CLASS}>
                <Presentation className="size-4" aria-hidden="true" />
                {ADMIN_MESSAGES.presentTestResults}
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {screen.kind === "no-round" ? <SurveyErrorScreen /> : null}
    </div>
  );
}
