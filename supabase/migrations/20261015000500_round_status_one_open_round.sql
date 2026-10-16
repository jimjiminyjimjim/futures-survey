-- Admin rounds dashboard groundwork: the one-open-round invariant and the
-- status/dashboard-rows function (ADM-01, RND-05).
--
-- Additive only — never edits 20261015000100/200/300/400. No BEGIN/COMMIT:
-- the Supabase CLI wraps each migration file in its own transaction
-- already.
--
-- Once this migration has been applied to the hosted project, NEVER edit it
-- again — fixes are forward migrations (same convention as the four prior
-- migrations in this project).

-- ---------------------------------------------------------------------------
-- 1. public.round_status_at — the ONE place "draft/scheduled/open/closed"
--    is derived (RND-05, ADM-01). Pure and instant-parameterised (unlike
--    research Pattern 1's round_status(opens, closes), which was marked
--    immutable while secretly calling now() — this form is testable at any
--    instant; callers pass now() themselves). Reuses
--    public.is_round_open_at exactly as Phase 2 defined it.
-- ---------------------------------------------------------------------------

create or replace function public.round_status_at(
  p_opens_at timestamptz,
  p_closes_at timestamptz,
  p_at timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_opens_at is null then 'draft'
    when p_at is null then null
    when public.is_round_open_at(p_opens_at, p_closes_at, p_at) then 'open'
    when p_opens_at > p_at then 'scheduled'
    else 'closed'
  end;
$$;

revoke execute on function public.round_status_at(timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.round_status_at(timestamptz, timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. rounds_one_open_window — partial exclusion constraint, the race-proof
--    backstop for RND-05's "at most one open round" invariant (T-03-01). No
--    btree_gist extension needed: there is only one range column, no
--    paired equality column. The default '[)' bounds of tstzrange match
--    is_round_open_at's inclusive-open/exclusive-close semantics, so
--    windows that only touch (one's close = another's open) never overlap.
-- ---------------------------------------------------------------------------

alter table public.rounds
  add constraint rounds_one_open_window
  exclude using gist (
    (tstzrange(opens_at, closes_at)) with &&
  )
  where (opens_at is not null);

-- ---------------------------------------------------------------------------
-- 3. rounds_prevent_overlap — friendly-message trigger, defense in depth
--    alongside the constraint above (T-03-01, Pattern 6). Only runs its
--    overlap check when the new row's own dates are already well-ordered
--    (rounds_dates_ordered), so a badly-ordered insert/update reports that
--    check's error instead of a confusing range-construction error.
-- ---------------------------------------------------------------------------

create or replace function public.rounds_prevent_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.opens_at is not null
    and (new.closes_at is null or new.closes_at > new.opens_at)
  then
    if exists (
      select 1 from public.rounds r
      where r.id <> new.id
        and r.opens_at is not null
        and (r.closes_at is null or r.closes_at > r.opens_at)
        and tstzrange(r.opens_at, r.closes_at) && tstzrange(new.opens_at, new.closes_at)
    ) then
      raise exception 'These dates overlap another round''s — only one round can be open at a time.'
        using errcode = '23P01', hint = 'round_overlap';
    end if;
  end if;

  return new;
end;
$$;

create trigger rounds_prevent_overlap
  before insert or update of opens_at, closes_at on public.rounds
  for each row execute function public.rounds_prevent_overlap();

-- ---------------------------------------------------------------------------
-- 4. public.admin_list_rounds — the dashboard's single data source
--    (ADM-01). Admin-only; reuses admin_round_response_counts (Phase 2)
--    rather than re-deriving started/submitted counts. One now() per
--    statement means every row's status is evaluated at the same instant.
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_rounds(p_round_id uuid default null)
returns table (
  id uuid,
  round_number integer,
  title text,
  opens_at timestamptz,
  closes_at timestamptz,
  status text,
  section_count bigint,
  statement_count bigint,
  started_count bigint,
  submitted_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Only admins can list rounds' using errcode = '42501';
  end if;

  return query
    select
      rounds.id as id,
      rounds.round_number as round_number,
      rounds.title as title,
      rounds.opens_at as opens_at,
      rounds.closes_at as closes_at,
      public.round_status_at(rounds.opens_at, rounds.closes_at, now()) as status,
      (select count(*) from public.sections where sections.round_id = rounds.id) as section_count,
      (select count(*) from public.statements where statements.round_id = rounds.id) as statement_count,
      coalesce(counts.started_count, 0) as started_count,
      coalesce(counts.submitted_count, 0) as submitted_count
    from public.rounds
    left join public.admin_round_response_counts() as counts on counts.round_id = rounds.id
    where p_round_id is null or rounds.id = p_round_id
    order by rounds.round_number desc;
end;
$$;

revoke execute on function public.admin_list_rounds(uuid) from public, anon;
grant execute on function public.admin_list_rounds(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Hardening: TRUNCATE bypasses RLS and row triggers, so it must never be
--    available to non-admin roles on the content/access tables (T-03-04).
-- ---------------------------------------------------------------------------

revoke truncate, references, trigger on public.rounds from anon, authenticated;
revoke truncate, references, trigger on public.sections from anon, authenticated;
revoke truncate, references, trigger on public.statements from anon, authenticated;
revoke truncate, references, trigger on public.admin_emails from anon, authenticated;
revoke truncate, references, trigger on public.allowed_domains from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Comments — which requirement each function/trigger/constraint serves.
-- ---------------------------------------------------------------------------

comment on function public.round_status_at(timestamptz, timestamptz, timestamptz) is 'RND-05/ADM-01: the single pure status derivation (draft/scheduled/open/closed), instant-parameterised.';
comment on constraint rounds_one_open_window on public.rounds is 'RND-05: race-proof backstop — at most one round''s window can ever be open at a time.';
comment on function public.rounds_prevent_overlap() is 'RND-05: friendly-message defense in depth alongside rounds_one_open_window.';
comment on function public.admin_list_rounds(uuid) is 'ADM-01: admin-only dashboard rows — status, dates, section/statement counts, started/submitted counts.';
