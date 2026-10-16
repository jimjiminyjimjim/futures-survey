-- Survey privacy schema: the single "is this round open" rule, additive
-- participant read access to the open round's content, the responses +
-- answers tables (own-row / open-round / unsubmitted RLS), guard triggers,
-- and admin-only identity-free aggregates.
--
-- No BEGIN/COMMIT: the Supabase CLI wraps each migration file in its own
-- transaction already. This migration is additive only — it never edits
-- 20261015000100_access_control.sql or 20261015000200_round_1_content.sql.
--
-- Once this migration has been applied to the hosted project, NEVER edit it
-- again — fixes are forward migrations (same convention as the two prior
-- migrations in this project).

-- ---------------------------------------------------------------------------
-- 1. public.is_round_open_at — the ONE place the open-window rule is
--    written (PRIV-01, SURV-08, SURV-09). Inclusive open, exclusive close;
--    a null close means "open until closed."
-- ---------------------------------------------------------------------------

create or replace function public.is_round_open_at(
  p_opens_at timestamptz,
  p_closes_at timestamptz,
  p_at timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_opens_at is not null
      and p_at is not null
      and p_opens_at <= p_at
      and (p_closes_at is null or p_at < p_closes_at),
    false
  );
$$;

revoke execute on function public.is_round_open_at(timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.is_round_open_at(timestamptz, timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. public.open_round_id_at — service_role only; participants must not be
--    able to probe arbitrary instants for future/past round state.
-- ---------------------------------------------------------------------------

create or replace function public.open_round_id_at(p_at timestamptz)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.rounds
  where public.is_round_open_at(opens_at, closes_at, p_at)
  order by opens_at desc, round_number desc
  limit 1;
$$;

revoke execute on function public.open_round_id_at(timestamptz) from public, anon, authenticated;
grant execute on function public.open_round_id_at(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 3. public.current_open_round_id — the single source of truth every RLS
--    policy and every later phase reuses for "which round is open now."
-- ---------------------------------------------------------------------------

create or replace function public.current_open_round_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select public.open_round_id_at(now());
$$;

revoke execute on function public.current_open_round_id() from public, anon;
grant execute on function public.current_open_round_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Additive participant read policies on rounds/sections/statements,
--    scoped to only the currently open round (SURV-08/09, T-02-06). These
--    are additional permissive policies alongside the existing
--    *_select_admins policies from 20261015000200 — Postgres OR's multiple
--    permissive policies for the same operation, so admins keep full
--    access while participants gain this scoped slice. The scalar
--    subselect wrapping ensures Postgres evaluates the function once per
--    statement (Supabase RLS performance idiom).
-- ---------------------------------------------------------------------------

create policy rounds_select_open_round
  on public.rounds
  for select
  to authenticated
  using (id = (select public.current_open_round_id()));

create policy sections_select_open_round
  on public.sections
  for select
  to authenticated
  using (round_id = (select public.current_open_round_id()));

create policy statements_select_open_round
  on public.statements
  for select
  to authenticated
  using (round_id = (select public.current_open_round_id()));

-- ---------------------------------------------------------------------------
-- 5. statements: composite-FK target for answers, plus the reserved key
--    that plan 02-02's /survey/review screen depends on never being
--    shadowed by a statement.
-- ---------------------------------------------------------------------------

alter table public.statements
  add constraint statements_id_round_id_unique unique (id, round_id);

alter table public.statements
  add constraint statements_key_not_reserved check (key <> 'review');

-- ---------------------------------------------------------------------------
-- 6. public.responses — one row per (round, participant). submitted_at set
--    means locked (PRIV-01, SURV-06/07).
-- ---------------------------------------------------------------------------

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint responses_round_user_unique unique (round_id, user_id),
  constraint responses_id_round_id_unique unique (id, round_id)
);

create index responses_user_id_idx on public.responses (user_id);

alter table public.responses enable row level security;

revoke all on public.responses from anon;
revoke delete, truncate, references, trigger on public.responses from authenticated;

-- PRIV-01: a participant can read only their own response rows.
create policy responses_select_own
  on public.responses
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- PRIV-01: a participant can create their own response only for the
-- currently open round, and never already submitted.
create policy responses_insert_own_open_round
  on public.responses
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and round_id = (select public.current_open_round_id())
    and submitted_at is null
  );

-- PRIV-01 / SURV-06/07: a participant can update only their own,
-- unsubmitted response in the currently open round. There is no delete
-- policy — responses/answers are never deletable from the app.
create policy responses_update_own_open_round
  on public.responses
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and submitted_at is null
    and round_id = (select public.current_open_round_id())
  )
  with check (
    user_id = (select auth.uid())
    and round_id = (select public.current_open_round_id())
  );

