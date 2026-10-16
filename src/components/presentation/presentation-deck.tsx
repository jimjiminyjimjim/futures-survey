"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Progress } from "@/components/ui/progress";
import { PRESENTATION_MESSAGES } from "@/lib/presentation/messages";
import type { Slide } from "@/lib/presentation/types";
import { SlideView } from "./slides";

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
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const length = slides.length;

  const next = useCallback(() => {
    setIndex((i) => Math.min(i + 1, length - 1));
  }, [length]);

  const prev = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
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

  const current = slides[index];
  const total = length;
  const counter = PRESENTATION_MESSAGES.slideCounter(index + 1, total);
  const progressValue = Math.round((100 * (index + 1)) / total);

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

      <div className="flex items-center justify-between px-8 py-4 text-[20px] text-pres-ink-muted">
        <Link
          href="/admin"
          prefetch={false}
          className="inline-flex items-center gap-1 text-pres-ink-secondary transition-colors hover:text-pres-ink focus-visible:text-pres-ink focus-visible:ring-2 focus-visible:ring-pres-ink focus-visible:outline-none"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
          {PRESENTATION_MESSAGES.backToRounds}
        </Link>
      </div>

      <section
        aria-roledescription="slide"
        aria-label={counter}
        className="min-h-0 flex-1 overflow-y-auto px-16 py-16"
        onClick={(event) => {
          if (isInsideClickControl(event.target)) {
            return;
          }
          next();
        }}
      >
        <SlideView slide={current} />
      </section>

      <div className="flex shrink-0 items-center justify-between gap-4 px-8 py-4 text-[20px] text-pres-ink-muted">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 border-pres-border bg-transparent text-pres-ink-muted hover:bg-pres-surface hover:text-pres-ink focus-visible:ring-pres-ink"
          aria-label={PRESENTATION_MESSAGES.previousSlide}
          disabled={index === 0}
          onClick={prev}
        >
          <ChevronLeft />
        </Button>

        <div className="flex items-center gap-4">
          <p aria-live="polite" className="tabular-nums">
            {counter}
          </p>
          <Kbd className="bg-pres-surface text-pres-ink-secondary">
            {PRESENTATION_MESSAGES.keyboardHint}
          </Kbd>
        </div>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 border-pres-border bg-transparent text-pres-ink-muted hover:bg-pres-surface hover:text-pres-ink focus-visible:ring-pres-ink"
          aria-label={PRESENTATION_MESSAGES.nextSlide}
          disabled={index === total - 1}
          onClick={next}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
