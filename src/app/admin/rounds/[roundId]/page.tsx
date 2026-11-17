import { redirect, notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import Link from "next/link";
import { Presentation } from "lucide-react";
import { canPresent } from "@/lib/presentation/chart-math";
import { getSignedInUser } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RoundStatusBadge } from "@/components/admin/round-status-badge";
import { ExportCsvLink } from "@/components/admin/export-csv-link";
import { getRoundDetail } from "@/lib/admin/rounds-queries";
import { getRoundResponses } from "@/lib/admin/responses-queries";
import { ResponsesTable } from "@/components/admin/responses-table";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";
import {
  formatAdminDateTime,
  toAdminDateTimeInputValue,
} from "@/lib/admin/datetime";
import { RoundScheduleForm } from "@/components/admin/round-schedule-form";
import { RoundLifecycleActions } from "@/components/admin/round-lifecycle-actions";
import { isUnopenedDraft } from "@/lib/unopened-draft";
import { RoundTestActions } from "@/components/admin/round-test-actions";

// This route reads cookies() (via getSignedInUser()) on every request,
// which alone makes it dynamic under next.config.ts's cacheComponents.
// `instant = false` only opts this segment out of Instant Navigation
// (prefetch). See src/app/admin/page.tsx for the full explanation of why
// `connection()` is also needed below (speculative shell-prerender hits an
// unguarded Date.now() inside the Supabase client chain otherwise).
export const instant = false;

const RoundIdSchema = z.uuid();

/**
 * Admin round status/actions page. User decision 2026-10-15: "make the
 * admin a lot simpler" — this page shows ONLY round status and actions
 * (title, dates, status, started/submitted counts, schedule form,
 * Open now / Close early, View responses, Export CSV). It no longer
 * renders any section/statement list, statement keys, or content editors
 * (RND-03, descoped — see .planning/REQUIREMENTS.md). New rounds still
 * copy the previous round's questions unchanged via admin_create_round;
 * that happens entirely server-side and has nothing to render here.
 *
 * getRoundDetail() still returns `sections`/`scales` (it's shared with
 * responses-queries.ts and the presentation data loader) — this page just
 * no longer destructures or renders them.
 */
