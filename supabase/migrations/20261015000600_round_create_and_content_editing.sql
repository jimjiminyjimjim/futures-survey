-- Round creation (key-preserving copy of the most recent round) and
-- content editing (sections/statements) while a round has not yet opened
-- (RND-01, RND-03, RND-04). Also ships the section RPCs plan 03-03 puts a
-- UI on.
--
-- Additive only — never edits 20261015000100/200/300/400/500. No
-- BEGIN/COMMIT: the Supabase CLI wraps each migration file in its own
-- transaction already.
--
-- Once this migration has been applied to the hosted project, NEVER edit it
-- again — fixes are forward migrations (same convention as the five prior
-- migrations in this project).

-- ---------------------------------------------------------------------------
-- 1. public.round_content_editable_at / public.round_content_editable — the
--    ONE place "can this round's sections/statements still be edited" is
--    derived (RND-03). Content locks the instant opens_at <= p_at — a
--    merely scheduled round (future opens_at) stays editable, per RND-03's
--    literal wording.
-- ---------------------------------------------------------------------------

create or replace function public.round_content_editable_at(
  p_opens_at timestamptz,
  p_at timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_opens_at is null or (p_at is not null and p_opens_at > p_at);
$$;

revoke execute on function public.round_content_editable_at(timestamptz, timestamptz) from public, anon;
grant execute on function public.round_content_editable_at(timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.round_content_editable(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select public.round_content_editable_at(r.opens_at, now())
      from public.rounds r
      where r.id = p_round_id
    ),
    false
  );
$$;

revoke execute on function public.round_content_editable(uuid) from public, anon;
grant execute on function public.round_content_editable(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Write RLS on sections/statements, admin + content-editable only
--    (RND-03). Additional permissive policies alongside the existing
--    *_select_admins policies — these only add insert/update/delete.
-- ---------------------------------------------------------------------------

create policy sections_insert_admins_editable
  on public.sections
  for insert
  to authenticated
  with check (
    (select public.is_admin())
    and public.round_content_editable(round_id)
  );

create policy sections_update_admins_editable
  on public.sections
  for update
  to authenticated
  using (
    (select public.is_admin())
    and public.round_content_editable(round_id)
  )
  with check (
    (select public.is_admin())
    and public.round_content_editable(round_id)
  );

create policy sections_delete_admins_editable
  on public.sections
  for delete
  to authenticated
  using (
    (select public.is_admin())
    and public.round_content_editable(round_id)
  );

create policy statements_insert_admins_editable
  on public.statements
  for insert
  to authenticated
  with check (
    (select public.is_admin())
    and public.round_content_editable(round_id)
  );

create policy statements_update_admins_editable
  on public.statements
  for update
  to authenticated
  using (
    (select public.is_admin())
    and public.round_content_editable(round_id)
  )
  with check (
    (select public.is_admin())
    and public.round_content_editable(round_id)
  );

create policy statements_delete_admins_editable
  on public.statements
  for delete
  to authenticated
  using (
    (select public.is_admin())
    and public.round_content_editable(round_id)
  );

-- ---------------------------------------------------------------------------
-- 3. Guard triggers — refuse an opened round's content changes for EVERY
--    role (service role included), and forbid moving rows between
--    rounds/sections or changing a statement's key, ever (RND-03, RND-04,
--    T-03-08, T-03-09). No DELETE trigger: deletes are gated by RLS, and
--    ON DELETE CASCADE cleanup of whole rounds must keep working.
-- ---------------------------------------------------------------------------

create or replace function public.sections_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.round_id <> old.round_id then
      raise exception 'A section cannot be moved to a different round.'
        using errcode = '23514', hint = 'immutable';
    end if;
  end if;

  if not public.round_content_editable(new.round_id) then
    raise exception 'This round has opened — its sections and statements can no longer be edited.'
      using errcode = '23514', hint = 'round_locked';
  end if;

  return new;
end;
$$;

create trigger sections_before_write
  before insert or update on public.sections
  for each row execute function public.sections_before_write();

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

  return new;
end;
$$;

create trigger statements_before_write
  before insert or update on public.statements
  for each row execute function public.statements_before_write();

-- ---------------------------------------------------------------------------
-- 4. public.admin_create_round — key-preserving copy of the most recent
--    round into a new draft (RND-01, RND-04). Old-to-new section remap is
--    by sort_order, never by id (ids don't survive the copy). Advisory
--    locks serialise concurrent creates and protect the copy source.
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_round(p_title text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_round_id uuid;
  v_next_number int;
  v_new_round_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can create rounds' using errcode = '42501', hint = 'not_admin';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.admin_create_round'));

  select id into v_source_round_id
  from public.rounds
  order by round_number desc
  limit 1;

  if v_source_round_id is not null then
    perform pg_advisory_xact_lock(hashtext('public.round_content:' || v_source_round_id::text));
  end if;

  select coalesce(max(round_number), 0) + 1 into v_next_number from public.rounds;

  insert into public.rounds (round_number, title)
  values (
    v_next_number,
    coalesce(nullif(btrim(p_title), ''), 'Round ' || v_next_number)
  )
  returning id into v_new_round_id;

  if v_source_round_id is not null then
    insert into public.sections (round_id, sort_order, title, prompt, scale_key)
    select v_new_round_id, sort_order, title, prompt, scale_key
    from public.sections
    where round_id = v_source_round_id;

    insert into public.statements (round_id, section_id, sort_order, key, text)
    select v_new_round_id, ns.id, st.sort_order, st.key, st.text
    from public.statements st
    join public.sections os on os.id = st.section_id and os.round_id = v_source_round_id
    join public.sections ns on ns.round_id = v_new_round_id and ns.sort_order = os.sort_order;
  end if;

  return v_new_round_id;
end;
$$;

revoke execute on function public.admin_create_round(text) from public, anon;
grant execute on function public.admin_create_round(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Content RPCs — SECURITY INVOKER so RLS and the triggers above still
--    apply; each resolves its target (P0002: round_not_found /
--    section_not_found / statement_not_found), checks round_locked, takes
--    a per-round advisory lock, validates input, then writes.
-- ---------------------------------------------------------------------------

create or replace function public.admin_add_statement(p_section_id uuid, p_text text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_round_id uuid;
  v_round_number int;
  v_text text;
  v_sort_order smallint;
  v_pattern text;
  v_nn int;
  v_key text;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can edit round content' using errcode = '42501', hint = 'not_admin';
  end if;

  select s.round_id, r.round_number into v_round_id, v_round_number
  from public.sections s
  join public.rounds r on r.id = s.round_id
  where s.id = p_section_id;

  if v_round_id is null then
    raise exception 'Section not found' using errcode = 'P0002', hint = 'section_not_found';
  end if;

  if not public.round_content_editable(v_round_id) then
    raise exception 'This round has opened — its sections and statements can no longer be edited.'
      using errcode = '23514', hint = 'round_locked';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.round_content:' || v_round_id::text));

  v_text := btrim(p_text);
  if v_text = '' then
    raise exception 'Enter the statement text.' using errcode = '22023', hint = 'text_blank';
  end if;

  select coalesce(max(sort_order), 0) + 1 into v_sort_order
  from public.statements
  where section_id = p_section_id;

  v_pattern := '^r' || v_round_number::text || '_([0-9]+)$';
  select coalesce(max((regexp_match(key, v_pattern))[1]::int), 0) + 1 into v_nn
  from public.statements
  where key ~ v_pattern;

  v_key := 'r' || v_round_number::text || '_' || lpad(v_nn::text, greatest(2, length(v_nn::text)), '0');

  insert into public.statements (round_id, section_id, sort_order, key, text)
  values (v_round_id, p_section_id, v_sort_order, v_key, v_text)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.admin_update_statement(p_statement_id uuid, p_text text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_round_id uuid;
  v_text text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can edit round content' using errcode = '42501', hint = 'not_admin';
  end if;

  select round_id into v_round_id from public.statements where id = p_statement_id;
  if v_round_id is null then
    raise exception 'Statement not found' using errcode = 'P0002', hint = 'statement_not_found';
  end if;

  if not public.round_content_editable(v_round_id) then
    raise exception 'This round has opened — its sections and statements can no longer be edited.'
      using errcode = '23514', hint = 'round_locked';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.round_content:' || v_round_id::text));

  v_text := btrim(p_text);
  if v_text = '' then
    raise exception 'Enter the statement text.' using errcode = '22023', hint = 'text_blank';
  end if;

  update public.statements set text = v_text where id = p_statement_id;
end;
$$;

create or replace function public.admin_delete_statement(p_statement_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_round_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can edit round content' using errcode = '42501', hint = 'not_admin';
  end if;

  select round_id into v_round_id from public.statements where id = p_statement_id;
  if v_round_id is null then
    raise exception 'Statement not found' using errcode = 'P0002', hint = 'statement_not_found';
  end if;

  if not public.round_content_editable(v_round_id) then
    raise exception 'This round has opened — its sections and statements can no longer be edited.'
      using errcode = '23514', hint = 'round_locked';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.round_content:' || v_round_id::text));

  delete from public.statements where id = p_statement_id;
end;
$$;

create or replace function public.admin_reorder_statements(p_section_id uuid, p_statement_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_round_id uuid;
  v_count int;
  v_given_count int;
  v_distinct_count int;
  v_foreign_count int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can edit round content' using errcode = '42501', hint = 'not_admin';
  end if;

  select round_id into v_round_id from public.sections where id = p_section_id;
  if v_round_id is null then
    raise exception 'Section not found' using errcode = 'P0002', hint = 'section_not_found';
  end if;

  if not public.round_content_editable(v_round_id) then
    raise exception 'This round has opened — its sections and statements can no longer be edited.'
      using errcode = '23514', hint = 'round_locked';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.round_content:' || v_round_id::text));

  select count(*) into v_count from public.statements where section_id = p_section_id;
  select count(*) into v_given_count from unnest(p_statement_ids);
  select count(*) into v_distinct_count from (select distinct x from unnest(p_statement_ids) x) d;
  select count(*) into v_foreign_count
  from unnest(p_statement_ids) x
  where x not in (select id from public.statements where section_id = p_section_id);

  if v_given_count <> v_count or v_distinct_count <> v_count or v_foreign_count > 0 then
    raise exception 'The statement order no longer matches this section.'
      using errcode = '22023', hint = 'invalid_order';
  end if;

  update public.statements
  set sort_order = 10000 + u.ord
  from unnest(p_statement_ids) with ordinality as u(id, ord)
  where public.statements.id = u.id;

  update public.statements
  set sort_order = u.ord
  from unnest(p_statement_ids) with ordinality as u(id, ord)
  where public.statements.id = u.id;
end;
$$;

create or replace function public.admin_add_section(
  p_round_id uuid,
  p_title text,
  p_prompt text,
  p_scale_key text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_title text;
  v_prompt text;
  v_sort_order smallint;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can edit round content' using errcode = '42501', hint = 'not_admin';
  end if;

  if not exists (select 1 from public.rounds where id = p_round_id) then
    raise exception 'Round not found' using errcode = 'P0002', hint = 'round_not_found';
  end if;

  if not public.round_content_editable(p_round_id) then
    raise exception 'This round has opened — its sections and statements can no longer be edited.'
      using errcode = '23514', hint = 'round_locked';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.round_content:' || p_round_id::text));

  v_title := btrim(p_title);
  if v_title = '' then
    raise exception 'Enter a section title.' using errcode = '22023', hint = 'title_blank';
  end if;

  v_prompt := btrim(p_prompt);
  if v_prompt = '' then
    raise exception 'Enter a section prompt.' using errcode = '22023', hint = 'prompt_blank';
  end if;

  if not exists (select 1 from public.scales where key = p_scale_key) then
    raise exception 'Choose a valid scale.' using errcode = '22023', hint = 'invalid_scale';
  end if;

  select coalesce(max(sort_order), 0) + 1 into v_sort_order
  from public.sections
  where round_id = p_round_id;

  insert into public.sections (round_id, sort_order, title, prompt, scale_key)
  values (p_round_id, v_sort_order, v_title, v_prompt, p_scale_key)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.admin_update_section(
  p_section_id uuid,
  p_title text,
  p_prompt text,
  p_scale_key text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_round_id uuid;
  v_title text;
  v_prompt text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can edit round content' using errcode = '42501', hint = 'not_admin';
  end if;

  select round_id into v_round_id from public.sections where id = p_section_id;
  if v_round_id is null then
    raise exception 'Section not found' using errcode = 'P0002', hint = 'section_not_found';
  end if;

  if not public.round_content_editable(v_round_id) then
    raise exception 'This round has opened — its sections and statements can no longer be edited.'
      using errcode = '23514', hint = 'round_locked';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.round_content:' || v_round_id::text));

  v_title := btrim(p_title);
  if v_title = '' then
    raise exception 'Enter a section title.' using errcode = '22023', hint = 'title_blank';
  end if;

  v_prompt := btrim(p_prompt);
  if v_prompt = '' then
    raise exception 'Enter a section prompt.' using errcode = '22023', hint = 'prompt_blank';
  end if;

  if not exists (select 1 from public.scales where key = p_scale_key) then
    raise exception 'Choose a valid scale.' using errcode = '22023', hint = 'invalid_scale';
  end if;

  update public.sections
  set title = v_title, prompt = v_prompt, scale_key = p_scale_key
  where id = p_section_id;
end;
$$;

create or replace function public.admin_delete_section(p_section_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_round_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can edit round content' using errcode = '42501', hint = 'not_admin';
  end if;

  select round_id into v_round_id from public.sections where id = p_section_id;
  if v_round_id is null then
    raise exception 'Section not found' using errcode = 'P0002', hint = 'section_not_found';
  end if;

  if not public.round_content_editable(v_round_id) then
    raise exception 'This round has opened — its sections and statements can no longer be edited.'
      using errcode = '23514', hint = 'round_locked';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.round_content:' || v_round_id::text));

  delete from public.sections where id = p_section_id;
end;
$$;

create or replace function public.admin_reorder_sections(p_round_id uuid, p_section_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count int;
  v_given_count int;
  v_distinct_count int;
  v_foreign_count int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can edit round content' using errcode = '42501', hint = 'not_admin';
  end if;

  if not exists (select 1 from public.rounds where id = p_round_id) then
    raise exception 'Round not found' using errcode = 'P0002', hint = 'round_not_found';
  end if;

  if not public.round_content_editable(p_round_id) then
    raise exception 'This round has opened — its sections and statements can no longer be edited.'
      using errcode = '23514', hint = 'round_locked';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.round_content:' || p_round_id::text));

  select count(*) into v_count from public.sections where round_id = p_round_id;
  select count(*) into v_given_count from unnest(p_section_ids);
  select count(*) into v_distinct_count from (select distinct x from unnest(p_section_ids) x) d;
  select count(*) into v_foreign_count
  from unnest(p_section_ids) x
  where x not in (select id from public.sections where round_id = p_round_id);

  if v_given_count <> v_count or v_distinct_count <> v_count or v_foreign_count > 0 then
    raise exception 'The section order no longer matches this round.'
      using errcode = '22023', hint = 'invalid_order';
  end if;

  update public.sections
  set sort_order = 10000 + u.ord
  from unnest(p_section_ids) with ordinality as u(id, ord)
  where public.sections.id = u.id;

  update public.sections
  set sort_order = u.ord
  from unnest(p_section_ids) with ordinality as u(id, ord)
  where public.sections.id = u.id;
end;
$$;

revoke execute on function public.admin_add_statement(uuid, text) from public, anon;
grant execute on function public.admin_add_statement(uuid, text) to authenticated;
revoke execute on function public.admin_update_statement(uuid, text) from public, anon;
grant execute on function public.admin_update_statement(uuid, text) to authenticated;
revoke execute on function public.admin_delete_statement(uuid) from public, anon;
grant execute on function public.admin_delete_statement(uuid) to authenticated;
revoke execute on function public.admin_reorder_statements(uuid, uuid[]) from public, anon;
grant execute on function public.admin_reorder_statements(uuid, uuid[]) to authenticated;
revoke execute on function public.admin_add_section(uuid, text, text, text) from public, anon;
grant execute on function public.admin_add_section(uuid, text, text, text) to authenticated;
revoke execute on function public.admin_update_section(uuid, text, text, text) from public, anon;
grant execute on function public.admin_update_section(uuid, text, text, text) to authenticated;
revoke execute on function public.admin_delete_section(uuid) from public, anon;
grant execute on function public.admin_delete_section(uuid) to authenticated;
revoke execute on function public.admin_reorder_sections(uuid, uuid[]) from public, anon;
grant execute on function public.admin_reorder_sections(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Comments — which requirement each function/trigger/policy serves.
-- ---------------------------------------------------------------------------

comment on function public.round_content_editable_at(timestamptz, timestamptz) is 'RND-03: the single pure content-lock derivation — locks exactly at opens_at, never merely at scheduling.';
comment on function public.round_content_editable(uuid) is 'RND-03: round_content_editable_at applied to a round id at now().';
comment on policy sections_insert_admins_editable on public.sections is 'RND-03: admins may insert sections only while the round is still content-editable.';
comment on policy sections_update_admins_editable on public.sections is 'RND-03: admins may update sections only while the round is still content-editable.';
comment on policy sections_delete_admins_editable on public.sections is 'RND-03: admins may delete sections only while the round is still content-editable.';
comment on policy statements_insert_admins_editable on public.statements is 'RND-03: admins may insert statements only while the round is still content-editable.';
comment on policy statements_update_admins_editable on public.statements is 'RND-03: admins may update statements only while the round is still content-editable.';
comment on policy statements_delete_admins_editable on public.statements is 'RND-03: admins may delete statements only while the round is still content-editable.';
comment on function public.sections_before_write() is 'RND-03/RND-04: refuses content changes to an opened round and cross-round moves, for every role.';
comment on function public.statements_before_write() is 'RND-03/RND-04: refuses content changes to an opened round, cross-round/section moves, and key changes, for every role.';
comment on function public.admin_create_round(text) is 'RND-01/RND-04: key-preserving copy of the most recent round into a new draft.';
comment on function public.admin_add_statement(uuid, text) is 'RND-03/RND-04: adds a statement with a freshly generated, globally-unique key.';
comment on function public.admin_update_statement(uuid, text) is 'RND-03: updates a statement''s text; its key is immutable.';
comment on function public.admin_delete_statement(uuid) is 'RND-03: deletes a statement from an editable round.';
comment on function public.admin_reorder_statements(uuid, uuid[]) is 'RND-03: two-phase reorder of a section''s statements, validated as an exact permutation.';
comment on function public.admin_add_section(uuid, text, text, text) is 'RND-03: adds a section to an editable round.';
comment on function public.admin_update_section(uuid, text, text, text) is 'RND-03: updates a section''s title/prompt/scale.';
comment on function public.admin_delete_section(uuid) is 'RND-03: deletes a section (statements cascade) from an editable round.';
comment on function public.admin_reorder_sections(uuid, uuid[]) is 'RND-03: two-phase reorder of a round''s sections, validated as an exact permutation.';
