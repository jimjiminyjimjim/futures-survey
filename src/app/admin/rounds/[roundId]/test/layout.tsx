import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { testSurveyPaths } from "@/lib/survey/paths";
import { SurveyModeProvider } from "@/components/survey/survey-mode";
import { TestBanner } from "@/components/survey/test-banner";

// Admin test mode for an unopened draft (quick task 261117-it4). The /admin
// layout above already enforces sign-in and admin; the database enforces
// admin + unopened draft again on every write. Every screen below this
// layout is a participant screen component, given this draft's id and
// test-route hrefs through SurveyModeProvider.
export const instant = false;

const RoundIdSchema = z.uuid();

export default async function TestRoundLayout({
  params,
  children,
}: {
  params: Promise<{ roundId: string }>;
  children: React.ReactNode;
}) {
  await connection();

  const { roundId } = await params;
  const parsedRoundId = RoundIdSchema.safeParse(roundId);
  if (!parsedRoundId.success) {
    notFound();
  }
  const id = parsedRoundId.data;
  const paths = testSurveyPaths(id);

  return (
    <SurveyModeProvider testRoundId={id} homeHref={paths.home}>
      <TestBanner roundId={id} homeHref={paths.home} />
      {children}
    </SurveyModeProvider>
  );
}
