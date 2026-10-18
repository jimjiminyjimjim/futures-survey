import { redirect, notFound } from "next/navigation";
import { connection } from "next/server";
import { Card, CardContent } from "@/components/ui/card";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { getSignedInUser } from "@/lib/auth/session";
import { getSurveySnapshot } from "@/lib/survey/queries";
import {
  buildSectionSummaries,
  parentSectionHeading,
  resolveStatementNav,
  sectionHeading,
} from "@/lib/survey/state";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import { SourceLine } from "@/components/survey/source-line";
import { StatementForm } from "./statement-form";
import { MultiChoiceForm } from "./multi-choice-form";
import { PredictionForm } from "./prediction-form";
import { RatingForm } from "./rating-form";
import { TwoEndedForm } from "./two-ended-form";

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

  const saved = snapshot.answers.get(statement.id);
  const statementTextId = `statement-${statement.id}`;
  const parentLine = parentSectionHeading(
    statement.sectionLabel,
    statement.sectionParentTitle
  );
  // The section prompt ("how much do you agree…") only frames scale and
  // rating questions that don't carry their own `question` override;
  // choice, prediction and two_ended questions carry their own wording.
  const showPrompt =
    (statement.kind === "scale" || statement.kind === "rating") &&
    !statement.question;
  const formKey = `${statement.id}`;

  let form: React.ReactNode;
  if (
    statement.kind === "choice_multi" ||
    statement.kind === "choice_exact" ||
    statement.kind === "choice_up_to"
  ) {
    form = (
      <MultiChoiceForm
        key={formKey}
        statementId={statement.id}
        labelledById={statementTextId}
        mode={
          statement.kind === "choice_exact"
            ? "exact"
            : statement.kind === "choice_up_to"
              ? "upTo"
              : "multi"
        }
        options={statement.options}
        choiceCount={statement.choiceCount}
        initialValues={saved?.choiceValues ?? null}
        prevHref={nav.prevHref}
        nextHref={nav.nextHref}
      />
    );
  } else if (statement.kind === "prediction") {
    form = (
      <PredictionForm
        key={formKey}
        statementId={statement.id}
        labelledById={statementTextId}
        initialValue={saved?.value ?? null}
        prevHref={nav.prevHref}
        nextHref={nav.nextHref}
      />
    );
  } else if (statement.kind === "rating") {
    form = (
      <RatingForm
        key={formKey}
        statementId={statement.id}
        labelledById={statementTextId}
        leftLabel={statement.leftLabel ?? ""}
        rightLabel={statement.rightLabel ?? ""}
        initialValue={saved?.value ?? null}
        prevHref={nav.prevHref}
        nextHref={nav.nextHref}
      />
    );
  } else if (statement.kind === "two_ended") {
    form = (
      <TwoEndedForm
        key={formKey}
        statementId={statement.id}
        labelledById={statementTextId}
        leftLabel={statement.leftLabel ?? ""}
        rightLabel={statement.rightLabel ?? ""}
        initialValue={saved?.value ?? null}
        prevHref={nav.prevHref}
        nextHref={nav.nextHref}
      />
    );
  } else {
    form = (
      <StatementForm
        key={formKey}
        statementId={statement.id}
        labelledById={statementTextId}
        options={statement.options}
        initialValue={saved?.value ?? null}
        prevHref={nav.prevHref}
        nextHref={nav.nextHref}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-black px-4 py-8">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div>
          {parentLine ? (
            <p className="text-sm text-zinc-400 break-words">{parentLine}</p>
          ) : null}
          <h1 className="text-lg font-semibold break-words text-white">
            {sectionHeading(statement.sectionLabel, statement.sectionTitle)}
          </h1>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-6">
            <Progress value={position} max={total} min={0} className="w-full flex-col items-stretch gap-1.5">
              <ProgressLabel className="text-sm text-zinc-600 dark:text-zinc-400">
                {SURVEY_MESSAGES.sectionProgress(
                  nav.position.sectionNumber,
                  nav.position.totalSections,
                  nav.position.positionInSection,
                  nav.position.countInSection,
                  nav.position.sectionLabel
                )}
              </ProgressLabel>
            </Progress>
            {showPrompt ? (
              <p className="text-base text-zinc-600 dark:text-zinc-400 break-words">
                {statement.sectionPrompt}
              </p>
            ) : null}
            {statement.kind === "prediction" && statement.predictionOf ? (
              <blockquote className="border-l-2 pl-3 text-base text-zinc-600 dark:text-zinc-400 break-words">
                <span className="block text-sm">
                  {SURVEY_MESSAGES.predictionAbout}
                </span>
                {`“${statement.predictionOf.text}”`}
              </blockquote>
            ) : null}
            <SourceLine
              statementKey={statement.key}
              label={statement.label}
              context={statement.context}
              className="text-base text-zinc-600 dark:text-zinc-400 break-words"
              logoClassName="h-8"
            />
            <p
              id={statementTextId}
              className="text-lg font-semibold leading-tight break-words"
            >
              {statement.text}
            </p>
            {statement.question ? (
              <p className="text-base font-medium break-words">
                {statement.question}
              </p>
            ) : null}
            {form}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
