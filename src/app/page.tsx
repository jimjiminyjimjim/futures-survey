import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSignedInUser, isCurrentUserAdmin } from "@/lib/auth/session";
import { getSurveySnapshot, getResultsConsent } from "@/lib/survey/queries";
import {
  resolveSurveyScreen,
  partAndQuestionsLabel,
  partLabel,
  buildSectionSummaries,
  countQuestions,
} from "@/lib/survey/state";
import {
  LIVE_SURVEY_PATHS,
  reviewHref,
  sectionHref,
  statementHref,
} from "@/lib/survey/paths";
import {
  NoOpenRoundScreen,
  SurveyErrorScreen,
  ThanksScreen,
} from "@/components/survey/status-screens";
import { ResultsConsentStatus } from "@/components/survey/results-consent-status";
import { StartCard } from "@/components/survey/start-card";
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

  // Consent is per session, so the snapshot (which resolves the open round)
  // loads first and the consent lookup is keyed by that round.
  const [isAdmin, snapshot] = await Promise.all([
    isCurrentUserAdmin(),
    getSurveySnapshot(user.id),
  ]);
  const resultsConsent = await getResultsConsent(
    user.id,
    snapshot.openRound?.id ?? null
  );

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
    requiredStatementKeys: snapshot.statements
      .filter((s) => !s.optional)
      .map((s) => s.key),
    response: snapshot.response
      ? { submittedAt: snapshot.response.submittedAt }
      : null,
    answeredKeys,
    sections: buildSectionSummaries(snapshot.statements),
  });

  if (screen.kind === "resume") {
    redirect(statementHref(LIVE_SURVEY_PATHS, screen.statementKey));
  }
  if (screen.kind === "review") {
    redirect(reviewHref(LIVE_SURVEY_PATHS));
  }

  return (
    <>
    <ParticipantHeader email={user.email} isAdmin={isAdmin} />
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-4 py-12 dark:bg-black">
      {screen.kind === "start" ? (
        <StartCard
          surveyTitle={snapshot.openRound?.surveyTitle ?? null}
          roundTitle={screen.roundTitle}
          partText={
            snapshot.openRound?.intro
              ? partLabel(
                  snapshot.openRound?.partNumber ?? null,
                  snapshot.openRound?.totalParts ?? null
                )
              : partAndQuestionsLabel(
                  snapshot.openRound?.partNumber ?? null,
                  snapshot.openRound?.totalParts ?? null,
                  countQuestions(buildSectionSummaries(snapshot.statements))
                )
          }
          intro={snapshot.openRound?.intro ?? null}
          beginHref={sectionHref(LIVE_SURVEY_PATHS, 1)}
        />
      ) : null}
      {screen.kind === "no-round" ? (
        snapshot.hasError ? <SurveyErrorScreen /> : <NoOpenRoundScreen />
      ) : null}
      {screen.kind === "thanks" ? (
        <div className="flex w-full max-w-md flex-col gap-4">
          <ThanksScreen />
          {resultsConsent.optedIn ? (
            <ResultsConsentStatus afterWithdraw="message" />
          ) : null}
        </div>
      ) : null}

    </div>
    </>
  );
}
