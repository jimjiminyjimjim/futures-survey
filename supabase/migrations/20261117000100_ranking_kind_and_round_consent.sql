-- Quick task 261117-eak (Session 2: Holding space for uncertainty) --
-- migration 1 of 2, SCHEMA AND FUNCTIONS ONLY (no data rows):
--   * a new statement kind 'ranking' (a full ordered ranking of every
--     option, stored in answers.choice_values in rank order, never sorted)
--   * admin_statement_rank_stats: per-(statement, option) rank aggregates
--     for presentation mode (no identities, submitted responses only)
--   * results_consent_rounds: per-session results consent, so Session 2
--     participants never rewrite the Session 1 consent already recorded in
--     results_consent
--   * admin_round_responses: reads results_consent for the Session 1 round
--     only and results_consent_rounds for every other round
--   * sections.show_overview comment: documents the list display for a
--     ranking section
-- Sessions 1-3 data is untouched.
--
-- Forward-only: no BEGIN/COMMIT (the Supabase CLI/MCP wraps each migration
-- file in its own transaction), and $t$...$t$ dollar quoting for every text
-- literal, matching 20261018000100.
--
-- Apply this BEFORE 20261117000200_session_2_holding_space_for_uncertainty.sql
-- (that file refuses to run unless the 'ranking' kind exists). The version
-- prefix of this file is a working name and may be renamed to the version
-- Supabase records.
--
-- Once this migration has been applied to the hosted project, NEVER edit it
-- again -- fixes are forward migrations.

-- ---------------------------------------------------------------------------
-- 1. Read-only guard: the legacy-consent round used in step 6 must be the
--    Session 1 round of the questionnaire.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from public.rounds r
    join public.surveys s on s.id = r.survey_id
    where r.id = '6bf90e9e-c628-4592-8e39-cc9c16440ea3'::uuid
      and r.session_number = 1
      and s.title = $t$Becoming a Designer Questionnaire$t$
  ) then
    raise exception 'ranking_kind_and_round_consent: Session 1 round 6bf90e9e-c628-4592-8e39-cc9c16440ea3 not found';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. statements: the 'ranking' kind. Like the choice kinds it carries
--    options; unlike them it has no choice_count and no end labels (the
--    existing choice_count / end-labels constraints already force both to
--    null for any kind outside their lists). A ranking may not carry an
--    exclusive option: every option is ranked.
-- ---------------------------------------------------------------------------

alter table public.statements drop constraint if exists statements_kind_valid;
alter table public.statements
  add constraint statements_kind_valid
  check (kind in ('scale', 'choice_one', 'choice_multi', 'choice_exact', 'prediction', 'rating', 'two_ended', 'choice_up_to', 'ranking'));

alter table public.statements drop constraint if exists statements_options_by_kind;
alter table public.statements
  add constraint statements_options_by_kind
  check ((kind in ('choice_one', 'choice_multi', 'choice_exact', 'choice_up_to', 'ranking')) = (options is not null));

alter table public.statements drop constraint if exists statements_ranking_no_exclusive;
alter table public.statements
  add constraint statements_ranking_no_exclusive
  check (kind <> 'ranking' or not (options @> '[{"exclusive": true}]'::jsonb));

-- ---------------------------------------------------------------------------
-- 3. answers_before_write: copied VERBATIM from 20261018000100 section 5.
--    Only lines carrying the token "ranking" are added (a static test
--    proves it by dropping them and comparing to the old body):
--      (a) the option-value loader also loads options for a ranking
--      (b) a ranking is never sorted: its order IS the answer
--      (c) a ranking must rank every option (distinct values and option
--          membership still come from the shared list branch)
-- ---------------------------------------------------------------------------

