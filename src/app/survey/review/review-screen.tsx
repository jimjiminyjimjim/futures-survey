import { redirect } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import type { SurveySnapshot } from "@/lib/survey/queries";
import { statementHref, type SurveyPaths } from "@/lib/survey/paths";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import { NavButton } from "@/components/survey/nav-button";
import { ResultsConsentStatus } from "@/components/survey/results-consent-status";
import { SubmitForm } from "./submit-form";

/**
 * The review/submit screen. Shared by the live /survey/review route and
 * the admin test route for an unopened draft (quick task 261117-it4).
 * `consent` is the participant's results consent for this session; null
 * means there is no consent question at all (admin test mode): no consent
 * statement, no consent status panel, and the single "Submit answers"
 * button. Markup is otherwise unchanged from the original page.
 */
export function ReviewScreen({
  snapshot,
  paths,
  consent,
}: {
  snapshot: SurveySnapshot;
  paths: SurveyPaths;
  consent: { optedIn: boolean } | null;
}) {
  if (
    !snapshot.openRound ||
    snapshot.response?.submittedAt ||
    snapshot.statements.length === 0
  ) {
    redirect(paths.home);
  }

  // Not opted in (including a load error) offers the two submit buttons
  // (save / do not save); opted in shows the status panel + withdraw
  // instead. No consent question at all in admin test mode.
  const offerOptIn = consent !== null && !consent.optedIn;

  // Completeness counts only required questions — optional predictions
  // never block submit (same rule as submitResponse and the DB trigger).
  const required = snapshot.statements.filter((s) => !s.optional);
  const total = required.length;
  const firstUnanswered = required.find((s) => !snapshot.answers.has(s.id));
  const answered = required.filter((s) => snapshot.answers.has(s.id)).length;
  const remaining = total - answered;
  const lastStatement = snapshot.statements[snapshot.statements.length - 1];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-black px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle
            role="heading"
            aria-level={1}
            className="text-2xl font-semibold"
          >
            {SURVEY_MESSAGES.reviewHeading}
          </CardTitle>
          <CardDescription className="text-base">
            {SURVEY_MESSAGES.reviewAnswered(answered, total)}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {remaining > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {SURVEY_MESSAGES.reviewRemaining(remaining)}
              </p>
              <NavButton
                href={statementHref(paths, firstUnanswered!.key)}
                variant="outline"
              >
                {SURVEY_MESSAGES.reviewFirstUnanswered}
              </NavButton>
            </div>
          ) : null}
          <NavButton href={statementHref(paths, lastStatement.key)} variant="outline">
            {SURVEY_MESSAGES.back}
          </NavButton>
          {consent?.optedIn ? (
            <ResultsConsentStatus afterWithdraw="refresh" />
          ) : null}
          {/* Rendered unconditionally — including while statements remain
              unanswered — so an incomplete submit attempt gets the
              documented rejection message rather than a hidden button. */}
          <div className="pt-4">
            <SubmitForm offerOptIn={offerOptIn} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
