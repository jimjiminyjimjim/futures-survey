-- Surveys v2 (user decision 2026-10-17): ONE survey ("Becoming a Designer
-- Questionnaire") made of 3 rounds, where each round is a SESSION with its
-- own sections and statements. Adds the surveys table, rounds.survey_id /
-- session_number, section labels (1, 2a, 11b ...) with parent titles and a
-- presentation-only discussion prompt, new statement kinds (choice_one,
-- choice_multi, choice_exact, prediction) with options / choice_count /
-- is_key / optional / prediction_of, answers.choice_values, per-kind answer
-- validation, required-only submit completeness, identity-free admin
-- aggregates for choice and prediction questions, and loads the v2 content
-- verbatim from .planning/SURVEY-CONTENT-v2.md.
--
-- LIVE DATA (approved by the user 2026-10-17): every existing answer and
-- response is test/demo data and is deleted here. The existing Round 1 row
-- keeps its id and its opens_at (so it stays OPEN) and becomes Session 1;
-- its old 7 sections / 85 statements are replaced by Session 1's content.
-- Sessions 2 and 3 are new draft rounds (opens_at/closes_at null).
--
-- STATEMENT KEY SCHEME: s{section label}_{question number, 2 digits}, where
-- the question number restarts per (sub)section exactly as in the source
-- content — e.g. s1_01 (Sustainability), s2a_09 (pick three), s3a_09 (the
-- prediction), s11b_12. Section labels are unique across the whole survey,
-- so these keys are unique across all three sessions, not just per round.
-- Keys created later by admin_add_statement keep that function's existing
-- r{round_number}_{nn} scheme, which can never collide with s*.
--
-- Idempotent where reasonable: create-if-not-exists, guarded backfills and
-- on-conflict-do-nothing content inserts. No BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in its own transaction already.
--
-- Once this migration has been applied to the hosted project, NEVER edit it
-- again — fixes are forward migrations.

-- ---------------------------------------------------------------------------
-- 0. Clear test/demo answers and responses (user-approved). answers first:
--    answers -> statements has no ON DELETE CASCADE, so the old Round 1
--    statements can only be replaced once no answer references them.
-- ---------------------------------------------------------------------------

delete from public.answers;
delete from public.responses;

-- ---------------------------------------------------------------------------
-- 1. public.surveys
-- ---------------------------------------------------------------------------

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_at timestamptz not null default now(),
  constraint surveys_title_not_blank check (length(btrim(title)) > 0),
  constraint surveys_title_unique unique (title)
);

alter table public.surveys enable row level security;

revoke all on public.surveys from anon;
revoke insert, update, delete, truncate, references, trigger on public.surveys from authenticated;

drop policy if exists surveys_select_admins on public.surveys;
create policy surveys_select_admins
  on public.surveys
  for select
  to authenticated
  using ((select public.is_admin()));

insert into public.surveys (title)
values ($t$Becoming a Designer Questionnaire$t$)
on conflict (title) do nothing;

-- ---------------------------------------------------------------------------
-- 2. rounds: survey_id + session_number. Round title = session title.
-- ---------------------------------------------------------------------------

alter table public.rounds add column if not exists survey_id uuid;
alter table public.rounds add column if not exists session_number smallint;

-- The existing Round 1 row becomes Session 1 (same id, same opens_at).
update public.rounds
set
  survey_id = (select id from public.surveys where title = $t$Becoming a Designer Questionnaire$t$),
  session_number = 1,
  title = $t$Session 1: What design is, trust and hope$t$
where round_number = 1
  and survey_id is null;

-- Sessions 2 and 3: new draft rounds.
insert into public.rounds (round_number, title, survey_id, session_number)
select v.round_number, v.title, s.id, v.round_number
from (
  values
    (2, $t$Session 2: Values, grades and not knowing$t$),
    (3, $t$Session 3: Making, sharing and designing with others$t$)
) as v(round_number, title)
cross join public.surveys s
where s.title = $t$Becoming a Designer Questionnaire$t$
on conflict (round_number) do nothing;

-- Any other pre-existing round (none on live today) is attached to the same
-- survey after the three sessions, so the not-null below can't fail. It
-- would need a session number > 3, which the check below forbids — so
-- refuse loudly instead of guessing.
do $$
begin
  if exists (select 1 from public.rounds where survey_id is null) then
    raise exception 'surveys_v2: unexpected round(s) without a survey — resolve manually before applying';
  end if;
end;
$$;

alter table public.rounds alter column survey_id set not null;
alter table public.rounds alter column session_number set not null;

alter table public.rounds drop constraint if exists rounds_survey_fk;
alter table public.rounds
  add constraint rounds_survey_fk
  foreign key (survey_id) references public.surveys(id);

alter table public.rounds drop constraint if exists rounds_session_number_range;
alter table public.rounds
  add constraint rounds_session_number_range check (session_number between 1 and 3);

alter table public.rounds drop constraint if exists rounds_survey_session_unique;
alter table public.rounds
  add constraint rounds_survey_session_unique unique (survey_id, session_number);

create index if not exists rounds_survey_id_idx on public.rounds (survey_id);

