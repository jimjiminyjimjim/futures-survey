import { redirect } from "next/navigation";
import { connection } from "next/server";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { getSignedInUser, isCurrentUserAdmin } from "@/lib/auth/session";
import { getSurveySnapshot } from "@/lib/survey/queries";
import {
  resolveSurveyScreen,
  questionCountLabel,
  roughMinutesLabel,
} from "@/lib/survey/state";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import {
  NoOpenRoundScreen,
  SurveyErrorScreen,
  ThanksScreen,
} from "@/components/survey/status-screens";
import { NavButton } from "@/components/survey/nav-button";
import { ParticipantHeader } from "@/components/participant-header";

// This route reads cookies() on every request to decide signed-in vs
// signed-out, which alone makes it dynamic under next.config.ts's
// cacheComponents. `instant = false` only opts this segment out of
// Instant Navigation (prefetch); it has no effect on prerendering/caching
// eligibility.
export const instant = false;

export default async function HomePage() {
  // cacheComponents + partialPrefetching (next.config.ts) still attempt a
  // speculative static-shell prerender pass for this route even though
  // getSignedInUser() reads cookies() below — that read alone doesn't stop
  // Next from continuing to speculatively execute the rest of the
  // function during the shell pass. During that pass, something inside
  // the Supabase client chain (getSurveySnapshot's RPC/query calls) hits
  // an unguarded `Date.now()`, which cacheComponents treats as an
  // "unstable value" error — surfacing as an intermittent, real save/load
  // failure (not just build-time noise) in gap-closure e2e runs. Calling
  // `connection()` first is Next's own documented fix ("[dynamic] Render
  // at request time by adding a dynamic data access... before this
  // call"): it forces the rest of this component to render per-request,
  // skipping the shell-prerender attempt entirely.
  await connection();

  const user = await getSignedInUser();

  if (!user) {
    redirect("/login");
  }

  const [isAdmin, snapshot] = await Promise.all([
    isCurrentUserAdmin(),
    getSurveySnapshot(user.id),
  ]);

  const orderedStatementKeys = snapshot.statements.map((s) => s.key);
  const answeredKeys = new Set<string>();
  for (const statement of snapshot.statements) {
    if (snapshot.answers.has(statement.id)) {
      answeredKeys.add(statement.key);
    }
  }

  const screen = resolveSurveyScreen({
    openRound: snapshot.openRound ? { title: snapshot.openRound.title } : null,
    orderedStatementKeys,
    response: snapshot.response
      ? { submittedAt: snapshot.response.submittedAt }
      : null,
    answeredKeys,
  });

  if (screen.kind === "resume") {
    redirect(`/survey/${screen.statementKey}`);
  }
  if (screen.kind === "review") {
    redirect("/survey/review");
  }

  return (
    <>
    <ParticipantHeader email={user.email} isAdmin={isAdmin} />
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-4 py-12 dark:bg-black">
      {screen.kind === "start" ? (
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle
              role="heading"
              aria-level={1}
              className="text-2xl font-semibold"
            >
              {screen.roundTitle}
            </CardTitle>
            <CardDescription className="text-base">
              {questionCountLabel(screen.questionCount)} ·{" "}
              {roughMinutesLabel(screen.questionCount)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Nothing answered yet: always section 1's break screen, never
                straight to screen.firstStatementKey — the section-break
                interstitial feature wires "Begin" through the section
                screens, not directly to a statement. */}
            <NavButton href="/survey/section/1">
              {SURVEY_MESSAGES.beginCta}
            </NavButton>
          </CardContent>
        </Card>
      ) : null}
      {screen.kind === "no-round" ? (
        snapshot.hasError ? <SurveyErrorScreen /> : <NoOpenRoundScreen />
      ) : null}
      {screen.kind === "thanks" ? <ThanksScreen /> : null}

    </div>
    </>
  );
}
