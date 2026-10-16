-- Opens Round 1 for real. Decision recorded at plan 02-01 Task 1
-- (checkpoint:decision, auto-selected "approve" per the orchestrator's
-- locked run decision; see 02-RESEARCH.md Open Question 1): open Round 1
-- now so the participant flow is usable for end-of-phase UAT before
-- Phase 3's admin open/close UI exists. closes_at is left null (open
-- indefinitely until a future forward migration or Phase 3's close
-- action sets it).
--
-- Idempotent: only ever moves Round 1 from "both dates null" to "opens_at
-- set" — it never overwrites an already-set opens_at or closes_at, so
-- replaying this file against a database where it already ran is a no-op.
--
-- No BEGIN/COMMIT: the Supabase CLI wraps each migration file in its own
-- transaction already.

update public.rounds
set opens_at = now()
where round_number = 1
  and opens_at is null
  and closes_at is null;
