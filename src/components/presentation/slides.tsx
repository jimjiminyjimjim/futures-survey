"use client";

import { PRESENTATION_MESSAGES } from "@/lib/presentation/messages";
import { formatNetAgreement, netAgreement } from "@/lib/presentation/chart-math";
import type { Slide } from "@/lib/presentation/types";
import { DistributionChart } from "./distribution-chart";
import { RankingChart } from "./ranking-chart";

export function SlideView({ slide }: { slide: Slide }) {
  switch (slide.kind) {
    case "title":
      return (
        <div className="flex h-full flex-col justify-center">
          <h1 className="text-[80px] leading-[1.05] font-semibold break-words">
            {slide.roundTitle}
          </h1>
          <p className="mt-24 text-[20px] text-pres-ink-secondary">
            {PRESENTATION_MESSAGES.respondents(slide.respondentCount)}
          </p>
        </div>
      );

    case "section-intro":
      return (
        <div className="flex h-full flex-col justify-center">
          <h2 className="text-[48px] leading-[1.15] font-semibold">
            {slide.sectionTitle}
          </h2>
          <p className="mt-4 max-w-4xl text-[28px] leading-[1.5] text-pres-ink-secondary">
            {slide.sectionPrompt}
          </p>
          <div className="mt-12 flex flex-col gap-2 text-[20px] text-pres-ink-muted">
            <p>{PRESENTATION_MESSAGES.statements(slide.statementCount)}</p>
            <p>{PRESENTATION_MESSAGES.respondents(slide.respondentCount)}</p>
          </div>
        </div>
      );

    case "statement": {
      const net =
        slide.scaleKey === "agreement"
          ? netAgreement(slide.options, slide.respondentCount)
          : null;
      const isEmpty = slide.respondentCount === 0;

      return (
        <div className="flex h-full flex-col justify-center gap-4">
          <p className="text-[20px] text-pres-ink-muted">
            {slide.sectionTitle}
          </p>
          <h2 className="max-w-5xl text-[28px] leading-[1.5] font-normal break-words">
            {slide.text}
          </h2>
          <div className="mt-4">
            <DistributionChart
              variant={slide.scaleKey === "agreement" ? "diverging" : "ordered"}
              options={slide.options}
              respondentCount={slide.respondentCount}
            />
          </div>
          <div className="mt-6">
            {isEmpty ? (
              <>
                <p className="text-[48px] leading-[1.15] font-semibold">
                  {PRESENTATION_MESSAGES.emptyHeading}
                </p>
                <p className="mt-2 max-w-3xl text-[28px] leading-[1.5] text-pres-ink-secondary">
                  {PRESENTATION_MESSAGES.emptyBody}
                </p>
              </>
            ) : slide.scaleKey === "agreement" && net !== null ? (
              <p className="text-[48px] leading-[1.15] font-semibold">
                {formatNetAgreement(net)}
              </p>
            ) : null}
          </div>
          <p className="text-[20px] text-pres-ink-muted">
            {PRESENTATION_MESSAGES.respondents(slide.respondentCount)}
          </p>
        </div>
      );
    }

    case "familiarity-overview": {
      const isEmpty = slide.respondentCount === 0;
      return (
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div>
            <h2 className="text-[48px] leading-[1.15] font-semibold">
              {PRESENTATION_MESSAGES.overviewTitle}
            </h2>
            <p className="mt-1 text-[20px] text-pres-ink-muted">
              {PRESENTATION_MESSAGES.overviewSubtitle(slide.sectionSortOrder)}
            </p>
          </div>
          {isEmpty ? (
            <p className="text-[48px] leading-[1.15] font-semibold">
              {PRESENTATION_MESSAGES.emptyHeading}
            </p>
          ) : null}
          <div className="min-h-0 flex-1">
            <RankingChart terms={slide.terms} />
          </div>
          <p className="text-[20px] text-pres-ink-muted">
            {PRESENTATION_MESSAGES.respondents(slide.respondentCount)}
          </p>
        </div>
      );
    }

    default:
      return null;
  }
}