-- ---------------------------------------------------------------------------
-- 7. responses_before_write — guard trigger (T-02-01, T-02-04). Forbids an
--    already-submitted insert, forbids mutating identity columns, forbids
--    re-touching a submitted response, and only lets submitted_at be set
--    when every statement in the round has a matching answer (SURV-06
--    defense in depth; the server action also checks this).
-- ---------------------------------------------------------------------------

create or replace function public.responses_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total int;
  v_answered int;
begin
  if tg_op = 'INSERT' then
    if new.submitted_at is not null then
      raise exception 'A response cannot be created already submitted'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE'
  if new.id is distinct from old.id
    or new.round_id is distinct from old.round_id
    or new.user_id is distinct from old.user_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Identity columns on a response cannot be changed'
      using errcode = '23514';
  end if;

  if old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at then
    raise exception 'This response has already been submitted'
      using errcode = '23514';
  end if;

  if old.submitted_at is null and new.submitted_at is not null then
    select count(*) into v_total from public.statements where round_id = new.round_id;
    select count(*) into v_answered from public.answers where response_id = new.id;
    if v_answered < v_total then
      raise exception 'Cannot submit: % of % statements answered', v_answered, v_total
        using errcode = '23514';
    end if;
    -- Ignore any client-supplied timestamp — the DB clock is authoritative.
    new.submitted_at := now();
  end if;

  return new;
end;
$$;

create trigger responses_before_write
  before insert or update on public.responses
  for each row execute function public.responses_before_write();

-- ---------------------------------------------------------------------------
-- 8. public.answers — one row per (response, statement). (PRIV-01)
-- ---------------------------------------------------------------------------

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null,
  round_id uuid not null,
  statement_id uuid not null,
  value smallint not null check (value between 1 and 10),
  answered_at timestamptz not null default now(),
  constraint answers_response_round_fk
    foreign key (response_id, round_id)
    references public.responses(id, round_id)
    on delete cascade,
  constraint answers_statement_round_fk
    foreign key (statement_id, round_id)
    references public.statements(id, round_id),
  constraint answers_response_statement_unique unique (response_id, statement_id)
);

create index answers_statement_id_idx on public.answers (statement_id);

alter table public.answers enable row level security;

revoke all on public.answers from anon;
revoke delete, truncate, references, trigger on public.answers from authenticated;

-- PRIV-01: a participant can read only answers on their own response.
create policy answers_select_own
  on public.answers
  for select
  to authenticated
  using (
    exists (
      select 1 from public.responses r
      where r.id = answers.response_id and r.user_id = (select auth.uid())
    )
  );

-- PRIV-01: a participant can create an answer only in the open round, on
-- their own unsubmitted response.
create policy answers_insert_own_open_unsubmitted
  on public.answers
  for insert
  to authenticated
  with check (
    round_id = (select public.current_open_round_id())
    and exists (
      select 1 from public.responses r
      where r.id = answers.response_id
        and r.user_id = (select auth.uid())
        and r.submitted_at is null
    )
  );

