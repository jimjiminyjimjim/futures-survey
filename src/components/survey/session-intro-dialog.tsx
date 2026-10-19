"use client";

import { Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

/**
 * Mid-survey "About this session" dialog — the same survey title / round
 * title / part label / intro copy as the start screen in src/app/page.tsx,
 * reachable from every /survey page. Opening and closing only toggles the
 * overlay: no navigation, no router calls, no data writes, so resume
 * state and the participant's answers are untouched.
 */
export function SessionIntroDialog({
  surveyTitle,
  roundTitle,
  partLabel,
  intro,
}: {
  surveyTitle: string | null;
  roundTitle: string;
  partLabel: string | null;
  intro: string | null;
}) {
  return (
    <Dialog>
      <DialogTrigger
        className="inline-flex items-center gap-1.5 rounded-md font-medium text-zinc-400 hover:text-white focus-visible:text-white focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label={SURVEY_MESSAGES.sessionIntroOpen}
      >
        <Info className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">{SURVEY_MESSAGES.sessionIntroOpen}</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          {surveyTitle ? (
            <p className="text-sm text-muted-foreground">{surveyTitle}</p>
          ) : null}
          <DialogTitle className="text-xl leading-tight font-semibold">
            {roundTitle}
          </DialogTitle>
          {partLabel ? <DialogDescription>{partLabel}</DialogDescription> : null}
          {intro ? <p className="text-base">{intro}</p> : null}
        </DialogHeader>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
