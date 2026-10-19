-- Quick task 261019-1ey (second round of Session 1 feedback): trims
-- Question A from 13 terms to 8 terms (with a non-demo-answer guard) and
-- renumbers the kept terms 1-8 (FB-1a); updates the four familiarity scale
-- option labels (FB-1b); updates sb_2a's statement text only (FB-1c);
-- updates Question C's section prompt (FB-1d); adds a sections.grouped
-- flag, sets it only on Session 1's Question C, and has both content-copy
-- functions carry it forward (FB-1e); updates Question F's section prompt
-- and sf_01/sf_03/sf_04/sf_05's statement text (FB-1f). Sessions 2 and 3
-- are untouched.
--
-- Forward-only: no BEGIN/COMMIT (the Supabase CLI/MCP wraps each migration
-- file in its own transaction), and $t$...$t$ dollar quoting for every text
-- literal, matching 20261018000100.
--
-- Once this migration has been applied to the hosted project, NEVER edit it
-- again -- fixes are forward migrations.

-- ---------------------------------------------------------------------------
-- 1. Section A guard (FB-1a): refuse if Question A doesn't have exactly 13
--    terms today, or if any non-demo answer exists on the 5 terms being
--    removed. Only demo answers are deleted here; responses are kept.
-- ---------------------------------------------------------------------------

do $$
declare
  v_round_id uuid;
  v_section_a_count int;
  v_bad_count int;
begin
  select r.id into v_round_id
  from public.rounds r
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$
    and r.session_number = 1;

  if v_round_id is null then
    raise exception 'session_1_feedback_round_2: Session 1 round not found';
  end if;

  select count(*) into v_section_a_count
  from public.statements st
  join public.sections sec on sec.id = st.section_id and sec.round_id = st.round_id
  where st.round_id = v_round_id
    and sec.label = $t$A$t$;

  if v_section_a_count <> 13 then
    raise exception 'session_1_feedback_round_2: expected 13 Question A terms, found %', v_section_a_count;
  end if;

  select count(*) into v_bad_count
  from public.answers a
  join public.statements st on st.id = a.statement_id
  join public.responses resp on resp.id = a.response_id
  join auth.users u on u.id = resp.user_id
  where st.round_id = v_round_id
    and st.key in ('sa_03', 'sa_06', 'sa_11', 'sa_12', 'sa_13')
    and u.email !~ '^demo\.[0-9]{2}@example\.com$';

  if v_bad_count > 0 then
    raise exception 'session_1_feedback_round_2: non-demo answers exist on Question A terms being removed — resolve manually before applying';
  end if;

  delete from public.answers a
  using public.statements st
  where a.statement_id = st.id
    and st.round_id = v_round_id
    and st.key in ('sa_03', 'sa_06', 'sa_11', 'sa_12', 'sa_13');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. sections.grouped (FB-1e): participant-UI-only flag. Presentation mode
--    ignores it; C still gets one rating slide per statement there.
-- ---------------------------------------------------------------------------

alter table public.sections add column if not exists grouped boolean not null default false;

comment on column public.sections.grouped is $t$Participant UI only: when true, every statement in the section is answered on one page and the section is a single stop for resume/progress. Presentation mode ignores it.$t$;

-- ---------------------------------------------------------------------------
-- 3. admin_create_survey / admin_create_round (FB-1e): carry sections.grouped
--    forward when copying content. Bodies copied verbatim from
--    20261018000100, with `grouped` appended to the sections insert/select
--    column lists (2 appends per function, 4 in total). Nothing else
--    changed: is_admin() guards, search_path '', advisory locks, the
--    statements copy, revoke/grant all stay as they are.
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
      insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt, grouped)
      select v_new_round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt, grouped
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
    insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt, grouped)
    select v_new_round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt, grouped
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
-- 4. Disable the content-lock guard triggers for this transaction only.
--    Session 1 has opened, and they refuse writes to an opened round for
--    every role.
-- ---------------------------------------------------------------------------

alter table public.sections disable trigger sections_before_write;
alter table public.statements disable trigger statements_before_write;

-- ---------------------------------------------------------------------------
-- 5. FB-1a: delete the 5 removed Question A terms. Their demo answers were
--    already deleted in step 1 (answers -> statements has no cascade).
-- ---------------------------------------------------------------------------

