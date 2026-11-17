/**
 * Pure route helpers for the participant screens. The same screen
 * components serve the live survey (/survey, home "/") and the admin test
 * mode for an unopened draft (/admin/rounds/<id>/test/survey, home
 * /admin/rounds/<id>/test). No next/react imports.
 */

export type SurveyPaths = {
  /** Where the survey starts and where guard redirects land. */
  home: string;
  /** Prefix of the statement, section and review routes. */
  base: string;
};

export const LIVE_SURVEY_PATHS: SurveyPaths = { home: "/", base: "/survey" };

export function testSurveyPaths(roundId: string): SurveyPaths {
  const home = `/admin/rounds/${roundId}/test`;
  return { home, base: `${home}/survey` };
}

export function statementHref(paths: SurveyPaths, statementKey: string): string {
  return `${paths.base}/${statementKey}`;
}

export function sectionHref(paths: SurveyPaths, sectionNumber: number): string {
  return `${paths.base}/section/${sectionNumber}`;
}

export function reviewHref(paths: SurveyPaths): string {
  return `${paths.base}/review`;
}