export default async function RoundEditorPage({
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

  const user = await getSignedInUser();
  if (!user) {
    redirect("/login");
  }

  const detail = await getRoundDetail(parsedRoundId.data);
  if (!detail) {
    notFound();
  }

  const { round } = detail;
  // Admin test mode (quick task 261117-it4): only while the round has no
  // open date AND no close date. Every response on it is a test answer.
  const testMode = isUnopenedDraft(round.opensAt, round.closesAt);
  // Responses live on this page (user decision 2026-10-15: "we don't need
  // another page"); /admin/rounds/[roundId]/responses now redirects here.
  const responses = await getRoundResponses(round.id);
  // Sample answers have no participant, so the responses list (one row per
  // participant) doesn't show them; the counts and the deck do. Say how
  // many are missing from the list.
  const unlistedSamples =
    testMode && responses?.ok
      ? Math.max(0, round.startedCount - responses.participants.length)
      : 0;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12 dark:bg-black">
      <div className="flex w-full max-w-5xl flex-col gap-8">
        <div className="flex flex-col gap-2">
          {round.sessionNumber != null && round.surveyTitle ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {ADMIN_MESSAGES.roundContextLine(
                round.sessionNumber,
                round.surveyTitle
              )}
            </p>
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold break-words">{round.title}</h1>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <RoundStatusBadge status={round.status} size="lg" />
              {canPresent(round.status) ? (
                <Link
                  href={`/admin/rounds/${round.id}/present`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
                >
                  <Presentation className="size-4" aria-hidden="true" />
                  {ADMIN_MESSAGES.presentResults}
                </Link>
              ) : null}
              <RoundLifecycleActions
                roundId={round.id}
                status={round.status}
                testAnswerCount={testMode ? round.startedCount : 0}
              />
            </div>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {ADMIN_MESSAGES.responsesCounts(
              round.startedCount,
              round.submittedCount
            )}
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {"Opens "}
            {formatAdminDateTime(round.opensAt) ?? ADMIN_MESSAGES.notSet}
            {" · Closes "}
            {formatAdminDateTime(round.closesAt) ??
              (round.status === "open" || round.status === "scheduled"
                ? ADMIN_MESSAGES.noCloseDate
                : ADMIN_MESSAGES.notSet)}
          </p>
        </div>


        {round.status === "closed" ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {ADMIN_MESSAGES.roundClosedNote}
          </p>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                {ADMIN_MESSAGES.scheduleHeading}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {testMode && round.startedCount > 0 ? (
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  {ADMIN_MESSAGES.scheduleClearsTestAnswers(round.startedCount)}
                </p>
              ) : null}
              <RoundScheduleForm
                roundId={round.id}
                title={round.title}
                opensAtIso={round.opensAt}
                closesAtIso={round.closesAt}
                opensInputValue={toAdminDateTimeInputValue(round.opensAt)}
                closesInputValue={toAdminDateTimeInputValue(round.closesAt)}
                status={round.status}
              />
            </CardContent>
          </Card>
        )}

        {testMode ? (
          <section
            aria-labelledby="test-heading"
            className="flex flex-col gap-3 border-t pt-8"
          >
            <h2 id="test-heading" className="text-lg font-semibold">
              {ADMIN_MESSAGES.testHeading}
            </h2>
            <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
              {ADMIN_MESSAGES.testBody}
            </p>
            <p className="text-sm font-medium">
              {ADMIN_MESSAGES.testAnswersCounts(
                round.startedCount,
                round.submittedCount
              )}
            </p>
            <div className="flex flex-wrap items-start gap-3">
              <Link
                href={`/admin/rounds/${round.id}/test`}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
              >
                {ADMIN_MESSAGES.testTakeCta}
              </Link>
              <Link
                href={`/admin/rounds/${round.id}/present`}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
              >
                <Presentation className="size-4" aria-hidden="true" />
                {ADMIN_MESSAGES.presentTestResults}
              </Link>
            </div>
            <RoundTestActions roundId={round.id} />
          </section>
        ) : null}

        <section
          aria-labelledby="responses-heading"
          className="flex flex-col gap-4 border-t pt-8"
        >

          {!responses || !responses.ok || responses.participants.length === 0 ? (
            <h2 id="responses-heading" className="text-lg font-semibold">
              {ADMIN_MESSAGES.responsesHeading}
            </h2>
          ) : null}
          {testMode ? (
            <div className="flex flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">
              <p className="font-medium">{ADMIN_MESSAGES.testAnswersNotice}</p>
              {unlistedSamples > 0 ? (
                <p>{ADMIN_MESSAGES.testSamplesNotListed(unlistedSamples)}</p>
              ) : null}
            </div>
          ) : null}
          {!responses || !responses.ok ? (
            <Card>
              <CardContent>
                <p role="alert" className="text-sm text-destructive">
                  {ADMIN_MESSAGES.responsesLoadFailed}
                </p>
              </CardContent>
            </Card>
          ) : responses.participants.length === 0 ? (
            <Card>
              <CardContent>
                <p className="text-base font-medium">
                  {ADMIN_MESSAGES.noResponsesHeading}
                </p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {ADMIN_MESSAGES.noResponsesBody}
                </p>
              </CardContent>
            </Card>
          ) : (
            <ResponsesTable
              participants={responses.participants}
              statements={responses.statements}
              heading={(
                <div className="flex items-baseline gap-3">
                  <h2 id="responses-heading" className="text-lg font-semibold">
                    {ADMIN_MESSAGES.responsesHeading}
                  </h2>
                  {responses?.ok ? (
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      {ADMIN_MESSAGES.responsesCount(responses.participants.length)}
                    </span>
                  ) : null}
                </div>
              )}
              actions={<ExportCsvLink roundId={round.id} />}
            />
          )}
        </section>
      </div>
    </div>
  );
}