-- Participants may read the survey the currently open round belongs to
-- (its title only matters for the start screen) — nothing else.
drop policy if exists surveys_select_open_round on public.surveys;
create policy surveys_select_open_round
  on public.surveys
  for select
  to authenticated
  using (
    exists (
      select 1 from public.rounds r
      where r.survey_id = surveys.id
        and r.id = (select public.current_open_round_id())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. sections: label ("1", "2a", "11b"), parent_title ("What is design?"
--    for 2a/2b), discussion_prompt (presentation only — participant-facing
--    queries never select it).
-- ---------------------------------------------------------------------------

alter table public.sections add column if not exists label text;
alter table public.sections add column if not exists parent_title text;
alter table public.sections add column if not exists discussion_prompt text;

alter table public.sections drop constraint if exists sections_label_shape;
alter table public.sections
  add constraint sections_label_shape check (label is null or label ~ '^[0-9]{1,3}[a-z]?$');

alter table public.sections drop constraint if exists sections_parent_title_not_blank;
alter table public.sections
  add constraint sections_parent_title_not_blank
  check (parent_title is null or length(btrim(parent_title)) > 0);

alter table public.sections drop constraint if exists sections_discussion_prompt_not_blank;
alter table public.sections
  add constraint sections_discussion_prompt_not_blank
  check (discussion_prompt is null or length(btrim(discussion_prompt)) > 0);

alter table public.sections drop constraint if exists sections_round_label_unique;
alter table public.sections
  add constraint sections_round_label_unique unique (round_id, label);

-- ---------------------------------------------------------------------------
-- 4. statements: kind, options, choice_count, is_key, prediction_of,
--    optional.
-- ---------------------------------------------------------------------------

-- Options shape: a JSON array of 2..20 objects {value: int 1..50, label:
-- non-blank text, exclusive?: bool}, values distinct. plpgsql (not a single
-- SQL expression) so the ::int cast only ever runs on validated input.
create or replace function public.statement_options_valid(p_options jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_el jsonb;
  v_values int[] := '{}';
  v_value int;
begin
  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_options) < 2 or jsonb_array_length(p_options) > 20 then
    return false;
  end if;

  for v_el in select e from jsonb_array_elements(p_options) as t(e) loop
    if jsonb_typeof(v_el) <> 'object' then
      return false;
    end if;
    if jsonb_typeof(v_el -> 'value') is distinct from 'number'
      or (v_el ->> 'value') !~ '^[0-9]{1,2}$'
    then
      return false;
    end if;
    v_value := (v_el ->> 'value')::int;
    if v_value < 1 or v_value > 50 or v_value = any(v_values) then
      return false;
    end if;
    v_values := v_values || v_value;
    if jsonb_typeof(v_el -> 'label') is distinct from 'string'
      or length(btrim(v_el ->> 'label')) = 0
    then
      return false;
    end if;
    if v_el ? 'exclusive' and jsonb_typeof(v_el -> 'exclusive') <> 'boolean' then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke execute on function public.statement_options_valid(jsonb) from public, anon;
grant execute on function public.statement_options_valid(jsonb) to authenticated, service_role;

alter table public.statements add column if not exists kind text not null default 'scale';
alter table public.statements add column if not exists options jsonb;
alter table public.statements add column if not exists choice_count smallint;
alter table public.statements add column if not exists is_key boolean not null default false;
alter table public.statements add column if not exists prediction_of uuid;
alter table public.statements add column if not exists optional boolean not null default false;

alter table public.statements drop constraint if exists statements_kind_valid;
alter table public.statements
  add constraint statements_kind_valid
  check (kind in ('scale', 'choice_one', 'choice_multi', 'choice_exact', 'prediction'));

alter table public.statements drop constraint if exists statements_options_by_kind;
alter table public.statements
  add constraint statements_options_by_kind
  check ((kind in ('choice_one', 'choice_multi', 'choice_exact')) = (options is not null));

alter table public.statements drop constraint if exists statements_options_valid;
alter table public.statements
  add constraint statements_options_valid
  check (options is null or public.statement_options_valid(options));

alter table public.statements drop constraint if exists statements_choice_count_by_kind;
alter table public.statements
  add constraint statements_choice_count_by_kind
  check (
    (kind = 'choice_exact') = (choice_count is not null)
    and (
      choice_count is null
      or (choice_count >= 1 and options is not null and choice_count < jsonb_array_length(options))
    )
  );

alter table public.statements drop constraint if exists statements_prediction_by_kind;
alter table public.statements
  add constraint statements_prediction_by_kind
  check ((kind = 'prediction') = (prediction_of is not null));

alter table public.statements drop constraint if exists statements_prediction_not_self;
alter table public.statements
  add constraint statements_prediction_not_self
  check (prediction_of is null or prediction_of <> id);

-- Same-round target (composite FK onto statements_id_round_id_unique).
-- Deleting the target removes the prediction about it.
alter table public.statements drop constraint if exists statements_prediction_of_fk;
alter table public.statements
  add constraint statements_prediction_of_fk
  foreign key (prediction_of, round_id)
  references public.statements(id, round_id)
  on delete cascade;

create index if not exists statements_prediction_of_idx on public.statements (prediction_of);

-- statements_before_write (from 20261015000600) + the prediction target
-- rule: a prediction may only point at a 'scale' statement on the
-- agreement scale (the reveal is "% who agreed").
create or replace function public.statements_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.round_id <> old.round_id or new.section_id <> old.section_id then
      raise exception 'A statement cannot be moved to a different round or section.'
        using errcode = '23514', hint = 'immutable';
    end if;
    if new.key <> old.key then
      raise exception 'A statement''s key cannot change once created.'
        using errcode = '23514', hint = 'key_immutable';
    end if;
  end if;

  if not public.round_content_editable(new.round_id) then
    raise exception 'This round has opened — its sections and statements can no longer be edited.'
      using errcode = '23514', hint = 'round_locked';
  end if;

  if new.prediction_of is not null and not exists (
    select 1
    from public.statements t
    join public.sections sec on sec.id = t.section_id and sec.round_id = t.round_id
    where t.id = new.prediction_of
      and t.round_id = new.round_id
      and t.kind = 'scale'
      and sec.scale_key = 'agreement'
  ) then
    raise exception 'A prediction must refer to an agreement statement in the same round.'
      using errcode = '23514', hint = 'invalid_prediction_target';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. answers: value is now nullable (choice_multi/choice_exact use
--    choice_values instead) and ranges 0..100 (prediction %). Exactly one
--    of value / choice_values is set.
-- ---------------------------------------------------------------------------

alter table public.answers add column if not exists choice_values smallint[];

-- Drop the original inline `value between 1 and 10` check, whatever name
-- Postgres gave it.
do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.answers'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%value >= 1%'
      and pg_get_constraintdef(con.oid) like '%value <= 10%'
  loop
    execute format('alter table public.answers drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.answers alter column value drop not null;

alter table public.answers drop constraint if exists answers_value_range;
alter table public.answers
  add constraint answers_value_range check (value is null or value between 0 and 100);

alter table public.answers drop constraint if exists answers_one_payload;
alter table public.answers
  add constraint answers_one_payload check ((value is null) <> (choice_values is null));

alter table public.answers drop constraint if exists answers_choice_values_shape;
alter table public.answers
  add constraint answers_choice_values_shape
  check (
    choice_values is null
    or (
      cardinality(choice_values) between 1 and 20
      and array_position(choice_values, null) is null
    )
  );

-- answers_before_write (from 20261015000300), now validated per kind:
--   scale        value is an option on the section's scale
--   choice_one   value is one of the statement's options
--   choice_multi choice_values: non-empty, distinct, all options; an
--                exclusive option ("None of these") must be alone
--   choice_exact choice_values: exactly choice_count distinct options
--   prediction   value 0..100
-- choice_values are stored sorted ascending.
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

  if v_kind in ('choice_one', 'choice_multi', 'choice_exact') then
    select
      array_agg((e ->> 'value')::smallint),
      coalesce(
        array_agg((e ->> 'value')::smallint) filter (where coalesce((e ->> 'exclusive')::boolean, false)),
        '{}'::smallint[]
      )
    into v_option_values, v_exclusive_values
    from jsonb_array_elements(v_options) as t(e);
  end if;

  if v_kind in ('scale', 'choice_one', 'prediction') then
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
  end if;

  new.answered_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. responses_before_write (from 20261015000300): submit completeness now
--    counts only NON-optional statements (predictions are optional).
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
    select count(*) into v_total
    from public.statements
    where round_id = new.round_id and not optional;

    select count(*) into v_answered
    from public.answers a
    join public.statements st on st.id = a.statement_id
    where a.response_id = new.id and not st.optional;

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

-- ---------------------------------------------------------------------------
-- 7. Content: replace Round 1's old content and load all three sessions.
--    The content-lock guard triggers refuse writes to an OPENED round for
--    every role, so they are disabled for this transaction only and
--    re-enabled immediately after (same transaction — no window where
--    they're off for anyone else).
-- ---------------------------------------------------------------------------

alter table public.sections disable trigger sections_before_write;
alter table public.statements disable trigger statements_before_write;

-- Old (pre-v2, unlabelled) sections of the survey's rounds; statements
-- cascade.
delete from public.sections sec
using public.rounds r, public.surveys s
where sec.round_id = r.id
  and r.survey_id = s.id
  and s.title = $t$Becoming a Designer Questionnaire$t$
  and sec.label is null;

insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt)
select r.id, v.sort_order, v.label, v.parent_title, v.title, v.prompt, v.scale_key, v.discussion_prompt
from (
  values
    (1, 1, $t$1$t$, null, $t$The language of design and change$t$, $t$How familiar are you with the following ideas?$t$, $t$familiarity$t$, null),
    (1, 2, $t$2a$t$, $t$What is design?$t$, $t$What is a designer?$t$, $t$Thinking about what design is and what it could be, how much do you agree with the following?$t$, $t$agreement$t$, null),
    (1, 3, $t$2b$t$, $t$What is design?$t$, $t$What is design for?$t$, $t$Thinking about what design is and what it could be, how much do you agree with the following?$t$, $t$agreement$t$, null),
    (1, 4, $t$3a$t$, $t$Trust$t$, $t$Broken promises and why distrust feels safe$t$, $t$Thinking about who and what you trust, how much do you agree with the following?$t$, $t$agreement$t$, null),
    (1, 5, $t$3b$t$, $t$Trust$t$, $t$How trust is built$t$, $t$Thinking about who and what you trust, how much do you agree with the following?$t$, $t$agreement$t$, null),
    (1, 6, $t$4$t$, null, $t$Hope, agency and voice$t$, $t$Thinking about whether you can make a difference, how much do you agree with the following?$t$, $t$agreement$t$, null),
    (2, 1, $t$5$t$, null, $t$Values, generations and my future$t$, $t$Thinking about your future as a designer, how much do you agree with the following?$t$, $t$agreement$t$, null),
    (2, 2, $t$6a$t$, $t$Grades, risk and motivation$t$, $t$Grades and risk$t$, $t$Thinking about grades, risk and what motivates you, how much do you agree with the following?$t$, $t$agreement$t$, null),
    (2, 3, $t$6b$t$, $t$Grades, risk and motivation$t$, $t$What drives me$t$, $t$Thinking about grades, risk and what motivates you, how much do you agree with the following?$t$, $t$agreement$t$, null),
    (2, 4, $t$7a$t$, $t$Not knowing and effort$t$, $t$When it gets difficult$t$, $t$Thinking about what happens when learning becomes difficult, how much do you agree with the following?$t$, $t$agreement$t$, null),
    (2, 5, $t$7b$t$, $t$Not knowing and effort$t$, $t$Effort and the journey$t$, $t$Thinking about what happens when learning becomes difficult, how much do you agree with the following?$t$, $t$agreement$t$, null),
    (3, 1, $t$8$t$, null, $t$Making, hands and screens$t$, $t$Thinking about how you make things, how much do you agree with the following?$t$, $t$agreement$t$, null),
    (3, 2, $t$9$t$, null, $t$AI and becoming a designer$t$, $t$Thinking about AI and the designer you are becoming, how much do you agree with the following?$t$, $t$agreement$t$, null),
    (3, 3, $t$10$t$, null, $t$Asking questions and sharing work$t$, $t$Thinking about asking questions and sharing your work, how much do you agree with the following?$t$, $t$agreement$t$, null),
    (3, 4, $t$11a$t$, $t$Designing with others$t$, $t$Alone or together$t$, $t$Thinking about who you might work with, how much do you agree with the following?$t$, $t$agreement$t$, null),
    (3, 5, $t$11b$t$, $t$Designing with others$t$, $t$Designing with, not for$t$, $t$Thinking about who you might work with, how much do you agree with the following?$t$, $t$agreement$t$, $t$"It is the quality of our relationships that determines the quality of our lives." (Esther Perel)$t$)
) as v(round_number, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt)
join public.rounds r on r.round_number = v.round_number
join public.surveys s on s.id = r.survey_id and s.title = $t$Becoming a Designer Questionnaire$t$
on conflict (round_id, sort_order) do nothing;

insert into public.statements (round_id, section_id, sort_order, key, text, kind, options, choice_count, is_key, optional)
select r.id, sec.id, v.sort_order, v.key, v.text, v.kind, v.options, v.choice_count, v.is_key, v.optional
from (
  values
    (1, $t$1$t$, 1, $t$s1_01$t$, $t$Sustainability$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$1$t$, 2, $t$s1_02$t$, $t$Carbon Footprint$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$1$t$, 3, $t$s1_03$t$, $t$Life Cycle Assessment (LCA)$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$1$t$, 4, $t$s1_04$t$, $t$Circular Economy$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$1$t$, 5, $t$s1_05$t$, $t$Regenerative Design$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$1$t$, 6, $t$s1_06$t$, $t$Design Activism$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$1$t$, 7, $t$s1_07$t$, $t$Inclusive Design$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$1$t$, 8, $t$s1_08$t$, $t$Greenwashing$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$1$t$, 9, $t$s1_09$t$, $t$More-Than-Human Design$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$1$t$, 10, $t$s1_10$t$, $t$Systemic Design$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$1$t$, 11, $t$s1_11$t$, $t$Three Horizons Framework$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$1$t$, 12, $t$s1_12$t$, $t$Digital Product Passport$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$1$t$, 13, $t$s1_13$t$, $t$Transdisciplinary Design$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2a$t$, 1, $t$s2a_01$t$, $t$I think of myself as a creative person.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2a$t$, 2, $t$s2a_02$t$, $t$A successful designer is an individual with their own name, style and brand.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2a$t$, 3, $t$s2a_03$t$, $t$Designers don't work alone; they work as part of a team with other specialists and experts.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2a$t$, 4, $t$s2a_04$t$, $t$Designers are the creative ones; other professions should look to us for new ideas.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2a$t$, 5, $t$s2a_05$t$, $t$Designers are confident change makers and leaders who inspire others.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2a$t$, 6, $t$s2a_06$t$, $t$Ideas and innovation excite me.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2a$t$, 7, $t$s2a_07$t$, $t$Design is a practice: designers learn by doing, and mistakes are an important part of that.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2a$t$, 8, $t$s2a_08$t$, $t$I never want to fail; making mistakes is embarrassing.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2a$t$, 9, $t$s2a_09$t$, $t$What makes a good designer? (pick three)$t$, $t$choice_exact$t$, $t$[{"value":1,"label":"Being very good at drawing"},{"value":2,"label":"Being fun and creative"},{"value":3,"label":"Knowing the answer intuitively"},{"value":4,"label":"Asking a lot of questions"},{"value":5,"label":"Working with people who know more than them"},{"value":6,"label":"Making things people love"},{"value":7,"label":"Understanding the consequences of their work"},{"value":8,"label":"Listening to and considering other people's needs"}]$t$::jsonb, 3, false, false),
    (1, $t$2b$t$, 1, $t$s2b_01$t$, $t$Design is about solving problems and making desirable products.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2b$t$, 2, $t$s2b_02$t$, $t$Designers are great at making you want things you didn't realise you wanted!$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2b$t$, 3, $t$s2b_03$t$, $t$Design is superficial and pointless, but I love it anyway.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2b$t$, 4, $t$s2b_04$t$, $t$Designers are not the only ones responsible for change.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2b$t$, 5, $t$s2b_05$t$, $t$Designers have a responsibility to understand the wider consequences of what they create.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2b$t$, 6, $t$s2b_06$t$, $t$Making individual products more sustainable feels inadequate when the systems behind them stay the same.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2b$t$, 7, $t$s2b_07$t$, $t$Design can challenge the systems and assumptions that shape how we live.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2b$t$, 8, $t$s2b_08$t$, $t$I care about the planet, other species and our future.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2b$t$, 9, $t$s2b_09$t$, $t$The needs of people are more important than the needs of other species or the planet.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$2b$t$, 10, $t$s2b_10$t$, $t$Design can go beyond doing less harm, towards helping people and the living world thrive.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3a$t$, 1, $t$s3a_01$t$, $t$I can't remember the last time a company or the government kept a promise.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3a$t$, 2, $t$s3a_02$t$, $t$Companies tell you what you want to hear, then do what they want anyway.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3a$t$, 3, $t$s3a_03$t$, $t$Sustainability claims often feel like marketing, so I don't trust them.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3a$t$, 4, $t$s3a_04$t$, $t$People can say whatever they want; there are no consequences for lying any more.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3a$t$, 5, $t$s3a_05$t$, $t$I'd rather be sceptical than risk being fooled and looking naive.$t$, $t$scale$t$, null::jsonb, null::smallint, true, false),
    (1, $t$3a$t$, 6, $t$s3a_06$t$, $t$Not trusting anything makes life easier.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3a$t$, 7, $t$s3a_07$t$, $t$Distrusting almost everything can be exhausting.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3a$t$, 8, $t$s3a_08$t$, $t$I'd love to be able to trust more, but I'm not sure it's worth the effort or risk.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3b$t$, 1, $t$s3b_01$t$, $t$It takes a lot for me to trust someone.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3b$t$, 2, $t$s3b_02$t$, $t$Trust is earned; it can't be assumed.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3b$t$, 3, $t$s3b_03$t$, $t$The real question isn't whether I trust someone, but whether they deserve it.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3b$t$, 4, $t$s3b_04$t$, $t$I notice the small things people do that make me trust them more.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3b$t$, 5, $t$s3b_05$t$, $t$I'd like to know people who see the world very differently from me.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3b$t$, 6, $t$s3b_06$t$, $t$If I got something wrong or my idea failed, I think my peers and tutors would support me.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3b$t$, 7, $t$s3b_07$t$, $t$I have seen someone's failure or mistake respected and praised rather than criticised.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3b$t$, 8, $t$s3b_08$t$, $t$When someone makes a mistake, I tend to notice the effort they made rather than the mistake.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3b$t$, 9, $t$s3b_09$t$, $t$It is everyone's responsibility to model the behaviour they want to see.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3b$t$, 10, $t$s3b_10$t$, $t$I want to be part of a society that rewards failures and mistakes made in good faith.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$3b$t$, 11, $t$s3b_11$t$, $t$Designers have to earn the trust of the people they design for.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 1, $t$s4_01$t$, $t$My dream is to do amazing work that has meaningful impact on the world.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 2, $t$s4_02$t$, $t$When I graduate, I will change the world.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 3, $t$s4_03$t$, $t$I'd like to change the world, but I can't see how.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 4, $t$s4_04$t$, $t$I know it's naive to think I can make a change, but I am going to try.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 5, $t$s4_05$t$, $t$I want to make work that I'll want to talk about to strangers!$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 6, $t$s4_06$t$, $t$It's naive, even old-fashioned, to think you can make a change through your work.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 7, $t$s4_07$t$, $t$I don't feel I have permission to do the work I believe in.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 8, $t$s4_08$t$, $t$I don't care what others think; I'll do the work I believe in.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 9, $t$s4_09$t$, $t$I'd love to fight for what I believe in, but I'm scared of being mocked as naive or childish.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 10, $t$s4_10$t$, $t$I am happy to fight for what I believe in.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 11, $t$s4_11$t$, $t$The climate crisis is happening and there is nothing I can do about it.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 12, $t$s4_12$t$, $t$I know there is a climate crisis, but that is the responsibility of the government and corporations, not me. I want to make nice stuff.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 13, $t$s4_13$t$, $t$Small actions by ordinary people can add up to real change.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 14, $t$s4_14$t$, $t$I'd love to feel part of a community or movement that makes actual change.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (1, $t$4$t$, 15, $t$s4_15$t$, $t$Which of these have you ever done? (pick all that apply)$t$, $t$choice_multi$t$, $t$[{"value":1,"label":"Signed a petition"},{"value":2,"label":"Joined a protest or march"},{"value":3,"label":"Volunteered for a cause"},{"value":4,"label":"Been part of a community project"},{"value":5,"label":"Changed something at school, college or work"},{"value":6,"label":"None of these","exclusive":true}]$t$::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 1, $t$s5_01$t$, $t$I don't know if I can bring my true values and beliefs to my work.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 2, $t$s5_02$t$, $t$When I graduate, I want to work somewhere that helps people and other species.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 3, $t$s5_03$t$, $t$It's important to me that I enjoy my job.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 4, $t$s5_04$t$, $t$Getting a job matters more than enjoying it.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 5, $t$s5_05$t$, $t$Employers call the shots; they want designers to do what they're told, not to challenge them.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 6, $t$s5_06$t$, $t$Employers care about what our generation thinks and need our perspectives to stay relevant.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 7, $t$s5_07$t$, $t$It's fine to talk about making a change, but being a troublemaker makes it difficult to get a job.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 8, $t$s5_08$t$, $t$I secretly love the idea that I will be important and celebrated for my work.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 9, $t$s5_09$t$, $t$My generation has as much to teach previous generations as it has to learn from them.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 10, $t$s5_10$t$, $t$I am angry about the greed of previous generations and how it will affect my life.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 11, $t$s5_11$t$, $t$Previous generations have caused the climate crisis. Why should I have to fix it?$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 12, $t$s5_12$t$, $t$There are so many different types of design, but I already know what I want to do, so I can focus on that.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 13, $t$s5_13$t$, $t$I am curious to discover all kinds of ways of designing and working.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 14, $t$s5_14$t$, $t$If you had to choose one, which matters most to you?$t$, $t$choice_one$t$, $t$[{"value":1,"label":"Money"},{"value":2,"label":"Fame"},{"value":3,"label":"Impact"},{"value":4,"label":"Creative freedom"},{"value":5,"label":"Security"}]$t$::jsonb, null::smallint, false, false),
    (2, $t$5$t$, 15, $t$s5_15$t$, $t$Where has your idea of what a designer is mostly come from?$t$, $t$choice_one$t$, $t$[{"value":1,"label":"Social media"},{"value":2,"label":"Famous designers"},{"value":3,"label":"Brands and products"},{"value":4,"label":"School or college"},{"value":5,"label":"Family or friends"},{"value":6,"label":"Films and TV"}]$t$::jsonb, null::smallint, false, false),
    (2, $t$6a$t$, 1, $t$s6a_01$t$, $t$Getting a good grade makes me feel safe.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6a$t$, 2, $t$s6a_02$t$, $t$A good grade will make my parents happy and I'll get a good job.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6a$t$, 3, $t$s6a_03$t$, $t$A disappointing grade can make me feel I'm not good enough.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6a$t$, 4, $t$s6a_04$t$, $t$I like to know what's expected of me and my work.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6a$t$, 5, $t$s6a_05$t$, $t$I know failure is where we learn, but I find it really hard to be brave and take risks in my work.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6a$t$, 6, $t$s6a_06$t$, $t$Taking risks could cost me a good grade or a job, so why would I do it?$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6a$t$, 7, $t$s6a_07$t$, $t$University is where I get to experiment, play and take risks, so I can become a great designer.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6a$t$, 8, $t$s6a_08$t$, $t$I wish failure and trying new ideas were rewarded with good grades and a job!$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6a$t$, 9, $t$s6a_09$t$, $t$I don't believe that taking risks and being brave will result in good work.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6a$t$, 10, $t$s6a_10$t$, $t$I admire risk takers, but they don't have to worry about getting a job.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6b$t$, 1, $t$s6b_01$t$, $t$When other students do great work, it makes me more ambitious.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6b$t$, 2, $t$s6b_02$t$, $t$When other students do great work, it makes me feel I'm not good enough.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6b$t$, 3, $t$s6b_03$t$, $t$Some of the work I'm most proud of began with not knowing whether it would work.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6b$t$, 4, $t$s6b_04$t$, $t$I sometimes wonder whether I'd work as hard if nobody was going to assess the work.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6b$t$, 5, $t$s6b_05$t$, $t$I want to follow my gut and do work I believe in, but I don't always manage to.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6b$t$, 6, $t$s6b_06$t$, $t$I want to have fun with the work I do and express myself.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$6b$t$, 7, $t$s6b_07$t$, $t$I want to look back and be proud of the work I've done.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7a$t$, 1, $t$s7a_01$t$, $t$I need to know why I'm doing something before I will put effort into it.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7a$t$, 2, $t$s7a_02$t$, $t$I hate spending time on ideas that don't end up in my final work.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7a$t$, 3, $t$s7a_03$t$, $t$When I'm stuck, I want to find an answer as quickly as possible.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7a$t$, 4, $t$s7a_04$t$, $t$When work gets difficult, I often reach for my phone and lose my train of thought.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7a$t$, 5, $t$s7a_05$t$, $t$I want to pin down what I'm making quickly, because not knowing makes me feel anxious.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7a$t$, 6, $t$s7a_06$t$, $t$Working with uncertainty is challenging, but interesting ideas often emerge.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7a$t$, 7, $t$s7a_07$t$, $t$I usually discover the value of something only after I've done it.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7b$t$, 1, $t$s7b_01$t$, $t$I love it when my work feels easy.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7b$t$, 2, $t$s7b_02$t$, $t$I want a brief to be hard, but not so hard that I feel out of my depth or stupid.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7b$t$, 3, $t$s7b_03$t$, $t$Good design is hard, so when a process feels easy, I worry I'm missing something.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7b$t$, 4, $t$s7b_04$t$, $t$I'm happiest when my work is challenging and feels meaningful.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7b$t$, 5, $t$s7b_05$t$, $t$As I work, I'm more focused on the outcome and the praise I'll get than on the journey.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7b$t$, 6, $t$s7b_06$t$, $t$When I finish a project, I tend to feel a little sad or empty because the journey is over.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7b$t$, 7, $t$s7b_07$t$, $t$Being seen to work hard is a bit cringe, so I play down how hard the work is.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (2, $t$7b$t$, 8, $t$s7b_08$t$, $t$I will be successful because I work hard, and no one can do that for me.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$8$t$, 1, $t$s8_01$t$, $t$I like design because I get to be creative and practical.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$8$t$, 2, $t$s8_02$t$, $t$Using my hands is as important as using my brain.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$8$t$, 3, $t$s8_03$t$, $t$I do most of my work on my computer.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$8$t$, 4, $t$s8_04$t$, $t$Making by hand is slow and old-fashioned; computers are faster and better.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$8$t$, 5, $t$s8_05$t$, $t$Making things with my hands helps me feel calm and takes my mind off my worries.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$8$t$, 6, $t$s8_06$t$, $t$Working with my hands helps my mind wander and come up with ideas.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$8$t$, 7, $t$s8_07$t$, $t$I find that ideas lead to new ideas, and I love what opens up as I work.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$8$t$, 8, $t$s8_08$t$, $t$When I start making something unfamiliar, my nerves tell me I'm not good at it.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$8$t$, 9, $t$s8_09$t$, $t$I know when I do something new that it's going to be difficult, and that's OK.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$8$t$, 10, $t$s8_10$t$, $t$When something is rough and quick, I feel less pressure and more open to it failing or to discovering an idea.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$8$t$, 11, $t$s8_11$t$, $t$I value things more when I've made them myself.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$8$t$, 12, $t$s8_12$t$, $t$Design must look good.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$8$t$, 13, $t$s8_13$t$, $t$I love how AI and computers help me make my ideas look good.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$9$t$, 1, $t$s9_01$t$, $t$AI does the hard work so I don't have to.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$9$t$, 2, $t$s9_02$t$, $t$AI lets me create things I couldn't achieve on my own.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$9$t$, 3, $t$s9_03$t$, $t$I look forward to "vibe designing": I describe something and it exists!$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$9$t$, 4, $t$s9_04$t$, $t$AI helps me discover things I didn't know.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$9$t$, 5, $t$s9_05$t$, $t$When AI gives me a good enough answer, I stop thinking it through for myself.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$9$t$, 6, $t$s9_06$t$, $t$AI is helpful but it can't do the important thinking and discovering ideas; that's where people still matter.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$9$t$, 7, $t$s9_07$t$, $t$I wonder what I might fail to learn if AI always helps me when I'm stuck.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$9$t$, 8, $t$s9_08$t$, $t$If AI is so good, then what work will there be for me?$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$9$t$, 9, $t$s9_09$t$, $t$I find it easier to ask AI for help than to ask a person.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$9$t$, 10, $t$s9_10$t$, $t$I love speaking with people and seeing what ideas emerge through conversation.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$9$t$, 11, $t$s9_11$t$, $t$It's hard to explore ideas with people.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$10$t$, 1, $t$s10_01$t$, $t$I tend to avoid asking questions because I don't want to look stupid in front of everyone.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$10$t$, 2, $t$s10_02$t$, $t$Other people ask better questions than me.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$10$t$, 3, $t$s10_03$t$, $t$I love it when someone else asks the question that was on my mind.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$10$t$, 4, $t$s10_04$t$, $t$I love it when a question reveals thoughts and ideas I hadn't imagined.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$10$t$, 5, $t$s10_05$t$, $t$I'd love to have the confidence to ask more questions.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$10$t$, 6, $t$s10_06$t$, $t$Asking for help can feel like admitting I'm not good enough.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$10$t$, 7, $t$s10_07$t$, $t$I don't like sharing ideas unless I know they are good.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$10$t$, 8, $t$s10_08$t$, $t$I like to get reassurance when I share my work.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$10$t$, 9, $t$s10_09$t$, $t$I want people to see the good in me.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$10$t$, 10, $t$s10_10$t$, $t$In a crit, I find that I want to defend my ideas rather than look for what's missing in my work.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$10$t$, 11, $t$s10_11$t$, $t$Feedback on unfinished work helps me more than praise for finished work.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$10$t$, 12, $t$s10_12$t$, $t$I want to feel that my opinion is heard and respected.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11a$t$, 1, $t$s11a_01$t$, $t$A designer can't change the world alone.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11a$t$, 2, $t$s11a_02$t$, $t$The best ideas usually come from one brilliant person.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11a$t$, 3, $t$s11a_03$t$, $t$A great team is more than a group of talented individuals.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11a$t$, 4, $t$s11a_04$t$, $t$AI is great, I can get more stuff done and don't need to rely on other people.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11a$t$, 5, $t$s11a_05$t$, $t$Working with AI is great but it also means that I connect with people less.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11a$t$, 6, $t$s11a_06$t$, $t$Working with other people is scary and exciting.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11a$t$, 7, $t$s11a_07$t$, $t$Working with other people makes design slower, messier and more difficult.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11a$t$, 8, $t$s11a_08$t$, $t$Working with people who know things I don't can lead to work none of us could have made alone.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11a$t$, 9, $t$s11a_09$t$, $t$I am excited about learning from others.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11a$t$, 10, $t$s11a_10$t$, $t$I'd feel confident working with people from very different fields, like scientists, growers or local councils.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11a$t$, 11, $t$s11a_11$t$, $t$I'd find it hard to work with someone whose values are very different from mine.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11a$t$, 12, $t$s11a_12$t$, $t$Disagreement and conflict are a healthy part of designing together, as long as we repair things afterwards.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11a$t$, 13, $t$s11a_13$t$, $t$Everyone designs, not just people trained as designers.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11b$t$, 1, $t$s11b_01$t$, $t$Great design listens to and involves the people affected by a problem.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11b$t$, 2, $t$s11b_02$t$, $t$The people closest to a problem often know the most about how to solve it.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11b$t$, 3, $t$s11b_03$t$, $t$I'd be comfortable letting a community lead a project I'm part of.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11b$t$, 4, $t$s11b_04$t$, $t$I know how to find people who care about the same things I do.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11b$t$, 5, $t$s11b_05$t$, $t$I already feel part of a community on this course.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11b$t$, 6, $t$s11b_06$t$, $t$A designer has the power to impact those around them, through stories, ideas and working with others.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11b$t$, 7, $t$s11b_07$t$, $t$Together, people like us could change something that matters.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11b$t$, 8, $t$s11b_08$t$, $t$I feel more hopeful when I act with others than when I act alone.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11b$t$, 9, $t$s11b_09$t$, $t$I do my best work when I'm part of a community.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11b$t$, 10, $t$s11b_10$t$, $t$Relationships matter to me, and I want to learn how to build good ones.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11b$t$, 11, $t$s11b_11$t$, $t$Design can connect people and help build trust between people who don't yet trust each other.$t$, $t$scale$t$, null::jsonb, null::smallint, false, false),
    (3, $t$11b$t$, 12, $t$s11b_12$t$, $t$Which role could you see yourself playing in a team?$t$, $t$choice_one$t$, $t$[{"value":1,"label":"System thinker"},{"value":2,"label":"Leader and storyteller"},{"value":3,"label":"Designer and maker"},{"value":4,"label":"Connector and convenor"}]$t$::jsonb, null::smallint, false, false)
) as v(round_number, section_label, sort_order, key, text, kind, options, choice_count, is_key, optional)
join public.rounds r on r.round_number = v.round_number
join public.surveys s on s.id = r.survey_id and s.title = $t$Becoming a Designer Questionnaire$t$
join public.sections sec on sec.round_id = r.id and sec.label = v.section_label
on conflict (round_id, key) do nothing;

-- Predictions second, so their target already exists.
insert into public.statements (round_id, section_id, sort_order, key, text, kind, prediction_of, optional)
select r.id, sec.id, v.sort_order, v.key, v.text, 'prediction', target.id, true
from (
  values
    (1, $t$3a$t$, 9, $t$s3a_09$t$, $t$How many people in this room do you think agreed with the last statement?$t$, $t$s3a_08$t$)
) as v(round_number, section_label, sort_order, key, text, prediction_of_key)
join public.rounds r on r.round_number = v.round_number
join public.surveys s on s.id = r.survey_id and s.title = $t$Becoming a Designer Questionnaire$t$
join public.sections sec on sec.round_id = r.id and sec.label = v.section_label
join public.statements target on target.round_id = r.id and target.key = v.prediction_of_key
on conflict (round_id, key) do nothing;

alter table public.sections enable trigger sections_before_write;
alter table public.statements enable trigger statements_before_write;

-- Sanity: refuse to commit unless the content matches SURVEY-CONTENT-v2.md.
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

  if v_check is distinct from '1:6/67 2:5/47 3:5/61' then
    raise exception 'surveys_v2 content check failed: got %', v_check;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. admin_create_round (from 20261015000600): the next SESSION of the most
--    recent round's survey, copied from that round. Carries every v2
--    column and remaps prediction_of by key. Refuses once the survey has
--    its 3 sessions (rounds_session_number_range).
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_round(p_title text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_round_id uuid;
  v_survey_id uuid;
  v_next_number int;
  v_next_session int;
  v_new_round_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can create rounds' using errcode = '42501', hint = 'not_admin';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.admin_create_round'));

  select id, survey_id into v_source_round_id, v_survey_id
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

  insert into public.rounds (round_number, title, survey_id, session_number)
  values (
    v_next_number,
    coalesce(nullif(btrim(p_title), ''), 'Session ' || v_next_session),
    v_survey_id,
    v_next_session
  )
  returning id into v_new_round_id;

  if v_source_round_id is not null then
    insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt)
    select v_new_round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt
    from public.sections
    where round_id = v_source_round_id;

    insert into public.statements (round_id, section_id, sort_order, key, text, kind, options, choice_count, is_key, optional)
    select v_new_round_id, ns.id, st.sort_order, st.key, st.text, st.kind, st.options, st.choice_count, st.is_key, st.optional
    from public.statements st
    join public.sections os on os.id = st.section_id and os.round_id = v_source_round_id
    join public.sections ns on ns.round_id = v_new_round_id and ns.sort_order = os.sort_order
    where st.kind <> 'prediction';

    insert into public.statements (round_id, section_id, sort_order, key, text, kind, prediction_of, is_key, optional)
    select v_new_round_id, ns.id, st.sort_order, st.key, st.text, st.kind, nt.id, st.is_key, st.optional
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

-- ---------------------------------------------------------------------------
-- 9. admin_list_rounds (from 20261015000500) + survey_id, survey_title,
--    session_number. Return type changes, so drop and recreate.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_list_rounds(uuid);

create function public.admin_list_rounds(p_round_id uuid default null)
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
  submitted_count bigint,
  survey_id uuid,
  survey_title text,
  session_number smallint
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
      coalesce(counts.submitted_count, 0) as submitted_count,
      rounds.survey_id as survey_id,
      surveys.title as survey_title,
      rounds.session_number as session_number
    from public.rounds
    join public.surveys on surveys.id = rounds.survey_id
    left join public.admin_round_response_counts() as counts on counts.round_id = rounds.id
    where p_round_id is null or rounds.id = p_round_id
    order by rounds.round_number desc;
end;
$$;

revoke execute on function public.admin_list_rounds(uuid) from public, anon;
grant execute on function public.admin_list_rounds(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. admin_round_responses (from 20261015000800) + choice_values. Still
--     the ONLY identity-bearing read. Return type changes: drop/recreate.
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
  choice_values smallint[]
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
      answers.choice_values as choice_values
    from public.responses
    join auth.users as users on users.id = responses.user_id
    left join public.answers on answers.response_id = responses.id
    left join public.statements on statements.id = answers.statement_id
    where responses.round_id = p_round_id
    order by users.email, statements.key nulls first;
end;
$$;

revoke execute on function public.admin_round_responses(uuid) from public, anon;
grant execute on function public.admin_round_responses(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. Identity-free admin aggregates (submitted responses only).
-- ---------------------------------------------------------------------------

-- Scale questions only (choice/prediction values live on other scales).
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
      and statements.kind = 'scale'
      and answers.value is not null
    group by statements.id, statements.key, answers.value
    order by statements.key, answers.value;
end;
$$;

-- One row per (choice question, option) — zero-count options included, in
-- option order. answer_count = submitted answers that picked the option
-- (choice_one: value; choice_multi/exact: unnest(choice_values));
-- respondent_count = submitted answers to that question (the denominator
-- for "% of people who picked this").
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
      and st.kind in ('choice_one', 'choice_multi', 'choice_exact')
    order by st.key, o.ord;
end;
$$;

-- One row per prediction question: how many guessed, the average guess
-- (0..100), and the actual result for the referenced agreement statement
-- (respondents and how many chose the top two options: Agree + Strongly
-- agree), as counts and a percentage. Every number is submitted-only.
create or replace function public.admin_prediction_stats(p_round_id uuid)
returns table (
  statement_id uuid,
  statement_key text,
  prediction_of uuid,
  prediction_of_key text,
  guess_count bigint,
  average_guess numeric,
  actual_respondent_count bigint,
  actual_agree_count bigint,
  actual_agree_percent numeric
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
      select a.statement_id, a.value
      from public.answers a
      join public.responses r on r.id = a.response_id
      where a.round_id = p_round_id
        and r.submitted_at is not null
        and a.value is not null
    )
    select
      st.id as statement_id,
      st.key as statement_key,
      target.id as prediction_of,
      target.key as prediction_of_key,
      g.guess_count,
      g.average_guess,
      act.respondents as actual_respondent_count,
      act.agreed as actual_agree_count,
      case when act.respondents > 0
        then round(100.0 * act.agreed / act.respondents, 1)
        else null
      end as actual_agree_percent
    from public.statements st
    join public.statements target on target.id = st.prediction_of
    join public.sections tsec on tsec.id = target.section_id
    cross join lateral (
      select count(*) as guess_count, round(avg(s.value), 1) as average_guess
      from submitted s
      where s.statement_id = st.id
    ) as g
    cross join lateral (
      select
        count(*) as respondents,
        count(*) filter (
          where s.value >= (select max(so.value) - 1 from public.scale_options so where so.scale_key = tsec.scale_key)
        ) as agreed
      from submitted s
      where s.statement_id = target.id
    ) as act
    where st.round_id = p_round_id
      and st.kind = 'prediction'
    order by st.key;
end;
$$;

revoke execute on function public.admin_statement_answer_counts(uuid) from public, anon;
grant execute on function public.admin_statement_answer_counts(uuid) to authenticated, service_role;
revoke execute on function public.admin_statement_choice_counts(uuid) from public, anon;
grant execute on function public.admin_statement_choice_counts(uuid) to authenticated, service_role;
revoke execute on function public.admin_prediction_stats(uuid) from public, anon;
grant execute on function public.admin_prediction_stats(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. Comments
-- ---------------------------------------------------------------------------

comment on table public.surveys is 'Surveys v2: a survey is made of up to 3 rounds (sessions).';
comment on column public.rounds.session_number is 'Session 1..3 within the round''s survey; round title is the session title.';
comment on column public.sections.label is 'Display numbering, e.g. 1, 2a, 11b.';
comment on column public.sections.parent_title is 'Parent section title for subsections (e.g. "What is design?" for 2a/2b).';
comment on column public.sections.discussion_prompt is 'Presentation-only discussion slide after this section. Never selected by participant-facing code.';
comment on column public.statements.kind is 'scale | choice_one | choice_multi | choice_exact | prediction.';
comment on column public.statements.options is 'Choice kinds only: [{value:int,label:text,exclusive?:bool}].';
comment on column public.statements.choice_count is 'choice_exact only: how many options must be picked.';
comment on column public.statements.is_key is 'Presentation-only "Key question" tag. Never selected by participant-facing code.';
comment on column public.statements.prediction_of is 'prediction only: the agreement statement (same round) whose % agree is being guessed.';
comment on column public.statements.optional is 'Optional questions (predictions) don''t count towards submit completeness.';
comment on column public.answers.choice_values is 'choice_multi / choice_exact picks, sorted ascending. value is used for every other kind (prediction = 0..100).';
comment on function public.statement_options_valid(jsonb) is 'Shape check for statements.options.';
comment on function public.answers_before_write() is 'Per-kind answer validation; no writes once the response is submitted.';
comment on function public.responses_before_write() is 'SURV-06/07: submit requires every NON-optional statement answered; submit is immutable.';
comment on function public.statements_before_write() is 'RND-03/RND-04: content lock, no moves, immutable keys; predictions must target an agreement statement in the same round.';
comment on function public.admin_create_round(text) is 'Creates the next session (max 3) of the latest round''s survey as a key-preserving copy, carrying every v2 column and remapping prediction_of.';
comment on function public.admin_list_rounds(uuid) is 'ADM-01: admin-only dashboard rows — status, dates, counts, survey and session number.';
comment on function public.admin_round_responses(uuid) is 'ADM-02/ADM-03: the only identity-bearing read in this app — admin-only, joins responses to auth.users for email. Call sites must stay limited to src/lib/admin/responses-queries.ts and the CSV export route.';
comment on function public.admin_statement_answer_counts(uuid) is 'PRIV-03: admin-only, identity-free per-option counts for SCALE statements, submitted responses only.';
comment on function public.admin_statement_choice_counts(uuid) is 'PRIV-03: admin-only, identity-free per-option counts for choice statements (zero rows included), submitted responses only.';
comment on function public.admin_prediction_stats(uuid) is 'PRIV-03: admin-only, identity-free prediction stats (guess count, average guess, actual % agree), submitted responses only.';
