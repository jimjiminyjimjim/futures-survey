import { redirect, notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { getSignedInUser } from "@/lib/auth/session";
import { getSurveySnapshot } from "@/lib/survey/queries";
import { testSurveyPaths } from "@/lib/survey/paths";
import { StatementScreen } from "@/app/survey/[statementKey]/statement-screen";

// Admin test mode (quick task 261117-it4): the live statement screen, for
// the unopened draft being tested.
export const instant = false;

const RoundIdSchema = z.uuid();

export default async function TestStatementPage({
  params,
}: {
  params: Promise<{ roundId: string; statementKey: string }>;
}) {
  await connection();

  const { roundId, statementKey } = await params;
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
    <StatementScreen
      snapshot={snapshot}
      statementKey={statementKey}
      paths={testSurveyPaths(parsedRoundId.data)}
    />
  );
}
