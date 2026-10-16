import { z } from "zod";
import { getSignedInUser, isCurrentUserAdmin } from "@/lib/auth/session";
import { getRoundResponses } from "@/lib/admin/responses-queries";
import { toRoundCsv } from "@/lib/admin/csv";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";

// ADM-03. This Route Handler is NOT wrapped by admin/layout.tsx's guard
// (route.ts files never participate in the layout tree) — it re-checks
// getSignedInUser()/isCurrentUserAdmin() itself, every time, returning 404
// (never a redirect) for anyone who isn't an admin, matching this
// codebase's "no oracle" philosophy.
//
// This route's only identity-bearing read is public.admin_round_responses,
// reached indirectly via getRoundResponses() (src/lib/admin/responses-queries.ts)
// — never queried directly here. T-03-25: only that module and this route
// may ever reference admin_round_responses under src/.
//
// Deliberately NOT exporting `dynamic`/`revalidate`/`fetchCache`/`instant`:
// under next.config.ts's cacheComponents those route segment configs are a
// build error in Route Handlers. Reading cookies() (via getSignedInUser())
// already makes this handler dynamic; Cache-Control: private, no-store on
// the response is what prevents a stale/shared cache instead.

const RoundIdSchema = z.uuid();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roundId: string }> }
) {
  const { roundId } = await params;
  const parsedRoundId = RoundIdSchema.safeParse(roundId);
  if (!parsedRoundId.success) {
    return new Response("Not found", { status: 404 });
  }

  const user = await getSignedInUser();
  if (!user) {
    return new Response("Not found", { status: 404 });
  }
  if (!(await isCurrentUserAdmin())) {
    return new Response("Not found", { status: 404 });
  }

  const result = await getRoundResponses(parsedRoundId.data);
  if (!result) {
    return new Response("Not found", { status: 404 });
  }
  if (!result.ok) {
    console.error("getRoundResponses", { op: "export" });
    return new Response(ADMIN_MESSAGES.exportFailed, { status: 500 });
  }

  const csv = toRoundCsv(
    result.participants,
    result.statements.map((s) => s.key)
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="round-${result.round.roundNumber}-responses.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
