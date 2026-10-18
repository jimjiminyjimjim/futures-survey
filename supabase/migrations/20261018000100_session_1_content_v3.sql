-- Quick task 261018-qck (Session 1 content v3, new question kinds,
-- presentation reveal, results opt-in): replaces Session 1's content with
-- the user's v3 content ("Holding space for scepticism"), adds the
-- question kinds that content needs (rating 0-10, two_ended, choice_up_to),
-- a rounds.intro column, per-item statement columns (label, context,
-- question, reveal_text, left_label, right_label), and a per-person
-- results_consent table (opt-in to having questionnaires saved, RLS,
-- withdrawable). Sessions 2 and 3 are untouched.
--
-- Forward-only: no BEGIN/COMMIT (the Supabase CLI wraps each migration file
-- in its own transaction), and $t$...$t$ dollar quoting for every text
-- literal, matching 20261017000100.
--
-- Once this migration has been applied to the hosted project, NEVER edit it
-- again -- fixes are forward migrations.

-- ---------------------------------------------------------------------------
-- 1. Session 1 data guard: refuse if any response belongs to a non-demo
--    user, then clear Session 1's answers and responses (answers ->
--    statements has no cascade, so the old statements can't be replaced
--    until their answers are gone).
-- ---------------------------------------------------------------------------

do $$
declare
  v_round_id uuid;
  v_bad_count int;
begin
  select r.id into v_round_id
  from public.rounds r
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$
    and r.session_number = 1;

  if v_round_id is null then
    raise exception 'session_1_content_v3: Session 1 round not found';
  end if;

  select count(*) into v_bad_count
  from public.responses resp
  join auth.users u on u.id = resp.user_id
  where resp.round_id = v_round_id
    and u.email !~ '^demo\.[0-9]{2}@example\.com$';

  if v_bad_count > 0 then
    raise exception 'session_1_content_v3: Session 1 has non-demo responses — resolve manually before applying';
  end if;

  delete from public.answers a
  using public.responses resp
  where a.response_id = resp.id
    and resp.round_id = v_round_id;

  delete from public.responses
  where round_id = v_round_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. rounds.intro: participant-readable through the existing
--    rounds_select_open_round policy (no new policy needed).
-- ---------------------------------------------------------------------------

alter table public.rounds add column if not exists intro text;

alter table public.rounds drop constraint if exists rounds_intro_not_blank;
alter table public.rounds
  add constraint rounds_intro_not_blank check (intro is null or length(btrim(intro)) > 0);

-- ---------------------------------------------------------------------------
-- 3. sections_label_shape: allow the A-F letter labels alongside the
--    existing numeric ones.
-- ---------------------------------------------------------------------------

alter table public.sections drop constraint if exists sections_label_shape;
alter table public.sections
  add constraint sections_label_shape
  check (label is null or label ~ '^([0-9]{1,3}[a-z]?|[A-Z][0-9]?)$');

-- ---------------------------------------------------------------------------
-- 4. statements: new per-item columns + widened kind/options/choice_count
--    constraints + the new end-labels-by-kind constraint.
-- ---------------------------------------------------------------------------

alter table public.statements add column if not exists label text;
alter table public.statements add column if not exists context text;
alter table public.statements add column if not exists question text;
alter table public.statements add column if not exists reveal_text text;
alter table public.statements add column if not exists left_label text;
alter table public.statements add column if not exists right_label text;

alter table public.statements drop constraint if exists statements_label_shape;
alter table public.statements
  add constraint statements_label_shape
  check (label is null or label ~ '^([0-9]{1,3}[a-z]?|[A-Z][0-9]?)$');

alter table public.statements drop constraint if exists statements_context_not_blank;
alter table public.statements
  add constraint statements_context_not_blank check (context is null or length(btrim(context)) > 0);

alter table public.statements drop constraint if exists statements_question_not_blank;
alter table public.statements
  add constraint statements_question_not_blank check (question is null or length(btrim(question)) > 0);

