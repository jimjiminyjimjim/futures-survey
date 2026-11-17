import { redirect, notFound } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import type { SurveySnapshot } from "@/lib/survey/queries";
import {
  buildSectionSummaries,
  resolveSectionScreen,
  parentSectionHeading,
  sectionHeading,
  visibleSectionPrompt,
} from "@/lib/survey/state";
import type { SurveyPaths } from "@/lib/survey/paths";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import { SectionNav } from "./section-nav";

/**
 * The section-break screen. Shared by the live /survey/section/[n] route
 * and the admin test route for an unopened draft (quick task 261117-it4);
 * every href comes from `paths`. Markup is unchanged from the original
 * page.
 */
export function SectionScreen({
  snapshot,
  sectionNumberParam,
  paths,
}: {
  snapshot: SurveySnapshot;
  sectionNumberParam: string;
  paths: SurveyPaths;
}) {
  if (!snapshot.openRound || snapshot.response?.submittedAt) {
    redirect(paths.home);
  }

  const sectionNumber = Number(sectionNumberParam);
  const sections = buildSectionSummaries(snapshot.statements);
  const screen = resolveSectionScreen(sections, sectionNumber, paths);
  if (!screen) {
    notFound();
  }
  const parentLine = parentSectionHeading(screen.label, screen.parentTitle);
  // Null when the prompt only repeats the section title (Session 2's D).
  const prompt = visibleSectionPrompt(screen.title, screen.prompt);

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-black px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardDescription className="text-sm">
            {SURVEY_MESSAGES.sectionOf(screen.questionNumber, screen.totalQuestions)}
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
          {prompt ? (
            <CardDescription className="text-base">{prompt}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SectionNav continueHref={screen.continueHref} backHref={screen.backHref} />
        </CardContent>
      </Card>
    </div>
  );
}