create or replace function public.answers_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submitted_at timestamptz;
  v_kind text;
  v_options jsonb;
  v_choice_count smallint;
  v_scale_key text;
  v_option_values smallint[];
  v_exclusive_values smallint[];
  v_given int;
  v_distinct int;
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

  select st.kind, st.options, st.choice_count, sec.scale_key
  into v_kind, v_options, v_choice_count, v_scale_key
  from public.statements st
  join public.sections sec on sec.id = st.section_id and sec.round_id = st.round_id
  where st.id = new.statement_id and st.round_id = new.round_id;

  if v_kind is null then
    raise exception 'Statement not found in this round' using errcode = '23514';
  end if;

  if v_kind in ('choice_one', 'choice_multi', 'choice_exact', 'choice_up_to', 'ranking') then
    select
      array_agg((e ->> 'value')::smallint),
      coalesce(
        array_agg((e ->> 'value')::smallint) filter (where coalesce((e ->> 'exclusive')::boolean, false)),
        '{}'::smallint[]
      )
    into v_option_values, v_exclusive_values
    from jsonb_array_elements(v_options) as t(e);
  end if;

  if v_kind in ('scale', 'choice_one', 'prediction', 'rating', 'two_ended') then
    if new.value is null or new.choice_values is not null then
      raise exception 'This question takes a single answer value' using errcode = '23514';
    end if;
  else
    if new.value is not null or new.choice_values is null or cardinality(new.choice_values) = 0 then
      raise exception 'This question takes a list of choices' using errcode = '23514';
    end if;
    select count(*), count(distinct x) into v_given, v_distinct from unnest(new.choice_values) as u(x);
    if v_given <> v_distinct then
      raise exception 'Each choice can only be picked once' using errcode = '23514';
    end if;
    if exists (select 1 from unnest(new.choice_values) as u(x) where not (x = any(v_option_values))) then
      raise exception 'A choice is not an option on this question' using errcode = '23514';
    end if;
    if v_kind <> 'ranking' then -- ranking
      new.choice_values := (select array_agg(x order by x) from unnest(new.choice_values) as u(x));
    end if; -- ranking
  end if;

  if v_kind = 'scale' then
    if not exists (
      select 1 from public.scale_options so
      where so.scale_key = v_scale_key and so.value = new.value
    ) then
      raise exception 'Answer value % is not an option on this statement''s scale', new.value
        using errcode = '23514';
    end if;
  elsif v_kind = 'choice_one' then
    if not (new.value = any(v_option_values)) then
      raise exception 'Answer value % is not an option on this question', new.value
        using errcode = '23514';
    end if;
  elsif v_kind = 'prediction' then
    if new.value < 0 or new.value > 100 then
      raise exception 'A prediction must be between 0 and 100' using errcode = '23514';
    end if;
  elsif v_kind = 'rating' then
    if new.value < 0 or new.value > 10 then
      raise exception 'A rating answer must be between 0 and 10' using errcode = '23514';
    end if;
  elsif v_kind = 'two_ended' then
    if new.value < 0 or new.value > 100 then
      raise exception 'A two-ended answer must be between 0 and 100' using errcode = '23514';
    end if;
  elsif v_kind = 'choice_multi' then
    if v_given > 1 and exists (
      select 1 from unnest(new.choice_values) as u(x) where x = any(v_exclusive_values)
    ) then
      raise exception 'That option can''t be combined with others' using errcode = '23514';
    end if;
  elsif v_kind = 'choice_exact' then
    if v_given <> v_choice_count then
      raise exception 'Pick exactly % options', v_choice_count using errcode = '23514';
    end if;
  elsif v_kind = 'choice_up_to' then
    if v_given < 1 or v_given > v_choice_count then
      raise exception 'Pick up to % options', v_choice_count using errcode = '23514';
    end if;
    if v_given > 1 and exists (
      select 1 from unnest(new.choice_values) as u(x) where x = any(v_exclusive_values)
    ) then
      raise exception 'That option can''t be combined with others' using errcode = '23514';
    end if;
  elsif v_kind = 'ranking' then -- ranking
    if v_given <> cardinality(v_option_values) then -- ranking
      raise exception 'Rank every option on this question' using errcode = '23514'; -- ranking
    end if; -- ranking
  end if;

  new.answered_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. admin_statement_rank_stats: per-(statement, option) rank aggregates for
