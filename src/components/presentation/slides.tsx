"use client";

import { Badge } from "@/components/ui/badge";
import { PRESENTATION_MESSAGES } from "@/lib/presentation/messages";
import {
  optionPercent,
} from "@/lib/presentation/chart-math";
import type { Slide } from "@/lib/presentation/types";
import { SourceLine } from "@/components/survey/source-line";
import { ResultRows, type ResultRow } from "./result-rows";
import { RatingColumns } from "./rating-columns";
import { TwoEndedScale } from "./two-ended-scale";

export function KeyQuestionTag() {
  return (
    <Badge variant="secondary" className="shrink-0">
      {PRESENTATION_MESSAGES.keyQuestionTag}
    </Badge>
  );
}

/**
 * Wraps a results slide's revealed content: invisible + aria-hidden while
 * not revealed, fades in once revealed. Used for every results kind so
 * the question header never shifts when results appear (the wrapper
 * always occupies its layout space).
 */
function RevealedArea({
  revealed,
  className,
  children,
}: {
  revealed: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const base = revealed ? "animate-in fade-in duration-300" : "invisible";
  return (
    <div aria-hidden={!revealed} className={className ? `${base} ${className}` : base}>
      {children}
    </div>
  );
}

/** Presentation-only reveal text ("the fact"), with the accent rule on the
 * left. Sits under the chart, smaller than the result copy so the chart
 * stays the focus of the slide. */
function RevealText({ text }: { text: string }) {
  return (
    <p className="max-w-4xl border-l-4 border-pres-accent pl-6 text-[18px] leading-[1.45] text-pres-ink-secondary">
      {text}
    </p>
  );
}

export function SlideView({
  slide,
  revealed,
}: {
  slide: Slide;
  revealed: boolean;
}) {
  switch (slide.kind) {
    case "title":
      return (
        <div className="flex h-full flex-col justify-center-safe">
          <h1 className="text-[68px] leading-[1.05] font-semibold break-words">
            {slide.roundTitle}
          </h1>
        </div>
      );

    case "section-intro":
      return (
        <div className="flex h-full flex-col justify-center-safe">
          {slide.parentTitle ? (
            <p className="text-[17px] text-pres-ink-muted">
              {slide.parentLabel ? `${slide.parentLabel}. ` : ""}
              {slide.parentTitle}
            </p>
          ) : null}
          <h2 className="mt-2 text-[41px] leading-[1.15] font-semibold">
            {slide.label ? `${slide.label}. ` : ""}
            {slide.sectionTitle}
          </h2>
          <p className="mt-4 max-w-4xl text-[24px] leading-[1.5] text-pres-ink-secondary">
            {slide.sectionPrompt}
          </p>
        </div>
      );

    case "statement": {
      const isEmpty = slide.respondentCount === 0;
      const rows: ResultRow[] = slide.options.map((o) => ({
        key: String(o.value),
        label: o.label,
        count: o.count,
        percent: optionPercent(o.count, slide.respondentCount),
      }));
      return (
        <div className="mx-auto flex h-full w-full max-w-6xl flex-col justify-center-safe gap-6">
          <h2 className="max-w-5xl text-[44px] leading-[1.15] font-semibold break-words">
            {slide.text}
          </h2>
          <RevealedArea revealed={revealed}>
            {isEmpty ? (
              <div className="mt-4">
                <p className="text-[41px] leading-[1.15] font-semibold">
                  {PRESENTATION_MESSAGES.emptyHeading}
                </p>
                <p className="mt-2 max-w-3xl text-[24px] leading-[1.5] text-pres-ink-secondary">
                  {PRESENTATION_MESSAGES.emptyBody}
                </p>
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-6">
                <ResultRows
                  rows={rows}
                  ariaLabel={PRESENTATION_MESSAGES.breakdownLabel}
                />
                {slide.revealText ? <RevealText text={slide.revealText} /> : null}
              </div>
            )}
          </RevealedArea>
        </div>
      );
    }

    case "choice": {
      const isEmpty = slide.respondentCount === 0;
      const subtitle =
        slide.choiceKind === "choice_one"
          ? PRESENTATION_MESSAGES.pickOne
          : slide.choiceKind === "choice_multi"
            ? PRESENTATION_MESSAGES.pickMulti
            : slide.choiceKind === "choice_up_to"
              ? PRESENTATION_MESSAGES.pickUpTo(slide.choiceCount ?? 0)
              : PRESENTATION_MESSAGES.pickExact(slide.choiceCount ?? 0);
      const rows: ResultRow[] = slide.options.map((o) => ({
        key: String(o.value),
        label: o.label,
        count: o.count,
        percent: o.percent,
      }));
      const maxPercent = Math.max(100, ...slide.options.map((o) => o.percent));
      const note =
        slide.choiceKind !== "choice_one"
          ? PRESENTATION_MESSAGES.multiPickNote
          : undefined;

      return (
        <div className="mx-auto flex h-full w-full max-w-6xl flex-col justify-center-safe gap-6">
          <h2 className="max-w-5xl text-[44px] leading-[1.15] font-semibold break-words">
            {slide.text}
          </h2>
          <p className="text-[17px] text-pres-ink-secondary">{subtitle}</p>
          <RevealedArea revealed={revealed}>
            <div className="flex flex-col gap-6">
              {isEmpty ? (
                <div className="mt-4">
                  <p className="text-[41px] leading-[1.15] font-semibold">
                    {PRESENTATION_MESSAGES.emptyHeading}
                  </p>
                  <p className="mt-2 max-w-3xl text-[24px] leading-[1.5] text-pres-ink-secondary">
                    {PRESENTATION_MESSAGES.emptyBody}
                  </p>
                </div>
              ) : (
                <div className="mt-4">
                  <ResultRows
                    rows={rows}
                    ariaLabel={PRESENTATION_MESSAGES.choiceBreakdownLabel}
                    maxPercent={maxPercent}
                    note={note}
                  />
                </div>
              )}
              {slide.revealText ? <RevealText text={slide.revealText} /> : null}
            </div>
          </RevealedArea>
        </div>
      );
    }

    case "rating": {
      const average = slide.average;
      return (
        <div className="mx-auto flex h-full w-full max-w-6xl flex-col justify-center-safe gap-4">
          <SourceLine
            statementKey={slide.statementKey}
            label={slide.itemLabel}
            context={slide.context}
            className="text-[24px] leading-[1.4] text-pres-ink-secondary"
            logoClassName="h-12 rounded-md bg-white p-1"
          />
          {slide.leadIn ? (
            <p className="max-w-5xl text-[24px] leading-[1.4] text-pres-ink-secondary">
              {slide.leadIn}
            </p>
          ) : null}
          <h2 className="max-w-5xl text-[44px] leading-[1.15] font-semibold break-words">
            {slide.text}
          </h2>
          {slide.question ? (
            <p className="max-w-5xl text-[24px] leading-[1.4] text-pres-ink-secondary">
              {slide.question}
            </p>
          ) : null}
          <RevealedArea revealed={revealed}>
            <div className="mt-1 flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <p className="text-[17px] text-pres-ink-muted">
                  {average != null
                    ? PRESENTATION_MESSAGES.ratingAverage(average)
                    : PRESENTATION_MESSAGES.emptyHeading}
                </p>
                <RatingColumns
                  options={slide.options}
                  leftLabel={slide.leftLabel}
                  rightLabel={slide.rightLabel}
                  ariaLabel={PRESENTATION_MESSAGES.ratingBreakdownLabel}
                />
              </div>
              {slide.revealText ? <RevealText text={slide.revealText} /> : null}
            </div>
          </RevealedArea>
        </div>
      );
    }

    case "two-ended": {
      return (
        <div className="mx-auto flex h-full w-full max-w-6xl flex-col justify-center-safe gap-6">
          <h2 className="max-w-5xl text-[44px] leading-[1.15] font-semibold break-words">
            {slide.text}
          </h2>
          <RevealedArea revealed={revealed}>
            <div className="mt-4 flex flex-col gap-8">
              <TwoEndedScale
                average={slide.average}
                buckets={slide.buckets}
                leftLabel={slide.leftLabel}
                rightLabel={slide.rightLabel}
                ariaLabel={PRESENTATION_MESSAGES.twoEndedLabel}
              />
              {slide.revealText ? <RevealText text={slide.revealText} /> : null}
            </div>
          </RevealedArea>
        </div>
      );
    }

    case "prediction": {
      const noGuesses = slide.guessCount === 0;
      const noActual = slide.actualRespondentCount === 0;

      return (
        <div className="flex h-full flex-col justify-center-safe gap-6">
          {slide.isKey ? (
            <div>
              <KeyQuestionTag />
            </div>
          ) : null}
          <h2 className="max-w-5xl text-[44px] leading-[1.15] font-semibold break-words">
            {PRESENTATION_MESSAGES.weAsked(slide.targetText)}
          </h2>
          <RevealedArea revealed={revealed}>
            <div className="mt-4 grid grid-cols-2 gap-8">
              <div>
                <p className="text-[54px] leading-[1.1] font-bold tabular-nums">
                  {noGuesses
                    ? PRESENTATION_MESSAGES.noGuessesYet
                    : `${slide.averageGuess}%`}
                </p>
                <p className="mt-1 text-[20px] text-pres-ink-secondary">
                  {PRESENTATION_MESSAGES.averageGuessHeading}
                </p>
              </div>
              <div>
                <p className="text-[54px] leading-[1.1] font-bold tabular-nums">
                  {noActual
                    ? PRESENTATION_MESSAGES.emptyHeading
                    : `${slide.actualAgreePercent}%`}
                </p>
                <p className="mt-1 text-[20px] text-pres-ink-secondary">
                  {PRESENTATION_MESSAGES.actualAgreedHeading}
                </p>
              </div>
            </div>
          </RevealedArea>
        </div>
      );
    }

    case "discussion":
      return (
        <div className="flex h-full flex-col items-center justify-center-safe gap-8 text-center">
          <p className="max-w-4xl text-[41px] leading-[1.15] font-semibold">
            &ldquo;{slide.quote}&rdquo;
          </p>
          {slide.attribution ? (
            <p className="text-[24px] leading-[1.5] text-pres-ink-secondary">
              — {slide.attribution}
            </p>
          ) : null}
        </div>
      );

    case "familiarity-overview": {
      const isEmpty = slide.respondentCount === 0;
      const rows: ResultRow[] = slide.terms.map((term) => ({
        key: term.statementKey,
        label: term.text,
        count: term.explainCount,
        percent: term.explainPercent,
      }));
      return (
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div>
            <h2 className="text-[41px] leading-[1.15] font-semibold">
              {PRESENTATION_MESSAGES.overviewTitle}
            </h2>
            <p className="mt-1 text-[17px] text-pres-ink-muted">
              {PRESENTATION_MESSAGES.overviewSubtitle(
                slide.sectionLabel ?? null,
                slide.sectionSortOrder
              )}
            </p>
          </div>
          <RevealedArea
            revealed={revealed}
            className="flex min-h-0 flex-1 flex-col gap-4"
          >
            {isEmpty ? (
              <p className="text-[41px] leading-[1.15] font-semibold">
                {PRESENTATION_MESSAGES.emptyHeading}
              </p>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ResultRows rows={rows} ariaLabel={PRESENTATION_MESSAGES.rankingLabel} />
            </div>
          </RevealedArea>
        </div>
      );
    }

    default:
      return null;
  }
}
