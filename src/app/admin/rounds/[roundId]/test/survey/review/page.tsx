import { redirect, notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { getSignedInUser } from "@/lib/auth/session";
import { getSurveySnapshot } from "@/lib/survey/queries";
import { testSurveyPaths } from "@/lib/survey/paths";
import { ReviewScreen } from "@/app/survey/review/review-screen";

// Admin test mode (quick task 261117-it4): the live review/submit screen,
// for the unopened draft being tested. No results consent question in test
// mode: consent is null, so the screen shows the single submit button.
export const instant = false;

const RoundIdSchema = z.uuid();

export default async function TestReviewPage({
  params,
}: {
  params: Promise<{ roundId: string }>;
}) {
  await connection();

  const { roundId } = await params;
  const parsedRoundId = RoundIdSchema.safeParse(roundId);
  if (!parsedRoundId.success) {
    notFound();
  }

  const user = await getSignedInUser();
  if (!user) {
    redirect("/login");
  }

  const snapshot = await getSurveySnapshot(user.id, parsedRoundId.data);

  return (
    <ReviewScreen
      snapshot={snapshot}
      paths={testSurveyPaths(parsedRoundId.data)}
      consent={null}
    />
  );
}
