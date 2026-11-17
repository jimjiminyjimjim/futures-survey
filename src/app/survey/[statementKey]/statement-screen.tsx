import { redirect, notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import type { SurveySnapshot } from "@/lib/survey/queries";
import {
  buildSectionSummaries,
  displayLabel,
  parentSectionHeading,
  resolveStatementNav,
  sectionHeading,
  visibleSectionPrompt,
} from "@/lib/survey/state";
import { statementHref, type SurveyPaths } from "@/lib/survey/paths";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import { SourceLine } from "@/components/survey/source-line";
import { StatementForm } from "./statement-form";
import { MultiChoiceForm } from "./multi-choice-form";
import { PredictionForm } from "./prediction-form";
import { RankingForm } from "./ranking-form";
import { cn } from "@/lib/utils";
import { RatingForm } from "./rating-form";
import { TwoEndedForm } from "./two-ended-form";
import { GroupedRatingForm, type GroupedRatingRow } from "./grouped-rating-form";

/**
 * One statement screen (or a grouped section's single page). Shared by the
 * live /survey/[statementKey] route and the admin test route for an
 * unopened draft (quick task 261117-it4): the caller loads the snapshot and
 * passes the route helpers, so every href and guard redirect stays inside
 * the survey that is running. Markup is unchanged from the original page.
 */
export function StatementScreen({
  snapshot,
  statementKey,
  paths,
}: {
  snapshot: SurveySnapshot;
  statementKey: string;
  paths: SurveyPaths;
}) {
  if (!snapshot.openRound || snapshot.response?.submittedAt) {
    redirect(paths.home);
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
  const nav = resolveStatementNav(sections, statementKey, paths);
  // Unreachable in practice: statementKey was just found in
  // snapshot.statements above, and buildSectionSummaries groups every one
  // of those statements into a section.
  if (!nav) {
    notFound();
  }

  const section = sections.find((s) => s.statementKeys.includes(statementKey));

  if (section?.grouped) {
    // A grouped section has ONE canonical route: its first key. Any other
    // key in it redirects there, so every existing link (resume, the
    // section-break screen's Back/Continue, old bookmarks) still lands
    // correctly.
    if (statementKey !== section.statementKeys[0]) {
      redirect(statementHref(paths, section.statementKeys[0]));
    }

    const groupStatements = snapshot.statements.filter(
      (s) => s.sectionId === section.sectionId
    );
    const groupParentLine = parentSectionHeading(
      section.label,
      section.parentTitle
    );
    const rows: GroupedRatingRow[] = groupStatements.map((s) => ({
      statementId: s.id,
      textId: `statement-${s.id}`,
      text: s.text,
      leftLabel: s.leftLabel ?? "",
      rightLabel: s.rightLabel ?? "",
      initialValue: snapshot.answers.get(s.id)?.value ?? null,
      optional: s.optional,
    }));
    const lastGroupStatement = groupStatements[groupStatements.length - 1];

    return (
      <div className="flex flex-1 flex-col items-center bg-black px-4 py-8">
        <div className="flex w-full max-w-md flex-col gap-6">
          <div>
            {groupParentLine ? (
              <p className="text-sm text-zinc-400 break-words">{groupParentLine}</p>
            ) : null}
            <h1 className="text-lg font-semibold break-words text-white">
              {sectionHeading(section.label, section.title)}
            </h1>
          </div>
          <Card>
            <CardContent className="flex flex-col gap-6">
              <Progress
                value={lastGroupStatement.position}
                max={total}
                min={0}
                className="w-full flex-col items-stretch gap-1.5"
              >
                <ProgressLabel className="text-sm text-zinc-600 dark:text-zinc-400">
                  {SURVEY_MESSAGES.groupedProgress(
                    nav.position.questionNumber,
                    nav.position.totalQuestions,
                    groupStatements.length,
                    displayLabel(nav.position.sectionLabel)
                  )}
                </ProgressLabel>
              </Progress>
              <p className="text-base text-zinc-600 dark:text-zinc-400 break-words">
                {section.prompt}
              </p>
              <GroupedRatingForm
                rows={rows}
                prevHref={nav.prevHref}
                nextHref={nav.nextHref}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    );
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
  // When the section prompt only repeats the section title (Session 2's D),
  // visibleSectionPrompt is null and the prompt is not shown twice.
  const promptToShow = visibleSectionPrompt(
    statement.sectionTitle,
    statement.sectionPrompt
  );
  const showPrompt =
    (statement.kind === "scale" || statement.kind === "rating") &&
    !statement.question &&
    promptToShow !== null;
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
  } else if (statement.kind === "ranking") {
    form = (
      <RankingForm
        key={formKey}
        statementId={statement.id}
        labelledById={statementTextId}
        options={statement.options}
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
      {/* Ranking rows hold long statements, so they get a wider column. */}
      <div
        className={cn(
          "flex w-full flex-col gap-6",
          statement.kind === "ranking" ? "max-w-2xl" : "max-w-md"
        )}
      >
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
                  nav.position.questionNumber,
                  nav.position.totalQuestions,
                  nav.position.positionInSection,
                  nav.position.countInSection,
                  displayLabel(nav.position.sectionLabel)
                )}
              </ProgressLabel>
            </Progress>
            {showPrompt ? (
              <p className="text-base text-zinc-600 dark:text-zinc-400 break-words">
                {promptToShow}
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