-- PRIV-01: same predicate for update (the upsert-on-conflict path from the
-- server action runs through this policy once a conflicting row exists).
-- There is no delete policy.
create policy answers_update_own_open_unsubmitted
  on public.answers
  for update
  to authenticated
  using (
    exists (
      select 1 from public.responses r
      where r.id = answers.response_id
        and r.user_id = (select auth.uid())
        and r.submitted_at is null
    )
  )
  with check (
    round_id = (select public.current_open_round_id())
    and exists (
      select 1 from public.responses r
      where r.id = answers.response_id
        and r.user_id = (select auth.uid())
        and r.submitted_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- 9. answers_before_write — guard trigger (T-02-03, T-02-04). Forbids
--    mutating identity columns, forbids writing to an already-submitted
--    response, and requires the value to be a real option on the
--    statement's scale.
-- ---------------------------------------------------------------------------

create or replace function public.answers_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submitted_at timestamptz;
  v_scale_key text;
  v_option_exists boolean;
begin
  if tg_op = 'UPDATE' then
    if new.response_id is distinct from old.response_id
      or new.round_id is distinct from old.round_id
      or new.statement_id is distinct from old.statement_id
    then
      raise exception 'Identity columns on an answer cannot be changed'
        using errcode = '23514';
    end if;
  end if;

  select r.submitted_at into v_submitted_at
  from public.responses r
  where r.id = new.response_id;

  if v_submitted_at is not null then
    raise exception 'This response has already been submitted'
      using errcode = '23514';
  end if;

  select sec.scale_key into v_scale_key
  from public.statements st
  join public.sections sec on sec.id = st.section_id and sec.round_id = st.round_id
  where st.id = new.statement_id and st.round_id = new.round_id;

  select exists (
    select 1 from public.scale_options so
    where so.scale_key = v_scale_key and so.value = new.value
  ) into v_option_exists;

  if not coalesce(v_option_exists, false) then
    raise exception 'Answer value % is not an option on this statement''s scale', new.value
      using errcode = '23514';
  end if;

  new.answered_at := now();
  return new;
end;
$$;

create trigger answers_before_write
  before insert or update on public.answers
  for each row execute function public.answers_before_write();

-- ---------------------------------------------------------------------------
-- 10. Admin-only aggregates (PRIV-03). Both raise 42501 for non-admins;
--     neither returns user_id, email or response_id.
-- ---------------------------------------------------------------------------

create or replace function public.admin_round_response_counts()
returns table (round_id uuid, started_count bigint, submitted_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Only admins can read survey aggregates' using errcode = '42501';
  end if;

  return query
    select
      rounds.id as round_id,
      count(responses.id) as started_count,
      count(responses.id) filter (where responses.submitted_at is not null) as submitted_count
    from public.rounds
    left join public.responses on responses.round_id = rounds.id
    group by rounds.id, rounds.round_number
    order by rounds.round_number;
end;
$$;

revoke execute on function public.admin_round_response_counts() from public, anon;
grant execute on function public.admin_round_response_counts() to authenticated, service_role;

create or replace function public.admin_statement_answer_counts(p_round_id uuid)
returns table (statement_id uuid, statement_key text, value smallint, answer_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Only admins can read survey aggregates' using errcode = '42501';
  end if;

  return query
    select
      statements.id as statement_id,
      statements.key as statement_key,
      answers.value,
      count(*) as answer_count
    from public.answers
    join public.statements on statements.id = answers.statement_id
    join public.responses on responses.id = answers.response_id
    where answers.round_id = p_round_id
      and responses.submitted_at is not null
    group by statements.id, statements.key, answers.value
    order by statements.key, answers.value;
end;
$$;

revoke execute on function public.admin_statement_answer_counts(uuid) from public, anon;
grant execute on function public.admin_statement_answer_counts(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. Comments — which requirement each policy/function serves.
-- ---------------------------------------------------------------------------

comment on function public.is_round_open_at(timestamptz, timestamptz, timestamptz) is 'SURV-08/09: the single open-window rule (inclusive open, exclusive close).';
comment on function public.open_round_id_at(timestamptz) is 'SURV-08/09: service_role-only instant-to-round resolver backing current_open_round_id.';
comment on function public.current_open_round_id() is 'PRIV-01/SURV-08/09: single source of truth for "which round is open now," reused by every RLS policy below.';
comment on policy rounds_select_open_round on public.rounds is 'SURV-02/09: participants read only the currently open round.';
comment on policy sections_select_open_round on public.sections is 'SURV-02/09: participants read only the open round''s sections.';
comment on policy statements_select_open_round on public.statements is 'SURV-02/09: participants read only the open round''s statements.';
comment on table public.responses is 'PRIV-01: one row per (round, participant); submitted_at set means locked (SURV-06/07).';
comment on policy responses_select_own on public.responses is 'PRIV-01/PRIV-02: own rows only.';
comment on policy responses_insert_own_open_round on public.responses is 'PRIV-01: own row, open round, unsubmitted only.';
comment on policy responses_update_own_open_round on public.responses is 'PRIV-01/SURV-06/07: own row, open round, unsubmitted only; no delete policy exists.';
comment on function public.responses_before_write() is 'SURV-06/07: DB-enforced completeness-before-submit and submit immutability (defense in depth).';
comment on table public.answers is 'PRIV-01: one row per (response, statement).';
comment on policy answers_select_own on public.answers is 'PRIV-01/PRIV-02: own rows only, via the owning response.';
comment on policy answers_insert_own_open_unsubmitted on public.answers is 'PRIV-01: own unsubmitted response, open round only.';
comment on policy answers_update_own_open_unsubmitted on public.answers is 'PRIV-01: own unsubmitted response, open round only; no delete policy exists.';
comment on function public.answers_before_write() is 'T-02-03/T-02-04: value must be a real scale option; no writes once the response is submitted.';
comment on function public.admin_round_response_counts() is 'PRIV-03: admin-only, identity-free started/submitted counts per round.';
comment on function public.admin_statement_answer_counts(uuid) is 'PRIV-03: admin-only, identity-free per-statement answer distribution for submitted responses.';
