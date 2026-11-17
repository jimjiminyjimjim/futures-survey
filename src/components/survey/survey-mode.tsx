"use client";

import { createContext, useContext } from "react";

/**
 * Which survey the participant screens are running (quick task 261117-it4).
 * Live /survey has no provider, so every form gets the default: no test
 * round, home "/" (exactly today's behaviour). The admin test route wraps
 * its screens in a provider carrying the draft's id, so saves and the
 * submit go to that draft and "home" is the test start page.
 */
export type SurveyMode = {
  /** The unopened draft being tested, or null on the live survey. */
  testRoundId: string | null;
  /** Where to go when the round can't be answered any more. */
  homeHref: string;
};

const SurveyModeContext = createContext<SurveyMode>({
  testRoundId: null,
  homeHref: "/",
});

export function SurveyModeProvider({
  testRoundId,
  homeHref,
  children,
}: {
  testRoundId: string | null;
  homeHref: string;
  children: React.ReactNode;
}) {
  return (
    <SurveyModeContext.Provider value={{ testRoundId, homeHref }}>
      {children}
    </SurveyModeContext.Provider>
  );
}

export function useSurveyMode(): SurveyMode {
  return useContext(SurveyModeContext);
}
