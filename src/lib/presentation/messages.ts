/**
 * Presentation Mode message constants, shared between server code,
 * components and their tests. Copy is verbatim from
 * .planning/phases/04-presentation-mode/04-UI-SPEC.md's Copywriting
 * Contract (title/section/agreement/familiarity slides) plus Surveys v2
 * Part C's copy for the new content kinds (choice/prediction/discussion).
 */

const NUMBER_WORDS: Record<number, string> = {
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
};

export const PRESENTATION_MESSAGES = {
  presentResults: "Present results",
  enterFullscreen: "Enter fullscreen",
  exitFullscreen: "Exit fullscreen",
  compareWith: (n: number) => `Compare with Round ${n}`,
  versusChip: (n: number) => `vs Round ${n}`,
  slideCounter: (current: number, total: number) => `${current} of ${total}`,
  keyboardHint: "← → to navigate · Space to advance",
  respondents: (n: number) => (n === 1 ? "1 respondent" : `${n} respondents`),
  overviewTitle: "Familiarity overview",
  // Accepts an optional display label (e.g. "A") so v3 content avoids
  // "Section" in copy; falls back to the numeric sortOrder for pre-v3
  // content, which has no label.
  overviewSubtitle: (label: string | null, sortOrder: number) =>
    label
      ? `Question ${label} · ranked by who could explain it, highest first`
      : `Section ${sortOrder} · ranked by who could explain it, highest first`,
  emptyHeading: "No respondents yet",
  emptyBody:
    "Results will appear here once participants submit answers for this round.",
  loadFailed: "Couldn't load this round's results. Refresh to try again.",
  previousSlide: "Previous slide",
  nextSlide: "Next slide",
  backToRounds: "Back to rounds",
  breakdownLabel: "Answer breakdown",
  rankingLabel: "Terms ranked by who could explain it",

  // Surveys v2 Part C — section numbering, key tag, choice/prediction/
  // discussion slides.
  questionProgress: (label: string | null, n: number, total: number) =>
    label ? `Section ${label} · Question ${n} of ${total}` : `Question ${n} of ${total}`,
  keyQuestionTag: "Key question",
  pickOne: "Choose one",
  pickMulti: "Pick all that apply",
  pickExact: (n: number) => `Pick ${NUMBER_WORDS[n] ?? n}`,
  pickUpTo: (n: number) => `Pick up to ${NUMBER_WORDS[n] ?? n}`,
  choiceBreakdownLabel: "Answer breakdown, ranked by count",
  weAsked: (statementText: string) =>
    `We asked: how many people in this room agreed with "${statementText}"?`,
  averageGuessHeading: "Average guess",
  averageGuessCaption: (n: number) =>
    n === 1 ? "1 guess" : `${n} guesses`,
  actualAgreedHeading: "Actually agreed",
  actualAgreedCaption: (n: number) =>
    n === 1 ? "1 respondent" : `${n} respondents`,
  noGuessesYet: "No one guessed yet",

  // Readable results redesign — scannable row layout (label · bar ·
  // count/percent), no legends or colour keys.
  multiPickNote: "People could pick more than one",
  mostPicked: (label: string, percent: number) =>
    `Most picked: ${label} (${percent}%)`,

  // 261018-qck — rating (0–10) and two-ended slides.
  ratingAverage: (avg: number) => `Average ${avg} out of 10`,
  ratingBreakdownLabel: "Answer breakdown from 0 to 10",
  twoEndedLabel: "Where people placed their answer between the two ends",
  averageMarker: "Average",
} as const;
