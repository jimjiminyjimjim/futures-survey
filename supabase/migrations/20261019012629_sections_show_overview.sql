-- Quick task 261019-2w3 (add C/E presentation overview slides, closing
-- out live feedback: "In the presentation - can we have an overview at
-- the end as well please?" for C, and "An overview for E in the
-- presentation would be lovely."): adds a presentation-only
-- sections.show_overview flag, sets it on Session 1's Question C and
-- Question E only, and has both content-copy functions carry it
-- forward. Purely additive: no existing migration is edited, no section
-- or statement is added, removed or renumbered.
--
-- Forward-only: no BEGIN/COMMIT (the Supabase CLI/MCP wraps each
-- migration file in its own transaction), and $t$...$t$ dollar quoting
-- for every text literal, matching 20261018000100 and 20261019005106.
--
-- Once this migration has been applied to the hosted project, NEVER edit
-- it again -- fixes are forward migrations.

-- ---------------------------------------------------------------------------
-- 1. sections.show_overview: presentation-only flag, the reverse case of
--    the participant-only sections.grouped flag added in 20261019005106.
-- ---------------------------------------------------------------------------

alter table public.sections add column if not exists show_overview boolean not null default false;

comment on column public.sections.show_overview is $t$Presentation only: when true, presentation mode adds a closing overview slide after the section's rating statements, ranking them by average rating. The participant UI ignores it.$t$;

-- ---------------------------------------------------------------------------
-- 2. admin_create_survey / admin_create_round: carry sections.show_overview
--    forward when copying content. Bodies copied verbatim from
--    20261019005106 lines 89-278, with `show_overview` appended after
--    `grouped` in each function's sections insert/select column list (2
--    appends per function, 4 in total). Nothing else changed: is_admin()
--    guards, search_path '', the advisory locks, the statements copies and
--    revoke/grant all stay as they are.
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
      insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt, grouped, show_overview)
      select v_new_round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt, grouped, show_overview
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
    insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt, grouped, show_overview)
    select v_new_round_id, sort_order, label, parent_title, title, prompt, scale_key, discussion_prompt, grouped, show_overview
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
-- 3. Disable the content-lock guard triggers for this transaction only.
--    Session 1 has opened, and they refuse writes to an opened round for
--    every role. No non-demo-answer guard is needed here: nothing is
--    deleted or renumbered, only the new boolean column is set on two
--    existing sections.
-- ---------------------------------------------------------------------------

alter table public.sections disable trigger sections_before_write;
alter table public.statements disable trigger statements_before_write;

-- ---------------------------------------------------------------------------
-- 4. Set show_overview on Session 1's Question C and Question E only.
--    Labels and titles confirmed from 20261018000100; no later migration
--    changes them.
-- ---------------------------------------------------------------------------

update public.sections sec
set show_overview = true
from public.rounds r, public.surveys s
where sec.round_id = r.id
  and r.survey_id = s.id
  and s.title = $t$Becoming a Designer Questionnaire$t$
  and r.session_number = 1
  and sec.label = $t$C$t$;

update public.sections sec
set show_overview = true
from public.rounds r, public.surveys s
where sec.round_id = r.id
  and r.survey_id = s.id
  and s.title = $t$Becoming a Designer Questionnaire$t$
  and r.session_number = 1
  and sec.label = $t$E$t$;

-- ---------------------------------------------------------------------------
-- 5. Re-enable the content-lock guard triggers.
-- ---------------------------------------------------------------------------

alter table public.sections enable trigger sections_before_write;
alter table public.statements enable trigger statements_before_write;

-- ---------------------------------------------------------------------------
-- 6. Sanity: refuse to commit unless the flag landed exactly on C and E,
--    nowhere else, and the round's section/statement shape is unchanged.
--    Each check rolls back the whole file on mismatch.
-- ---------------------------------------------------------------------------

do $$
declare
  v_flagged text;
  v_flagged_total int;
  v_flagged_statement_count int;
  v_flagged_non_rating int;
  v_shape_check text;
begin
  select string_agg(
    r.session_number || ':' || sec.label || ':' || sec.title,
    ',' order by r.session_number, sec.sort_order
  )
  into v_flagged
  from public.sections sec
  join public.rounds r on r.id = sec.round_id
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$
    and sec.show_overview = true;

  if v_flagged is distinct from $t$1:C:When trust is broken,1:E:How scepticism affects me$t$ then
    raise exception 'sections_show_overview content check failed: flagged sections got %', v_flagged;
  end if;

  select count(*) into v_flagged_total
  from public.sections
  where show_overview = true;

  if v_flagged_total <> 2 then
    raise exception 'sections_show_overview content check failed: whole-table flagged count got %', v_flagged_total;
  end if;

  select count(*), count(*) filter (where st.kind <> 'rating')
  into v_flagged_statement_count, v_flagged_non_rating
  from public.statements st
  join public.sections sec on sec.id = st.section_id and sec.round_id = st.round_id
  join public.rounds r on r.id = st.round_id
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$
    and sec.show_overview = true;

  if v_flagged_statement_count <> 12 or v_flagged_non_rating <> 0 then
    raise exception 'sections_show_overview content check failed: flagged statement count/kind got %/%', v_flagged_statement_count, v_flagged_non_rating;
  end if;

  select string_agg(
    format('%s:%s/%s', r.session_number, (select count(*) from public.sections x where x.round_id = r.id),
      (select count(*) from public.statements x where x.round_id = r.id)),
    ' ' order by r.session_number
  )
  into v_shape_check
  from public.rounds r
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$;

  if v_shape_check is distinct from $t$1:6/32 2:5/47 3:5/61$t$ then
    raise exception 'sections_show_overview content check failed: section/statement counts got %', v_shape_check;
  end if;
end;
$$;
