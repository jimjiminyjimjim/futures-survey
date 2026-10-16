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
import { getSurveySnapshot } from "@/lib/survey/queries";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import { NavButton } from "@/components/survey/nav-button";
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

  const snapshot = await getSurveySnapshot(user.id);
  if (
    !snapshot.openRound ||
    snapshot.response?.submittedAt ||
    snapshot.statements.length === 0
  ) {
    redirect("/");
  }

  const total = snapshot.statements.length;
  const firstUnanswered = snapshot.statements.find(
    (s) => !snapshot.answers.has(s.id)
  );
  const answered = snapshot.statements.filter((s) =>
    snapshot.answers.has(s.id)
  ).length;
  const remaining = total - answered;
  const lastStatement = snapshot.statements[snapshot.statements.length - 1];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-4 py-12 dark:bg-black">
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
          {/* Rendered unconditionally — including while statements remain
              unanswered — so an incomplete submit attempt gets the
              documented rejection message rather than a hidden button. */}
          <div className="pt-4">
            <SubmitForm />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