alter table public.statements drop constraint if exists statements_reveal_text_not_blank;
alter table public.statements
  add constraint statements_reveal_text_not_blank check (reveal_text is null or length(btrim(reveal_text)) > 0);

alter table public.statements drop constraint if exists statements_left_label_not_blank;
alter table public.statements
  add constraint statements_left_label_not_blank check (left_label is null or length(btrim(left_label)) > 0);

alter table public.statements drop constraint if exists statements_right_label_not_blank;
alter table public.statements
  add constraint statements_right_label_not_blank check (right_label is null or length(btrim(right_label)) > 0);

alter table public.statements drop constraint if exists statements_kind_valid;
alter table public.statements
  add constraint statements_kind_valid
  check (kind in ('scale', 'choice_one', 'choice_multi', 'choice_exact', 'prediction', 'rating', 'two_ended', 'choice_up_to'));

alter table public.statements drop constraint if exists statements_options_by_kind;
alter table public.statements
  add constraint statements_options_by_kind
  check ((kind in ('choice_one', 'choice_multi', 'choice_exact', 'choice_up_to')) = (options is not null));

alter table public.statements drop constraint if exists statements_choice_count_by_kind;
alter table public.statements
  add constraint statements_choice_count_by_kind
  check (
    (kind in ('choice_exact', 'choice_up_to')) = (choice_count is not null)
    and (
      choice_count is null
      or (choice_count >= 1 and options is not null and choice_count < jsonb_array_length(options))
    )
  );

alter table public.statements drop constraint if exists statements_end_labels_by_kind;
alter table public.statements
  add constraint statements_end_labels_by_kind
  check (
    case
      when kind in ('rating', 'two_ended') then left_label is not null and right_label is not null
      else left_label is null and right_label is null
    end
  );

-- ---------------------------------------------------------------------------
-- 5. answers_before_write: rating (0..10), two_ended (0..100) single-value
--    kinds; choice_up_to (1..choice_count distinct options, exclusive must
--    be alone) joins the list kinds.
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

  if v_kind in ('choice_one', 'choice_multi', 'choice_exact', 'choice_up_to') then
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
    new.choice_values := (select array_agg(x order by x) from unnest(new.choice_values) as u(x));
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
  end if;

  new.answered_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. public.results_consent: per-person opt-in to having questionnaires
--    saved and returned. RLS: own row (select/insert/update), admin can
--    select all, no delete. Timestamps are DB-clock-stamped, never
--    client-supplied.
-- ---------------------------------------------------------------------------

create table if not exists public.results_consent (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  consented boolean not null,
  consent_text_version text not null,
  consented_at timestamptz,
  withdrawn_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint results_consent_text_version_not_blank check (length(btrim(consent_text_version)) > 0)
);

alter table public.results_consent enable row level security;

revoke all on public.results_consent from anon;
revoke delete, truncate, references, trigger on public.results_consent from authenticated;

drop policy if exists results_consent_select_own_or_admin on public.results_consent;
create policy results_consent_select_own_or_admin
  on public.results_consent
  for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists results_consent_insert_own on public.results_consent;
create policy results_consent_insert_own
  on public.results_consent
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists results_consent_update_own on public.results_consent;
create policy results_consent_update_own
  on public.results_consent
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.results_consent_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'results_consent.user_id cannot be changed' using errcode = '23514';
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

drop trigger if exists results_consent_before_write on public.results_consent;
create trigger results_consent_before_write
  before insert or update on public.results_consent
  for each row execute function public.results_consent_before_write();

-- ---------------------------------------------------------------------------
-- 7. Admin aggregates: widen the scale/choice kind filters.
-- ---------------------------------------------------------------------------

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
      and statements.kind in ('scale', 'rating', 'two_ended')
      and answers.value is not null
    group by statements.id, statements.key, answers.value
    order by statements.key, answers.value;
end;
$$;

