import { redirect } from "next/navigation";
import { connection } from "next/server";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { getSignedInUser } from "@/lib/auth/session";
import { getSurveySnapshot, getResultsConsent } from "@/lib/survey/queries";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import { NavButton } from "@/components/survey/nav-button";
import { ResultsConsentStatus } from "@/components/survey/results-consent-status";
import { SubmitForm } from "./submit-form";

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

  const [snapshot, resultsConsent] = await Promise.all([
    getSurveySnapshot(user.id),
    getResultsConsent(user.id),
  ]);
  if (
    !snapshot.openRound ||
    snapshot.response?.submittedAt ||
    snapshot.statements.length === 0
  ) {
    redirect("/");
  }

  // Not opted in (including a load error) offers the opt-in checkbox;
  // opted in shows the status panel + withdraw instead.
  const offerOptIn = !resultsConsent.optedIn;

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
                href={`/survey/${firstUnanswered!.key}`}
                variant="outline"
              >
                {SURVEY_MESSAGES.reviewFirstUnanswered}
              </NavButton>
            </div>
          ) : null}
          <NavButton href={`/survey/${lastStatement.key}`} variant="outline">
            {SURVEY_MESSAGES.back}
          </NavButton>
          {resultsConsent.optedIn ? (
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