--    presentation mode. Submitted responses only, never joins auth.users,
--    never returns a user id or an individual ordering. Every option of
--    every ranking statement in the round is returned, including options
--    nobody ranked (counts 0). rank_sum adds each respondent's 1-based
--    position of the option; first_count counts respondents who put the
--    option first.
-- ---------------------------------------------------------------------------

create or replace function public.admin_statement_rank_stats(p_round_id uuid)
returns table (
  statement_id uuid,
  statement_key text,
  value smallint,
  label text,
  respondent_count bigint,
  ranked_count bigint,
  rank_sum bigint,
  first_count bigint
)
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
    with submitted as (
      select a.statement_id, a.choice_values
      from public.answers a
      join public.responses r on r.id = a.response_id
      where a.round_id = p_round_id
        and r.submitted_at is not null
        and a.choice_values is not null
    ),
    positions as (
      select s.statement_id, u.x as picked, u.pos
      from submitted s
      cross join lateral unnest(s.choice_values) with ordinality as u(x, pos)
    ),
    respondents as (
      select s.statement_id, count(*) as n
      from submitted s
      group by s.statement_id
    )
    select
      st.id as statement_id,
      st.key as statement_key,
      o.value as value,
      o.label as label,
      coalesce((select n from respondents rs where rs.statement_id = st.id), 0) as respondent_count,
      (select count(*) from positions p where p.statement_id = st.id and p.picked = o.value) as ranked_count,
      coalesce((select sum(p.pos) from positions p where p.statement_id = st.id and p.picked = o.value), 0)::bigint as rank_sum,
      (select count(*) from positions p where p.statement_id = st.id and p.picked = o.value and p.pos = 1) as first_count
    from public.statements st
    cross join lateral (
      select
        (e ->> 'value')::smallint as value,
        e ->> 'label' as label,
        t.ord
      from jsonb_array_elements(st.options) with ordinality as t(e, ord)
    ) as o
    where st.round_id = p_round_id
      and st.kind = 'ranking'
    order by st.key, o.ord;
end;
$$;

revoke execute on function public.admin_statement_rank_stats(uuid) from public, anon;
grant execute on function public.admin_statement_rank_stats(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. public.results_consent_rounds: per-session opt-in to having
--    questionnaires saved and returned. RLS mirrors results_consent (own
--    row select/insert/update, admin can select all, no delete) with one
--    tightening: a participant can only opt in to the session that is open
--    right now. Timestamps are DB-clock-stamped, never client-supplied.
--    The legacy per-person results_consent table keeps Session 1's record
--    and is never written by the app again.
-- ---------------------------------------------------------------------------

create table if not exists public.results_consent_rounds (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  round_id uuid not null references public.rounds(id),
  consented boolean not null,
  consent_text_version text not null,
  consented_at timestamptz,
  withdrawn_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, round_id),
  constraint results_consent_rounds_text_version_not_blank check (length(btrim(consent_text_version)) > 0)
);

alter table public.results_consent_rounds enable row level security;

revoke all on public.results_consent_rounds from anon;
revoke delete, truncate, references, trigger on public.results_consent_rounds from authenticated;

drop policy if exists results_consent_rounds_select_own_or_admin on public.results_consent_rounds;
create policy results_consent_rounds_select_own_or_admin
  on public.results_consent_rounds
  for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists results_consent_rounds_insert_own on public.results_consent_rounds;
create policy results_consent_rounds_insert_own
  on public.results_consent_rounds
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and round_id = (select public.current_open_round_id())
  );

drop policy if exists results_consent_rounds_update_own on public.results_consent_rounds;
create policy results_consent_rounds_update_own
  on public.results_consent_rounds
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.results_consent_rounds_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.round_id <> old.round_id) then
    raise exception 'results_consent_rounds.user_id and round_id cannot be changed' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.consented_at := case when new.consented then now() else null end;
    new.withdrawn_at := case when new.consented then null else now() end;
  else
    if new.consented and not old.consented then
      new.consented_at := now();
      new.withdrawn_at := null;
    elsif not new.consented and old.consented then
      new.consented_at := old.consented_at;
      new.withdrawn_at := now();
    else
      new.consented_at := old.consented_at;
      new.withdrawn_at := old.withdrawn_at;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists results_consent_rounds_before_write on public.results_consent_rounds;