create or replace function public.admin_statement_choice_counts(p_round_id uuid)
returns table (
  statement_id uuid,
  statement_key text,
  kind text,
  value smallint,
  label text,
  exclusive boolean,
  answer_count bigint,
  respondent_count bigint
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
      select a.statement_id, a.value, a.choice_values
      from public.answers a
      join public.responses r on r.id = a.response_id
      where a.round_id = p_round_id
        and r.submitted_at is not null
    ),
    picks as (
      select s.statement_id, s.value as picked
      from submitted s
      where s.value is not null
      union all
      select s.statement_id, u.x as picked
      from submitted s
      cross join lateral unnest(s.choice_values) as u(x)
      where s.choice_values is not null
    ),
    respondents as (
      select s.statement_id, count(*) as n
      from submitted s
      group by s.statement_id
    )
    select
      st.id as statement_id,
      st.key as statement_key,
      st.kind as kind,
      o.value as value,
      o.label as label,
      o.exclusive as exclusive,
      (select count(*) from picks p where p.statement_id = st.id and p.picked = o.value) as answer_count,
      coalesce((select n from respondents rs where rs.statement_id = st.id), 0) as respondent_count
    from public.statements st
    cross join lateral (
      select
        (e ->> 'value')::smallint as value,
        e ->> 'label' as label,
        coalesce((e ->> 'exclusive')::boolean, false) as exclusive,
        t.ord
      from jsonb_array_elements(st.options) with ordinality as t(e, ord)
    ) as o
    where st.round_id = p_round_id
      and st.kind in ('choice_one', 'choice_multi', 'choice_exact', 'choice_up_to')
    order by st.key, o.ord;
end;
$$;

revoke execute on function public.admin_statement_answer_counts(uuid) from public, anon;
grant execute on function public.admin_statement_answer_counts(uuid) to authenticated, service_role;
revoke execute on function public.admin_statement_choice_counts(uuid) from public, anon;
grant execute on function public.admin_statement_choice_counts(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. admin_round_responses: + results_opted_in / results_opted_in_at, left
--    joined from results_consent by user_id. Still the only
--    identity-bearing read; call sites stay limited to
--    src/lib/admin/responses-queries.ts and the CSV export route.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_round_responses(uuid);

create function public.admin_round_responses(p_round_id uuid)
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
      coalesce(rc.consented, false) as results_opted_in,
      case when rc.consented then rc.consented_at else null end as results_opted_in_at
    from public.responses
    join auth.users as users on users.id = responses.user_id
    left join public.answers on answers.response_id = responses.id
    left join public.statements on statements.id = answers.statement_id
    left join public.results_consent rc on rc.user_id = responses.user_id
    where responses.round_id = p_round_id
    order by users.email, statements.key nulls first;
end;
$$;

revoke execute on function public.admin_round_responses(uuid) from public, anon;
grant execute on function public.admin_round_responses(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. admin_create_survey / admin_create_round: carry the new columns
--    (rounds.intro, statements.label/context/question/reveal_text/
--    left_label/right_label) when copying content forward.
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_survey(p_title text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest_survey_id uuid;
  v_new_survey_id uuid;
  v_survey_count int;
  v_next_round_number int;
  v_source_round_id uuid;
  v_source_title text;
  v_source_intro text;
  v_new_round_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can create surveys' using errcode = '42501', hint = 'not_admin';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.admin_create_survey'));

  select id into v_latest_survey_id
  from public.surveys
  order by created_at desc
  limit 1;

  select count(*) into v_survey_count from public.surveys;

  insert into public.surveys (title)
  values (coalesce(nullif(btrim(p_title), ''), 'Survey ' || (v_survey_count + 1)::text))
  returning id into v_new_survey_id;

  for v_session_number in 1..3 loop
    select coalesce(max(round_number), 0) + 1 into v_next_round_number from public.rounds;

    v_source_round_id := null;
    v_source_title := null;
    v_source_intro := null;
    select r.id, r.title, r.intro into v_source_round_id, v_source_title, v_source_intro
    from public.rounds r
    where r.survey_id = v_latest_survey_id and r.session_number = v_session_number;

    insert into public.rounds (round_number, title, survey_id, session_number, intro)
    values (
      v_next_round_number,
      coalesce(v_source_title, 'Session ' || v_session_number),
      v_new_survey_id,
      v_session_number,
      v_source_intro
    )
    returning id into v_new_round_id;

    if v_source_round_id is not null then
      insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt)
      select v_new_round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt
      from public.sections
      where round_id = v_source_round_id;

      insert into public.statements (
        round_id, section_id, sort_order, key, text, kind, options, choice_count, is_key, optional,
        label, context, question, reveal_text, left_label, right_label
      )
      select
        v_new_round_id, ns.id, st.sort_order, st.key, st.text, st.kind, st.options, st.choice_count, st.is_key, st.optional,
        st.label, st.context, st.question, st.reveal_text, st.left_label, st.right_label
      from public.statements st
      join public.sections os on os.id = st.section_id and os.round_id = v_source_round_id
      join public.sections ns on ns.round_id = v_new_round_id and ns.sort_order = os.sort_order
      where st.kind <> 'prediction';

      insert into public.statements (
        round_id, section_id, sort_order, key, text, kind, prediction_of, is_key, optional,
        label, context, question, reveal_text, left_label, right_label
      )
      select
        v_new_round_id, ns.id, st.sort_order, st.key, st.text, st.kind, nt.id, st.is_key, st.optional,
        st.label, st.context, st.question, st.reveal_text, st.left_label, st.right_label
      from public.statements st
      join public.sections os on os.id = st.section_id and os.round_id = v_source_round_id
      join public.sections ns on ns.round_id = v_new_round_id and ns.sort_order = os.sort_order
      join public.statements ot on ot.id = st.prediction_of
      join public.statements nt on nt.round_id = v_new_round_id and nt.key = ot.key
      where st.kind = 'prediction';
    end if;
  end loop;

  return v_new_survey_id;
