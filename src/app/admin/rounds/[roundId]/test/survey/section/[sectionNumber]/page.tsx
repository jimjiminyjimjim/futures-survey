import { redirect, notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { getSignedInUser } from "@/lib/auth/session";
import { getSurveySnapshot } from "@/lib/survey/queries";
import { testSurveyPaths } from "@/lib/survey/paths";
import { SectionScreen } from "@/app/survey/section/[sectionNumber]/section-screen";

// Admin test mode (quick task 261117-it4): the live section-break screen,
// for the unopened draft being tested.
export const instant = false;

const RoundIdSchema = z.uuid();

export default async function TestSectionPage({
  params,
}: {
  params: Promise<{ roundId: string; sectionNumber: string }>;
}) {
  await connection();

  const { roundId, sectionNumber } = await params;
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
    <SectionScreen
      snapshot={snapshot}
      sectionNumberParam={sectionNumber}
      paths={testSurveyPaths(parsedRoundId.data)}
    />
  );
}
