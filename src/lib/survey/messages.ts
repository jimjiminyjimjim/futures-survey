/**
 * User-facing survey message constants, shared between server actions,
 * pages and their tests. Copy is verbatim from
 * .planning/phases/02-participant-survey-privacy/02-UI-SPEC.md's
 * Copywriting Contract. Later plans (02-02/02-03) extend this object.
 */
export const SURVEY_MESSAGES = {
  saveFailed:
    "We couldn't save that answer. Check your connection and try again.",
  alreadySubmitted:
    "This round has already been submitted, so this answer can't be changed.",
  beginCta: "Begin survey",
  back: "Back",
  next: "Next",
  submit: "Submit",
  continueCta: "Continue",
  /** Section-break interstitial heading, e.g. "Section 2 of 7". */
  sectionOf: (sectionNumber: number, totalSections: number) =>
    `Section ${sectionNumber} of ${totalSections}`,
  /**
   * Per-statement progress text: overall position is still conveyed by the
   * Progress bar itself (answered/total), this text gives the
   * section-relative read, e.g. "Section 2 of 7 · Question 3 of 8".
   */
  sectionProgress: (
    sectionNumber: number,
    totalSections: number,
    questionInSection: number,
    questionsInSection: number
  ) =>
    `Section ${sectionNumber} of ${totalSections} · Question ${questionInSection} of ${questionsInSection}`,
  noRoundHeading: "No survey is open right now",
  noRoundBody:
    "When a new round opens, it'll appear here next time you sign in.",
  surveyErrorHeading: "Something went wrong",
  surveyErrorBody:
    "We couldn't load the survey. Check your connection and try again.",
  thanksHeading: "Thanks — you're done",
  thanksBody:
    "Your answers have been submitted for this round. We'll show the next round here when it opens.",
  keyboardHint: (n: number) =>
    `Press 1–${n} to choose, Enter to submit, ← → to move between statements`,
  reviewHeading: "Review and submit",
  reviewAnswered: (a: number, t: number) =>
    `You've answered ${a} of ${t} statements.`,
  reviewRemaining: (n: number) => `${n} left to go`,
  reviewFirstUnanswered: "Go to the first unanswered statement",
  submitCta: "Submit answers",
  incompleteSubmit: (n: number) =>
    `Answer every statement before submitting — ${n} left to go.`,
  submitFailed:
    "We couldn't submit your answers. Check your connection and try again.",
} as const;
