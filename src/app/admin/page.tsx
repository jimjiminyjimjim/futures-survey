import { redirect } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import { getSignedInUser } from "@/lib/auth/session";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RoundStatusBadge } from "@/components/admin/round-status-badge";
import { RoundActionsMenu } from "@/components/admin/round-actions-menu";
import { CreateSurveyButton } from "@/app/admin/create-survey-button";
import {
  listRounds,
  groupRoundsBySurvey,
  type AdminRoundRow,
} from "@/lib/admin/rounds-queries";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";
import { formatAdminDateTime } from "@/lib/admin/datetime";

// This route reads cookies() (via getSignedInUser()) on every request,
// which alone makes it dynamic under next.config.ts's cacheComponents.
// `instant = false` only opts this segment out of Instant Navigation
// (prefetch); it has no effect on prerendering/caching eligibility. The
// admin guard itself lives in ./layout.tsx, which already redirects if
// there's no signed-in user -- this re-check is for session freshness
// (e.g. a concurrent sign-out), so it follows the same redirect-on-null
// pattern as src/app/page.tsx instead of optional-chaining past a state
// the rest of the app treats as impossible.
export const instant = false;

/**
 * One survey's 3 rounds (sessions), surveys v2 part B: "Round N · <session
 * title>", status, opens/closes, started/submitted counts, ⋯ menu.
 */
function SurveyRoundsTable({ rounds }: { rounds: AdminRoundRow[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableCaption className="sr-only">
          This survey&rsquo;s rounds, in session order
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Round</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Opens</TableHead>
            <TableHead>Closes</TableHead>
            <TableHead>Responses</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rounds.map((round) => (
            <TableRow key={round.id}>
              <TableCell className="whitespace-normal break-words p-2">
                <Link
                  href={`/admin/rounds/${round.id}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {round.sessionNumber != null
                    ? ADMIN_MESSAGES.roundRowLabel(
                        round.sessionNumber,
                        round.title
                      )
                    : round.title}
                </Link>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {ADMIN_MESSAGES.roundSummary(round.sectionCount)}
                </p>
              </TableCell>
              <TableCell className="p-2">
                <RoundStatusBadge status={round.status} />
              </TableCell>
              <TableCell className="p-2">
                {formatAdminDateTime(round.opensAt) ?? ADMIN_MESSAGES.notSet}
              </TableCell>
              <TableCell className="p-2">
                {formatAdminDateTime(round.closesAt) ??
                  (round.status === "open" || round.status === "scheduled"
                    ? ADMIN_MESSAGES.untilClosed
                    : ADMIN_MESSAGES.notSet)}
              </TableCell>
              <TableCell className="p-2">
                {ADMIN_MESSAGES.responsesCounts(
                  round.startedCount,
                  round.submittedCount
                )}
              </TableCell>
              <TableCell className="p-2 text-right">
                <RoundActionsMenu
                  roundId={round.id}
                  roundTitle={round.title}
                  status={round.status}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function AdminPage() {
  // cacheComponents + partialPrefetching still attempt a speculative
  // static-shell prerender pass for this route even though
  // getSignedInUser()/listRounds() below read cookies()/hit Supabase —
  // that alone doesn't stop Next from continuing to speculatively execute
  // the rest of the function during the shell pass, which hits an
  // unguarded `Date.now()` inside the Supabase client chain. Calling
  // `connection()` first (Next's own documented fix) forces per-request
  // rendering, skipping the shell-prerender attempt entirely — same fix
  // already applied to src/app/page.tsx and the /survey pages.
  await connection();

  const user = await getSignedInUser();
  if (!user) {
    redirect("/login");
  }

  const result = await listRounds();
  const surveys = result.ok ? groupRoundsBySurvey(result.rounds) : [];
  const [currentSurvey, ...pastSurveys] = surveys;

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12 dark:bg-black">
      <div className="flex w-full max-w-5xl flex-col gap-8">
        {!result.ok ? (
          <Card>
            <CardContent>
              <p role="alert">{ADMIN_MESSAGES.surveysLoadFailed}</p>
            </CardContent>
          </Card>
        ) : !currentSurvey ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h1 className="text-2xl font-semibold">
                {ADMIN_MESSAGES.noSurveysHeading}
              </h1>
              <CreateSurveyButton />
            </div>
            <Card>
              <CardContent>
                <p>{ADMIN_MESSAGES.noSurveysBody}</p>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h1 className="text-2xl font-semibold break-words">
                {currentSurvey.surveyTitle}
              </h1>
              <CreateSurveyButton />
            </div>

            <Card>
              <CardContent>
                <SurveyRoundsTable rounds={currentSurvey.rounds} />
              </CardContent>
            </Card>

            {pastSurveys.length > 0 ? (
              <div className="flex flex-col gap-6 border-t pt-8">
                <h2 className="text-lg font-semibold">
                  {ADMIN_MESSAGES.pastSurveysHeading}
                </h2>
                {pastSurveys.map((survey) => (
                  <div key={survey.surveyId} className="flex flex-col gap-2">
                    <h3 className="text-base font-semibold break-words">
                      {survey.surveyTitle}
                    </h3>
                    <Card>
                      <CardContent>
                        <SurveyRoundsTable rounds={survey.rounds} />
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