end;
$$;

revoke execute on function public.admin_create_survey(text) from public, anon;
grant execute on function public.admin_create_survey(text) to authenticated, service_role;

create or replace function public.admin_create_round(p_title text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_round_id uuid;
  v_source_intro text;
  v_survey_id uuid;
  v_next_number int;
  v_next_session int;
  v_new_round_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can create rounds' using errcode = '42501', hint = 'not_admin';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.admin_create_round'));

  select id, survey_id, intro into v_source_round_id, v_survey_id, v_source_intro
  from public.rounds
  order by round_number desc
  limit 1;

  if v_survey_id is null then
    select id into v_survey_id from public.surveys order by created_at desc limit 1;
  end if;

  if v_survey_id is null then
    raise exception 'No survey exists to add a session to.' using errcode = 'P0002', hint = 'survey_not_found';
  end if;

  if v_source_round_id is not null then
    perform pg_advisory_xact_lock(hashtext('public.round_content:' || v_source_round_id::text));
  end if;

  select coalesce(max(session_number), 0) + 1 into v_next_session
  from public.rounds
  where survey_id = v_survey_id;

  if v_next_session > 3 then
    raise exception 'This survey already has all 3 sessions.' using errcode = '23514', hint = 'survey_full';
  end if;

  select coalesce(max(round_number), 0) + 1 into v_next_number from public.rounds;

  insert into public.rounds (round_number, title, survey_id, session_number, intro)
  values (
    v_next_number,
    coalesce(nullif(btrim(p_title), ''), 'Session ' || v_next_session),
    v_survey_id,
    v_next_session,
    v_source_intro
  )
  returning id into v_new_round_id;

  if v_source_round_id is not null then
    insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt)
    select v_new_round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt
    from public.sections
    where round_id = v_source_round_id;

    insert into public.statements (
      round_id, section_id, sort_order, key, text, kind, options, choice_count, is_key, optional,
      label, context, question, reveal_text, left_label, right_label
    )
    select
      v_new_round_id, ns.id, st.sort_order, st.key, st.text, st.kind, st.options, st.choice_count, st.is_key, st.optional,
      st.label, st.context, st.question, st.reveal_text, st.left_label, st.right_label
    from public.statements st
    join public.sections os on os.id = st.section_id and os.round_id = v_source_round_id
    join public.sections ns on ns.round_id = v_new_round_id and ns.sort_order = os.sort_order
    where st.kind <> 'prediction';

    insert into public.statements (
      round_id, section_id, sort_order, key, text, kind, prediction_of, is_key, optional,
      label, context, question, reveal_text, left_label, right_label
    )
    select
      v_new_round_id, ns.id, st.sort_order, st.key, st.text, st.kind, nt.id, st.is_key, st.optional,
      st.label, st.context, st.question, st.reveal_text, st.left_label, st.right_label
    from public.statements st
    join public.sections os on os.id = st.section_id and os.round_id = v_source_round_id
    join public.sections ns on ns.round_id = v_new_round_id and ns.sort_order = os.sort_order
    join public.statements ot on ot.id = st.prediction_of
    join public.statements nt on nt.round_id = v_new_round_id and nt.key = ot.key
    where st.kind = 'prediction';
  end if;

  return v_new_round_id;
