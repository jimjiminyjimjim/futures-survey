/**
 * Pure. A round is an UNOPENED DRAFT when it has no open date AND no close
 * date. Every response on one is admin test data (quick task 261117-it4):
 * participants can only write to the open round, and giving the round a
 * date deletes its responses in the database (rounds_clear_test_answers).
 *
 * Stricter than the "draft" status (round_status_at), which is "draft"
 * whenever opens_at is null even if a close date is set. Never infer test
 * mode from the status alone. The SQL twin is public.round_is_draft(uuid).
 */
export function isUnopenedDraft(
  opensAt: string | null,
  closesAt: string | null
): boolean {
  return opensAt === null && closesAt === null;
}
