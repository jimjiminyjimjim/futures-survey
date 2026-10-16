import { redirect } from "next/navigation";

// Responses now live on the round page (user decision 2026-10-15: "we don't
// need another page"). Keep this URL working for old links.
export default async function ResponsesPage({
  params,
}: {
  params: Promise<{ roundId: string }>;
}) {
  const { roundId } = await params;
  redirect(`/admin/rounds/${encodeURIComponent(roundId)}`);
}