end;
$$;

revoke execute on function public.admin_create_round(text) from public, anon;
grant execute on function public.admin_create_round(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Content: replace Session 1's sections/statements with the v3
--     content, update its title/intro, update the familiarity scale
--     labels. The content-lock guard triggers refuse writes to an opened
--     round for every role, so they're disabled for this transaction only.
-- ---------------------------------------------------------------------------

alter table public.sections disable trigger sections_before_write;
alter table public.statements disable trigger statements_before_write;

delete from public.sections sec
using public.rounds r, public.surveys s
where sec.round_id = r.id
  and r.survey_id = s.id
  and s.title = $t$Becoming a Designer Questionnaire$t$
  and r.session_number = 1;

update public.rounds r
set
  title = $t$Session 1: Holding space for scepticism$t$,
  intro = $t$8 quick questions, about 10 minutes. All answers will be anonymous. There are no right answers we are interested in your honest response throughout. This is not a test.$t$
from public.surveys s
where r.survey_id = s.id
  and s.title = $t$Becoming a Designer Questionnaire$t$
  and r.session_number = 1;

insert into public.sections (round_id, sort_order, label, title, prompt, scale_key)
select r.id, v.sort_order, v.label, v.title, v.prompt, v.scale_key
from (
  values
    (1, $t$A$t$, $t$Existing knowledge and understanding$t$, $t$How familiar are you with the following concepts and principles?$t$, $t$familiarity$t$),
    (2, $t$B$t$, $t$Where we meet sustainability in the real world$t$, $t$Four quick trust checks, one per slide$t$, $t$agreement$t$),
    (3, $t$C$t$, $t$When trust is broken$t$, $t$Think of a time a promise from a company, organisation or public figure turned out to be empty. How much did you feel…$t$, $t$agreement$t$),
    (4, $t$D$t$, $t$How we protect ourselves$t$, $t$When you hold back your trust, what’s usually behind it?$t$, $t$agreement$t$),
    (5, $t$E$t$, $t$How scepticism affects me$t$, $t$When you’re sceptical about the promises you hear, how much does it…$t$, $t$agreement$t$),
    (6, $t$F$t$, $t$Hope and trust$t$, $t$If you could, how much would you like to be able to trust…$t$, $t$agreement$t$)
) as v(sort_order, label, title, prompt, scale_key)
cross join public.rounds r
join public.surveys s on s.id = r.survey_id
where s.title = $t$Becoming a Designer Questionnaire$t$
  and r.session_number = 1
on conflict (round_id, sort_order) do nothing;

insert into public.statements (
  round_id, section_id, sort_order, key, text, kind,
  options, choice_count, left_label, right_label, label, context, question, reveal_text
)
select r.id, sec.id, v.sort_order, v.key, v.text, v.kind,
  v.options, v.choice_count, v.left_label, v.right_label, v.label, v.context, v.question, v.reveal_text
from (
  values
    -- A, kind scale (13 terms)
    (1, $t$A$t$, 1, $t$sa_01$t$, $t$Sustainability$t$, $t$scale$t$, null::jsonb, null::smallint, null::text, null::text, null::text, null::text, null::text, null::text),
    (1, $t$A$t$, 2, $t$sa_02$t$, $t$Carbon Footprint$t$, $t$scale$t$, null::jsonb, null::smallint, null::text, null::text, null::text, null::text, null::text, null::text),
    (1, $t$A$t$, 3, $t$sa_03$t$, $t$Life Cycle Assessment (LCA)$t$, $t$scale$t$, null::jsonb, null::smallint, null::text, null::text, null::text, null::text, null::text, null::text),
    (1, $t$A$t$, 4, $t$sa_04$t$, $t$Circular Economy$t$, $t$scale$t$, null::jsonb, null::smallint, null::text, null::text, null::text, null::text, null::text, null::text),
    (1, $t$A$t$, 5, $t$sa_05$t$, $t$Regenerative Design$t$, $t$scale$t$, null::jsonb, null::smallint, null::text, null::text, null::text, null::text, null::text, null::text),
    (1, $t$A$t$, 6, $t$sa_06$t$, $t$Design Activism$t$, $t$scale$t$, null::jsonb, null::smallint, null::text, null::text, null::text, null::text, null::text, null::text),
    (1, $t$A$t$, 7, $t$sa_07$t$, $t$Inclusive Design$t$, $t$scale$t$, null::jsonb, null::smallint, null::text, null::text, null::text, null::text, null::text, null::text),
    (1, $t$A$t$, 8, $t$sa_08$t$, $t$Greenwashing$t$, $t$scale$t$, null::jsonb, null::smallint, null::text, null::text, null::text, null::text, null::text, null::text),
    (1, $t$A$t$, 9, $t$sa_09$t$, $t$More-Than-Human Design$t$, $t$scale$t$, null::jsonb, null::smallint, null::text, null::text, null::text, null::text, null::text, null::text),
    (1, $t$A$t$, 10, $t$sa_10$t$, $t$Systemic Design$t$, $t$scale$t$, null::jsonb, null::smallint, null::text, null::text, null::text, null::text, null::text, null::text),
    (1, $t$A$t$, 11, $t$sa_11$t$, $t$Three Horizons Framework$t$, $t$scale$t$, null::jsonb, null::smallint, null::text, null::text, null::text, null::text, null::text, null::text),
    (1, $t$A$t$, 12, $t$sa_12$t$, $t$Digital Product Passport$t$, $t$scale$t$, null::jsonb, null::smallint, null::text, null::text, null::text, null::text, null::text, null::text),
    (1, $t$A$t$, 13, $t$sa_13$t$, $t$Transdisciplinary Design$t$, $t$scale$t$, null::jsonb, null::smallint, null::text, null::text, null::text, null::text, null::text, null::text),
    -- B, kind rating, each with its own label/context/question/reveal_text
    (2, $t$B$t$, 1, $t$sb_2a$t$, $t$“[We continue] to push more responsible and circular production practices.”$t$, $t$rating$t$,
      null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, $t$2a$t$, $t$Shein (2023)$t$,
      $t$Gut reaction, no right answers: how much do you trust this?$t$,
      $t$Italy’s competition authority fined Shein €1m in 2025 for misleading green claims, including claims about circularity.$t$),
    (2, $t$B$t$, 2, $t$sb_2b$t$, $t$To become “a net-zero emissions energy business” by 2050.$t$, $t$rating$t$,
      null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, $t$2b$t$, $t$Shell (2020)$t$,
      $t$Gut reaction, no right answers: how much do you trust this?$t$,
      $t$in March 2024 Shell weakened its 2030 target. It changed a 20% cut in carbon intensity to a range of 15–20%. It dropped its 2035 target altogether, citing “uncertainty in the pace of change”. The 2050 goal remains, but Shell warns there is “significant risk” it may not meet it.$t$),
    (2, $t$B$t$, 3, $t$sb_2c$t$, $t$New petrol and diesel cars will no longer be sold from 2030.$t$, $t$rating$t$,
      null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, $t$2c$t$, $t$UK Government (2020)$t$,
      $t$Gut reaction, no right answers: how much do you trust this?$t$,
      $t$in September 2023, Rishi Sunak pushed it back to 2035.$t$),
    (2, $t$B$t$, 4, $t$sb_2d$t$, $t$“We exist to end exploitation in the cocoa industry.”$t$, $t$rating$t$,
      null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, $t$2d$t$, $t$Tony’s Chocolonely (2025)$t$,
      $t$Gut reaction, no right answers: how much do you trust this?$t$,
      $t$Tony’s reports much lower child labour in its long-term partner communities. The figures are its own, and the goal isn’t reached yet.$t$),
    -- C, kind rating, no own label/context/question (reads the section prompt), end labels Not at all / Completely
    (3, $t$C$t$, 1, $t$sc_01$t$, $t$Angry$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    (3, $t$C$t$, 2, $t$sc_02$t$, $t$Disappointed$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    (3, $t$C$t$, 3, $t$sc_03$t$, $t$Embarrassed that I’d believed it$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    (3, $t$C$t$, 4, $t$sc_04$t$, $t$Powerless$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    (3, $t$C$t$, 5, $t$sc_05$t$, $t$A sense of loss, as if something I’d hoped for had gone$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    (3, $t$C$t$, 6, $t$sc_06$t$, $t$Unsurprised$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    (3, $t$C$t$, 7, $t$sc_07$t$, $t$Numb, as if I’d stopped caring$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    -- D, kind choice_up_to, choice_count 3
    (4, $t$D$t$, 1, $t$sd_01$t$, $t$When you hold back your trust, what’s usually behind it?$t$, $t$choice_up_to$t$,
      $t$[{"value":1,"label":"I’ve been let down before"},{"value":2,"label":"Promises are often vague or impossible to check"},{"value":3,"label":"The people making the promise gain from me believing it"},{"value":4,"label":"I don’t want to look naive or be taken for a fool"},{"value":5,"label":"It feels safer to expect the worst"},{"value":6,"label":"The people around me are sceptical too"},{"value":7,"label":"I don’t usually hold back my trust","exclusive":true}]$t$::jsonb,
      3, null::text, null::text, null::text, null::text, null::text, null::text),
    -- E, kind rating
    (5, $t$E$t$, 1, $t$se_01$t$, $t$Protect me from putting hope into things that won’t deliver$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    (5, $t$E$t$, 2, $t$se_02$t$, $t$Help me see through hype and spin$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    (5, $t$E$t$, 3, $t$se_03$t$, $t$Exhaust my positive energy and sense of hope$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    (5, $t$E$t$, 4, $t$se_04$t$, $t$Make it harder to believe my work could make a difference$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    (5, $t$E$t$, 5, $t$se_05$t$, $t$Make me more determined to do things better$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    -- F, kind rating (5 items)
    (6, $t$F$t$, 1, $t$sf_01$t$, $t$…my own judgement about what’s real and what’s hype$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    (6, $t$F$t$, 2, $t$sf_02$t$, $t$…that change is genuinely possible$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    (6, $t$F$t$, 3, $t$sf_03$t$, $t$…that my effort will be worth it$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    (6, $t$F$t$, 4, $t$sf_04$t$, $t$…that others care as much as I do$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    (6, $t$F$t$, 5, $t$sf_05$t$, $t$…that I won’t be alone in trying$t$, $t$rating$t$, null::jsonb, null::smallint, $t$Not at all$t$, $t$Completely$t$, null::text, null::text, null::text, null::text),
    -- F, kind choice_one
    (6, $t$F$t$, 6, $t$sf_06$t$, $t$Which is closest to where you are right now?$t$, $t$choice_one$t$,
      $t$[{"value":1,"label":"I’m hopeful, and ready to be part of the change"},{"value":2,"label":"I want to hope, but broken trust makes it hard"},{"value":3,"label":"My hope comes and goes"},{"value":4,"label":"I’m protecting myself by not hoping too much"},{"value":5,"label":"I’ve mostly given up on it, at least for now"},{"value":6,"label":"I’m not sure"}]$t$::jsonb,
      null::smallint, null::text, null::text, null::text, null::text, null::text, null::text),
    -- F, kind two_ended
    (6, $t$F$t$, 7, $t$sf_07$t$, $t$Where do you think most people in this room are right now?$t$, $t$two_ended$t$,
      null::jsonb, null::smallint, $t$Mostly given up on it$t$, $t$Hopeful, and ready to be part of the change$t$, null::text, null::text, null::text, null::text)
) as v(section_sort_order, section_label, sort_order, key, text, kind, options, choice_count, left_label, right_label, label, context, question, reveal_text)
cross join public.rounds r
join public.surveys s on s.id = r.survey_id and s.title = $t$Becoming a Designer Questionnaire$t$
join public.sections sec on sec.round_id = r.id and sec.label = v.section_label
where r.session_number = 1
on conflict (round_id, key) do nothing;

alter table public.sections enable trigger sections_before_write;
alter table public.statements enable trigger statements_before_write;

-- Familiarity scale labels: curly apostrophes to match the brief exactly.
update public.scale_options
set label = $t$I’ve never heard of it$t$
where scale_key = $t$familiarity$t$ and value = 1;

update public.scale_options
set label = $t$I’ve heard of it but couldn’t explain it$t$
where scale_key = $t$familiarity$t$ and value = 2;

-- Sanity: refuse to commit unless the content matches the Session 1 v3
-- content map (6 sections / 37 statements) and Sessions 2/3 are untouched.
do $$
declare
  v_check text;
begin
  select string_agg(
    format('%s:%s/%s', r.session_number, (select count(*) from public.sections x where x.round_id = r.id),
      (select count(*) from public.statements x where x.round_id = r.id)),
    ' ' order by r.session_number
  )
  into v_check
  from public.rounds r
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$;

  if v_check is distinct from '1:6/37 2:5/47 3:5/61' then
    raise exception 'session_1_content_v3 content check failed: got %', v_check;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Comments
-- ---------------------------------------------------------------------------

comment on table public.results_consent is 'Per-person opt-in to having questionnaires securely saved and returned. One row per auth user; RLS restricts to own row or admin.';
comment on column public.results_consent.consent_text_version is 'Wording version shown at the time of (last) consent decision, e.g. 2026-10-18.';
comment on column public.results_consent.consented_at is 'DB-clock timestamp of the most recent opt-in. Never client-supplied.';
comment on column public.results_consent.withdrawn_at is 'DB-clock timestamp of the most recent withdrawal, if currently withdrawn.';
comment on function public.results_consent_before_write() is 'Stamps consented_at/withdrawn_at/updated_at from the DB clock; refuses a user_id change.';
comment on column public.rounds.intro is 'Participant-facing intro copy shown on the start screen, verbatim.';
comment on column public.statements.label is 'Item sub-label, e.g. 2a, shown above the statement text.';
comment on column public.statements.context is 'Source line shown above the statement text, e.g. "Shein (2023)".';
comment on column public.statements.question is 'Per-item question shown below the statement text; overrides the section prompt.';
comment on column public.statements.reveal_text is 'Presentation-only reveal text, shown with the results. Never selected by participant-facing code.';
comment on column public.statements.left_label is 'rating/two_ended: label at the low end of the scale.';
comment on column public.statements.right_label is 'rating/two_ended: label at the high end of the scale.';
comment on column public.statements.kind is 'scale | choice_one | choice_multi | choice_exact | prediction | rating | two_ended | choice_up_to.';
