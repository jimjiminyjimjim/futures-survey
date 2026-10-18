"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { PRESENTATION_MESSAGES } from "@/lib/presentation/messages";
import { buildDeckSteps } from "@/lib/presentation/build-slides";
import type { Slide } from "@/lib/presentation/types";
import { KeyQuestionTag, SlideView } from "./slides";

/** statement/choice/rating/two-ended slides carry a section label+title
 * (and optionally the key-question tag) that used to repeat inside every
 * slide body. It now lives once, top-right of the exit-presentation
 * chevron, at the same height. */
type SlideWithSection = Extract<
  Slide,
  { sectionLabel: string | null; sectionTitle: string; isKey: boolean }
>;

function hasSectionLabel(slide: Slide): slide is SlideWithSection {
  return (
    slide.kind === "statement" ||
    slide.kind === "choice" ||
    slide.kind === "rating" ||
    slide.kind === "two-ended"
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/** True when target sits inside a control whose own Space activation must
 * run exactly once, unduplicated by the deck's next(). */
function isInsideSpaceControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return (
    target.closest('a, button, [role="switch"], [role="button"]') !== null
  );
}

/** True when a click on target is a control's own click, not the slide
 * area's click-to-advance. */
function isInsideClickControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return (
    target.closest(
      'a, button, input, label, [role="switch"], [role="button"]'
    ) !== null
  );
}

export function PresentationDeck({ slides }: { slides: Slide[] }) {
  const steps = useMemo(() => buildDeckSteps(slides), [slides]);
  const [stepIndex, setStepIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const stepsLength = steps.length;

  const next = useCallback(() => {
    setStepIndex((i) => Math.min(i + 1, stepsLength - 1));
  }, [stepsLength]);

  const prev = useCallback(() => {
    setStepIndex((i) => Math.max(i - 1, 0));
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        next();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        prev();
        return;
      }
      if (event.key === " ") {
        if (isInsideSpaceControl(event.target)) {
          return;
        }
        event.preventDefault();
        next();
      }
      // Escape (and every other key) is never handled or prevented here.
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [next, prev]);

  const currentStep = steps[stepIndex];
  const current = slides[currentStep.slideIndex];
  const total = slides.length;
  // The counter/aria-label always reflect the SLIDE position, not the
  // step — a results slide's question/reveal steps both read the same
  // "N of total" so the count never seems to skip or stall.
  const counter = PRESENTATION_MESSAGES.slideCounter(
    currentStep.slideIndex + 1,
    total
  );
  const progressValue = Math.round((100 * (stepIndex + 1)) / stepsLength);

  return (
    <div
      ref={rootRef}
      className="dark fixed inset-0 z-50 flex flex-col overflow-hidden bg-pres-page text-pres-ink"
    >
      <Progress
        value={progressValue}
        aria-label="Slide progress"
        className="shrink-0 [&_[data-slot=progress-track]]:h-1 [&_[data-slot=progress-track]]:w-full [&_[data-slot=progress-track]]:rounded-none [&_[data-slot=progress-track]]:bg-pres-border [&_[data-slot=progress-indicator]]:bg-pres-ink"
      />

      <div className="flex items-center justify-between px-8 py-4 text-[17px] text-pres-ink-muted">
        <Link
          href="/admin"
          prefetch={false}
          aria-label={PRESENTATION_MESSAGES.backToRounds}
          className="inline-flex size-10 items-center justify-center rounded-md text-pres-ink-secondary transition-colors hover:text-pres-ink focus-visible:text-pres-ink focus-visible:ring-2 focus-visible:ring-pres-ink focus-visible:outline-none"
        >
          <ChevronLeft className="size-6" aria-hidden="true" />
        </Link>
        {hasSectionLabel(current) ? (
          <div className="flex items-center gap-3">
            <p>
              {current.sectionLabel ? `${current.sectionLabel}. ` : ""}
              {current.sectionTitle}
            </p>
            {current.isKey ? <KeyQuestionTag /> : null}
          </div>
        ) : null}
      </div>

      <section
        aria-roledescription="slide"
        aria-label={counter}
        className="min-h-0 flex-1 overflow-y-auto px-14 py-8"
        onClick={(event) => {
          if (isInsideClickControl(event.target)) {
            return;
          }
          next();
        }}
      >
        <SlideView slide={current} revealed={currentStep.revealed} />
      </section>
    </div>
  );
}
