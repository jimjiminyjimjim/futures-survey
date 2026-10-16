/**
 * Presentation Mode message constants, shared between server code,
 * components and their tests. Copy is verbatim from
 * .planning/phases/04-presentation-mode/04-UI-SPEC.md's Copywriting
 * Contract.
 */
export const PRESENTATION_MESSAGES = {
  presentResults: "Present results",
  enterFullscreen: "Enter fullscreen",
  exitFullscreen: "Exit fullscreen",
  compareWith: (n: number) => `Compare with Round ${n}`,
  versusChip: (n: number) => `vs Round ${n}`,
  slideCounter: (current: number, total: number) => `${current} of ${total}`,
  keyboardHint: "← → to navigate · Space to advance",
  respondents: (n: number) => (n === 1 ? "1 respondent" : `${n} respondents`),
  statements: (n: number) => (n === 1 ? "1 statement" : `${n} statements`),
  overviewTitle: "Familiarity overview",
  overviewSubtitle: (sortOrder: number) =>
    `Section ${sortOrder} · ranked by average familiarity, most familiar first`,
  emptyHeading: "No respondents yet",
  emptyBody:
    "Results will appear here once participants submit answers for this round.",
  loadFailed: "Couldn't load this round's results. Refresh to try again.",
  previousSlide: "Previous slide",
  nextSlide: "Next slide",
  backToRounds: "Back to rounds",
  breakdownLabel: "Answer breakdown",
  rankingLabel: "Terms ranked by average familiarity",
} as const;
