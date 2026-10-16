import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";

// No "use client", no next/link, no data fetching — both screens below are
// pure markup so they render identically via renderToStaticMarkup in a
// node test (tests/api/survey-state.spec.ts) as they do in the app.

export function NoOpenRoundScreen() {
  return (
    <Empty className="max-w-md">
      <EmptyHeader>
        <EmptyTitle
          role="heading"
          aria-level={1}
          className="text-lg font-semibold tracking-normal"
        >
          {SURVEY_MESSAGES.noRoundHeading}
        </EmptyTitle>
        <EmptyDescription>{SURVEY_MESSAGES.noRoundBody}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function SurveyErrorScreen() {
  return (
    <Empty className="max-w-md">
      <EmptyHeader>
        <EmptyTitle
          role="heading"
          aria-level={1}
          className="text-lg font-semibold tracking-normal"
        >
          {SURVEY_MESSAGES.surveyErrorHeading}
        </EmptyTitle>
        <EmptyDescription>{SURVEY_MESSAGES.surveyErrorBody}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function ThanksScreen() {
  return (
    <Empty className="max-w-md">
      <EmptyHeader>
        <EmptyTitle
          role="heading"
          aria-level={1}
          className="text-lg font-semibold tracking-normal"
        >
          {SURVEY_MESSAGES.thanksHeading}
        </EmptyTitle>
        <EmptyDescription>{SURVEY_MESSAGES.thanksBody}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
