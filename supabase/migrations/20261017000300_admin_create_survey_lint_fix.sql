-- Forward fix for a plpgsql_check warning on admin_create_survey
-- (20261017000200): `v_session_number` was declared in the DECLARE block
-- AND used as a `for v_session_number in 1..3 loop` bound variable, which
-- auto-declares its own loop variable that shadows the declared one
-- ("unused variable", "shadows a previously defined variable"). No
-- behaviour change -- just drops the redundant declaration.

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
    select r.id, r.title into v_source_round_id, v_source_title
    from public.rounds r
    where r.survey_id = v_latest_survey_id and r.session_number = v_session_number;

    insert into public.rounds (round_number, title, survey_id, session_number)
    values (
      v_next_round_number,
      coalesce(v_source_title, 'Session ' || v_session_number),
      v_new_survey_id,
      v_session_number
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
  end loop;

  return v_new_survey_id;
end;
$$;

revoke execute on function public.admin_create_survey(text) from public, anon;
grant execute on function public.admin_create_survey(text) to authenticated, service_role;