delete from public.statements st
using public.rounds r, public.surveys s
where st.round_id = r.id
  and r.survey_id = s.id
  and s.title = $t$Becoming a Designer Questionnaire$t$
  and r.session_number = 1
  and st.key in ('sa_03', 'sa_06', 'sa_11', 'sa_12', 'sa_13');

-- ---------------------------------------------------------------------------
-- 6. FB-1a: renumber the kept 8 Question A terms 1-8, in two updates so the
--    (section_id, sort_order) unique constraint is never checked mid-shuffle.
-- ---------------------------------------------------------------------------

-- 6a. Move the kept keys out of the way first.
update public.statements st
set sort_order = st.sort_order + 1000
from public.rounds r, public.surveys s
where st.round_id = r.id
  and r.survey_id = s.id
  and s.title = $t$Becoming a Designer Questionnaire$t$
  and r.session_number = 1
  and st.key in ('sa_01', 'sa_02', 'sa_04', 'sa_05', 'sa_07', 'sa_08', 'sa_09', 'sa_10');

-- 6b. Set the final 1-8 order.
update public.statements st
set sort_order = v.sort_order
from (
  values
    ($t$sa_01$t$, 1), ($t$sa_02$t$, 2), ($t$sa_04$t$, 3), ($t$sa_05$t$, 4),
    ($t$sa_07$t$, 5), ($t$sa_08$t$, 6), ($t$sa_09$t$, 7), ($t$sa_10$t$, 8)
) as v(key, sort_order),
public.rounds r, public.surveys s
where st.key = v.key
  and st.round_id = r.id
  and r.survey_id = s.id
  and s.title = $t$Becoming a Designer Questionnaire$t$
  and r.session_number = 1;

-- ---------------------------------------------------------------------------
-- 7. Section prompt updates, Session 1 only.
-- ---------------------------------------------------------------------------

-- C (FB-1d + FB-1e): new prompt, and this is the one grouped section.
update public.sections sec
set
  prompt = $t$When a promise you wanted to believe turns out to be false, gets watered down or dropped, how much do you tend to feel…$t$,
  grouped = true
from public.rounds r, public.surveys s
where sec.round_id = r.id
  and r.survey_id = s.id
  and s.title = $t$Becoming a Designer Questionnaire$t$
  and r.session_number = 1
  and sec.label = $t$C$t$;

-- F (FB-1f): new prompt.
update public.sections sec
set prompt = $t$If you could, how much would you like to be able to believe…$t$
from public.rounds r, public.surveys s
where sec.round_id = r.id
  and r.survey_id = s.id
  and s.title = $t$Becoming a Designer Questionnaire$t$
  and r.session_number = 1
  and sec.label = $t$F$t$;

-- ---------------------------------------------------------------------------
-- 8. Statement text updates, Session 1 only. sb_2a's label/context/question/
--    reveal_text are untouched -- only its text column changes.
-- ---------------------------------------------------------------------------

-- sb_2a (FB-1c): text only.
update public.statements st
set text = $t$“SHEIN continues to push more responsible and circular production practices, both within the organization and for the overall industry, to positively contribute to the resilience of nature and the empowerment of local communities.”$t$
from public.rounds r, public.surveys s
where st.round_id = r.id
  and r.survey_id = s.id
  and s.title = $t$Becoming a Designer Questionnaire$t$
  and r.session_number = 1
  and st.key = $t$sb_2a$t$;

-- sf_01 / sf_03 / sf_04 / sf_05 (FB-1f): "your/you" wording. sf_02, sf_06,
-- sf_07 are untouched.
update public.statements st
set text = v.text
from (
  values
    ($t$sf_01$t$, $t$…your own judgement about what’s real and what’s hype$t$),
    ($t$sf_03$t$, $t$…that your effort will be worth it$t$),
    ($t$sf_04$t$, $t$…that others care as much as you do$t$),
    ($t$sf_05$t$, $t$…that you won’t be alone in trying$t$)
) as v(key, text),
public.rounds r, public.surveys s
where st.key = v.key
  and st.round_id = r.id
  and r.survey_id = s.id
  and s.title = $t$Becoming a Designer Questionnaire$t$
  and r.session_number = 1;

-- ---------------------------------------------------------------------------
-- 9. Re-enable the content-lock guard triggers.
-- ---------------------------------------------------------------------------

alter table public.sections enable trigger sections_before_write;
alter table public.statements enable trigger statements_before_write;

