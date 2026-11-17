import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import { NavButton } from "@/components/survey/nav-button";

/**
 * The survey start card ("Begin"). Shared by the live home page and the
 * admin test start page for an unopened draft (quick task 261117-it4).
 * Markup is unchanged from the original home page.
 */
export function StartCard({
  surveyTitle,
  roundTitle,
  partText,
  intro,
  beginHref,
}: {
  surveyTitle: string | null;
  roundTitle: string;
  /** "Part 1 of 3" (with an intro) or "Part 1 of 3 · 6 questions". */
  partText: string | null;
  intro: string | null;
  /** Always section 1's break screen. */
  beginHref: string;
}) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        {surveyTitle ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {surveyTitle}
          </p>
        ) : null}
        <CardTitle
          role="heading"
          aria-level={1}
          className="text-2xl font-semibold"
        >
          {roundTitle}
        </CardTitle>
        <CardDescription className="text-base">{partText}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {intro ? <p className="text-base">{intro}</p> : null}
        {/* Nothing answered yet: always section 1's break screen, never
            straight to the first statement — the section-break
            interstitial feature wires "Begin" through the section
            screens, not directly to a statement. */}
        <NavButton href={beginHref}>{SURVEY_MESSAGES.beginCta}</NavButton>
      </CardContent>
    </Card>
  );
}
