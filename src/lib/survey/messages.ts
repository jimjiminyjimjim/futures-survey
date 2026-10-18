/**
 * User-facing survey message constants, shared between server actions,
 * pages and their tests. Copy is verbatim from
 * .planning/phases/02-participant-survey-privacy/02-UI-SPEC.md's
 * Copywriting Contract. Later plans (02-02/02-03, 261018-qck) extend this
 * object.
 */

/** Wording version recorded on every results_consent row. */
export const RESULTS_CONSENT_VERSION = "2026-10-18";

export const SURVEY_MESSAGES = {
  saveFailed:
    "We couldn't save that answer. Check your connection and try again.",
  alreadySubmitted:
    "This session has already been submitted, so this answer can't be changed.",
  beginCta: "Begin survey",
  back: "Back",
  next: "Next",
  submit: "Submit",
  continueCta: "Continue",
  skip: "Skip",
  /** Question-break eyebrow, e.g. "Question 3 of 6". (User language: the
   * questionnaire has 3 parts; each part has numbered questions — 1, 2a,
   * 2b … — and each question has statements.) */
  sectionOf: (sectionNumber: number, totalSections: number) =>
    `Question ${sectionNumber} of ${totalSections}`,
  /** Per-statement progress, e.g. "Question 2a · 3 of 9". */
  sectionProgress: (
    sectionNumber: number,
    totalSections: number,
    questionInSection: number,
    questionsInSection: number,
    sectionLabel?: string | null
  ) =>
    `Question ${sectionLabel ?? `${sectionNumber} of ${totalSections}`} · ${questionInSection} of ${questionsInSection}`,
  noRoundHeading: "No session is open right now",
  noRoundBody:
    "When the next session opens, it'll appear here next time you sign in.",
  surveyErrorHeading: "Something went wrong",
  surveyErrorBody:
    "We couldn't load the survey. Check your connection and try again.",
  thanksHeading: "Thanks — you've finished this session.",
  thanksBody: "The next session will appear here when it opens.",
  keyboardHint: (n: number) =>
    `Press 1–${n} to choose, Enter to submit, ← → to move between questions`,
  /** choice_multi helper text. */
  pickAllThatApply: "Pick all that apply.",
  /** choice_exact helper text, e.g. "Pick 3 · 2 chosen". */
  pickExactly: (count: number, chosen: number) =>
    `Pick ${count} · ${chosen} chosen`,
  pickMore: (n: number) => `Pick ${n} more to submit.`,
  /** prediction copy. */
  predictionAbout: "The statement:",
  predictionInputLabel: "Your guess, as a percentage",
  predictionOptional: "Optional — skip it if you'd rather not guess.",
  predictionUnset: "Drag the slider or type a number from 0 to 100.",
  reviewHeading: "Review and submit",
  reviewAnswered: (a: number, t: number) =>
    `You've answered ${a} of ${t} questions.`,
  reviewRemaining: (n: number) => `${n} left to go`,
  reviewFirstUnanswered: "Go to the first unanswered question",
  submitCta: "Submit answers",
  incompleteSubmit: (n: number) =>
    `Answer every question before submitting — ${n} left to go.`,
  submitFailed:
    "We couldn't submit your answers. Check your connection and try again.",
  /** choice_up_to helper text, e.g. "Pick up to 3 · 2 chosen". */
  pickUpTo: (max: number, chosen: number) =>
    `Pick up to ${max} · ${chosen} chosen`,
  /** rating end-label line, e.g. "0 = Not at all". */
  ratingEnd: (value: number, label: string) => `${value} = ${label}`,
  twoEndedUnset: "Drag the slider to place your answer between the two ends.",
  resultsOptInLabel:
    "Yes, I would like my questionnaires to be securely saved over the next three years and returned to me when I graduate, so I can reflect on how my thinking has changed.",
  resultsOptInHelp:
    "This is entirely optional, will not affect my studies, and I can withdraw my agreement at any time.",
  resultsOptedIn:
    "You've opted in to having your questionnaires saved and returned to you.",
  resultsWithdraw: "Withdraw my agreement",
  resultsWithdrawn: "You've withdrawn your agreement.",
  resultsConsentFailed:
    "We couldn't save your choice. Check your connection and try again.",
} as const;