create trigger results_consent_rounds_before_write
  before insert or update on public.results_consent_rounds
  for each row execute function public.results_consent_rounds_before_write();

-- ---------------------------------------------------------------------------
-- 6. admin_round_responses: same signature and columns as 20261018000100
--    section 8, so no drop is needed. Only the consent source changes:
--    the Session 1 round id reads the legacy results_consent table (its
--    output is therefore identical to today's); every other round reads
--    results_consent_rounds for that round.
-- ---------------------------------------------------------------------------

create or replace function public.admin_round_responses(p_round_id uuid)
returns table (
  response_id uuid,
  user_email text,
  started_at timestamptz,
  submitted_at timestamptz,
  statement_key text,
  value smallint,
  choice_values smallint[],
  results_opted_in boolean,
  results_opted_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_legacy boolean := (p_round_id = '6bf90e9e-c628-4592-8e39-cc9c16440ea3'::uuid);
begin
  if not public.is_admin() then
    raise exception 'Only admins can read individual responses'
      using errcode = '42501', hint = 'not_admin';
  end if;

  return query
    select
      responses.id as response_id,
      users.email::text as user_email,
      responses.created_at as started_at,
      responses.submitted_at as submitted_at,
      statements.key as statement_key,
      answers.value as value,
      answers.choice_values as choice_values,
      coalesce(case when v_legacy then rc.consented else rcr.consented end, false) as results_opted_in,
      case
        when v_legacy then (case when rc.consented then rc.consented_at else null end)
        else (case when rcr.consented then rcr.consented_at else null end)
      end as results_opted_in_at
    from public.responses
    join auth.users as users on users.id = responses.user_id
    left join public.answers on answers.response_id = responses.id
    left join public.statements on statements.id = answers.statement_id
    left join public.results_consent rc on v_legacy and rc.user_id = responses.user_id
    left join public.results_consent_rounds rcr
      on not v_legacy
      and rcr.user_id = responses.user_id
      and rcr.round_id = responses.round_id
    where responses.round_id = p_round_id
    order by users.email, statements.key nulls first;
end;
$$;

revoke execute on function public.admin_round_responses(uuid) from public, anon;
grant execute on function public.admin_round_responses(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Comments.
-- ---------------------------------------------------------------------------

comment on column public.sections.show_overview is $t$Presentation only: when true, presentation mode adds a closing overview slide after the section's rating statements, ranking them by average rating. On a section whose statement is a ranking, presentation mode shows the ranking as a numbered most-to-least-popular list instead of bars. The participant UI ignores it.$t$;

comment on column public.statements.kind is $t$scale | choice_one | choice_multi | choice_exact | prediction | rating | two_ended | choice_up_to | ranking.$t$;

comment on table public.results_consent_rounds is $t$Per-session opt-in to having questionnaires securely saved and returned. One row per (auth user, round); RLS restricts to own row or admin. Session 1's record stays in results_consent.$t$;

-- ---------------------------------------------------------------------------
-- 8. Freeze the legacy Session 1 consent table.
--    Session 1 is closed and the app no longer reads or writes
--    results_consent (consent is per round in results_consent_rounds). Until
--    now a signed-in participant could still insert or update their own row
--    by calling Supabase directly. Drop those write policies and revoke the
--    privileges so the 94 recorded Session 1 choices stay exactly as given.
--    SELECT (own row or admin) is kept; service_role is unaffected.
-- ---------------------------------------------------------------------------

drop policy if exists results_consent_insert_own on public.results_consent;
drop policy if exists results_consent_update_own on public.results_consent;
revoke insert, update on public.results_consent from authenticated;
