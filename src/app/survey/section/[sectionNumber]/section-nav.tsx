"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

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

// Mirrors statement-form.tsx's isButtonTarget: a focused button's own
// native Enter-click already does the right thing (e.g. Enter on a
// focused Back button goes back, not forward), so the global Enter
// handler below must not also fire Continue in that case.
function isButtonTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "BUTTON" || target.getAttribute("role") === "button")
  );
}

/**
 * Section-break interstitial's Back/Continue controls. Enter activates
 * Continue from anywhere that isn't itself a focused button; ArrowLeft/
 * ArrowRight page-navigate like Back/Continue — same pattern as
 * statement-form.tsx's keyboard shortcuts.
 */
export function SectionNav({
  continueHref,
  backHref,
}: {
  continueHref: string;
  backHref: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isEditableTarget(event.target) ||
        isPending
      ) {
        return;
      }

      if (event.key === "Enter") {
        if (isButtonTarget(event.target)) {
          return;
        }
        event.preventDefault();
        startTransition(() => {
          router.push(continueHref);
        });
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        startTransition(() => {
          router.push(backHref);
        });
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        startTransition(() => {
          router.push(continueHref);
        });
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [continueHref, backHref, isPending, router, startTransition]);

  return (
    <div className="flex justify-between gap-4 pt-4">
      <Button
        type="button"
        variant="outline"
        className="h-11 px-4 text-base"
        disabled={isPending}
        onClick={() => {
          startTransition(() => {
            router.push(backHref);
          });
        }}
      >
        {SURVEY_MESSAGES.back}
      </Button>
      <Button
        type="button"
        variant="default"
        className="h-11 px-4 text-base"
        disabled={isPending}
        onClick={() => {
          startTransition(() => {
            router.push(continueHref);
          });
        }}
      >
        {SURVEY_MESSAGES.continueCta}
      </Button>
    </div>
  );
}