-- ---------------------------------------------------------------------------
-- 10. FB-1b: familiarity scale option labels. scale_options is global per
--     scale_key, so every round using the familiarity scale gets the new
--     wording -- in this survey that is only Session 1 Question A.
-- ---------------------------------------------------------------------------

update public.scale_options
set label = $t$I have never heard of this before$t$
where scale_key = $t$familiarity$t$ and value = 1;

update public.scale_options
set label = $t$I’ve heard of it, but couldn’t explain it$t$
where scale_key = $t$familiarity$t$ and value = 2;

update public.scale_options
set label = $t$I could explain this in a simple way$t$
where scale_key = $t$familiarity$t$ and value = 3;

update public.scale_options
set label = $t$I understand this term and could discuss it$t$
where scale_key = $t$familiarity$t$ and value = 4;

-- ---------------------------------------------------------------------------
-- 11. Sanity: refuse to commit unless every content change landed exactly
--     as intended. Each check rolls back the whole file on mismatch.
-- ---------------------------------------------------------------------------

do $$
declare
  v_check text;
  v_a_order text;
  v_grouped text;
  v_c_count int;
  v_c_non_rating int;
  v_sb_2a_text text;
  v_c_prompt text;
  v_f_prompt text;
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

  if v_check is distinct from '1:6/32 2:5/47 3:5/61' then
    raise exception 'session_1_feedback_round_2 content check failed: section/statement counts got %', v_check;
  end if;

  select string_agg(st.key || '@' || st.sort_order, ',' order by st.sort_order)
  into v_a_order
  from public.statements st
  join public.sections sec on sec.id = st.section_id and sec.round_id = st.round_id
  join public.rounds r on r.id = st.round_id
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$
    and r.session_number = 1
    and sec.label = $t$A$t$;

  if v_a_order is distinct from 'sa_01@1,sa_02@2,sa_04@3,sa_05@4,sa_07@5,sa_08@6,sa_09@7,sa_10@8' then
    raise exception 'session_1_feedback_round_2 content check failed: Question A key/order got %', v_a_order;
  end if;

  select string_agg(r.session_number || ':' || sec.label, ',' order by r.session_number)
  into v_grouped
  from public.sections sec
  join public.rounds r on r.id = sec.round_id
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$
    and sec.grouped = true;

  if v_grouped is distinct from '1:C' then
    raise exception 'session_1_feedback_round_2 content check failed: grouped sections got %', v_grouped;
  end if;

  select count(*), count(*) filter (where st.kind <> 'rating')
  into v_c_count, v_c_non_rating
  from public.statements st
  join public.sections sec on sec.id = st.section_id and sec.round_id = st.round_id
  join public.rounds r on r.id = st.round_id
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$
    and r.session_number = 1
    and sec.label = $t$C$t$;

  if v_c_count <> 7 or v_c_non_rating <> 0 then
    raise exception 'session_1_feedback_round_2 content check failed: Question C statement count/kind got %/%', v_c_count, v_c_non_rating;
  end if;

  select st.text into v_sb_2a_text
  from public.statements st
  join public.rounds r on r.id = st.round_id
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$
    and r.session_number = 1
    and st.key = $t$sb_2a$t$;

  if v_sb_2a_text is distinct from $t$“SHEIN continues to push more responsible and circular production practices, both within the organization and for the overall industry, to positively contribute to the resilience of nature and the empowerment of local communities.”$t$ then
    raise exception 'session_1_feedback_round_2 content check failed: sb_2a text got %', v_sb_2a_text;
  end if;

  select sec.prompt into v_c_prompt
  from public.sections sec
  join public.rounds r on r.id = sec.round_id
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$
    and r.session_number = 1
    and sec.label = $t$C$t$;

  if v_c_prompt is distinct from $t$When a promise you wanted to believe turns out to be false, gets watered down or dropped, how much do you tend to feel…$t$ then
    raise exception 'session_1_feedback_round_2 content check failed: C prompt got %', v_c_prompt;
  end if;

  select sec.prompt into v_f_prompt
  from public.sections sec
  join public.rounds r on r.id = sec.round_id
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$
    and r.session_number = 1
    and sec.label = $t$F$t$;

  if v_f_prompt is distinct from $t$If you could, how much would you like to be able to believe…$t$ then
    raise exception 'session_1_feedback_round_2 content check failed: F prompt got %', v_f_prompt;
  end if;
end;
$$;
