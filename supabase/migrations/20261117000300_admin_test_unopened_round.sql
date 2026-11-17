-- Quick task 261117-it4 -- admin test mode for an unopened round.
--
-- While a round is an UNOPENED DRAFT (opens_at and closes_at both null),
-- admins can answer it through the participant screens, add sample answers
-- and clear them again. Every response on an unopened draft is test data:
-- participants can never write to a draft (their policies only allow the
-- open round), so there is no flag column and the results functions, the
-- dashboard function, the CSV and the responses list are unchanged. When a
-- round leaves the unopened-draft state by ANY path (Open now, saving an
-- open or close date, or a direct update of the dates), a trigger deletes
-- every response, its answers and any per-round results consent on that
-- round in the same transaction, before the round can take a real answer.
-- A round that has responses can never go back to having no dates, so real
-- responses can never be treated as test answers.
--
-- This file:
--   1. public.round_is_draft(uuid): internal helper (both dates null)
--   2. responses.user_id becomes nullable (sample answers have no
--      participant); the default and the per-round uniqueness are kept
--   3. responses_before_write: copied VERBATIM from 20261017000100
--      section 6, plus only lines ending in "-- draft" (a static test
--      proves it): a response with no participant is refused unless its
--      round is an unopened draft
--   4. four admin-only RLS policies letting an admin write their OWN
--      response and answers on an unopened draft (participant policies
--      are unchanged)
--   5. rounds triggers: clear test answers when a draft gets a date;
--      refuse to turn a round that has responses back into a draft
--   6. statements trigger: test answers never block deleting a draft's
--      statement
--   7. admin_test_reset / admin_test_clear / admin_test_add_samples
--   8. comments
--
-- No row is changed by this file. Forward-only: no BEGIN/COMMIT (the
-- Supabase CLI wraps each migration file in its own transaction), and
-- $t$...$t$ dollar quoting for comment text. Apply this AFTER
-- 20261117000200_session_2_holding_space_for_uncertainty.sql. The version
-- prefix of this file is a working name and may be renamed to the version
-- Supabase records.
--
-- Once this migration has been applied to the hosted project, NEVER edit it
-- again -- fixes are forward migrations.

-- ---------------------------------------------------------------------------
-- 1. public.round_is_draft: true only when the round exists with no open
--    date and no close date. Internal: triggers and SECURITY DEFINER
--    functions call it as owner. The RLS policies below inline their own
--    check, so participants can't use it to probe round ids.
-- ---------------------------------------------------------------------------

create or replace function public.round_is_draft(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select r.opens_at is null and r.closes_at is null
      from public.rounds r
      where r.id = p_round_id
    ),
    false
  );
$$;

revoke execute on function public.round_is_draft(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Sample answers have no participant. The column keeps its auth.uid()
--    default and the existing (round_id, user_id) uniqueness; nulls are
--    distinct there, so sample rows never collide with each other or with
--    an admin's own test response.
-- ---------------------------------------------------------------------------

alter table public.responses alter column user_id drop not null;

-- ---------------------------------------------------------------------------
-- 3. responses_before_write (from 20261017000100 section 6). Only the
--    lines ending in "-- draft" are new.
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
    if new.user_id is null and not public.round_is_draft(new.round_id) then -- draft
      raise exception 'Only test answers on an unopened draft can have no participant' using errcode = '23514'; -- draft
    end if; -- draft
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
-- 4. Admin-only draft policies. An admin may create and update their OWN
--    unsubmitted response, and its answers, on an unopened draft. The
--    participant policies (open round only) are untouched; Postgres ORs
--    permissive policies, so a participant still can't write to a draft.
--    Reads need no new policy: responses_select_own / answers_select_own
--    already return the admin's own rows. There is no delete policy.
-- ---------------------------------------------------------------------------

drop policy if exists responses_insert_admin_draft on public.responses;
create policy responses_insert_admin_draft
  on public.responses
  for insert
  to authenticated
  with check (
    (select public.is_admin())
    and user_id = (select auth.uid())
    and submitted_at is null
    and exists (
      select 1 from public.rounds rd
      where rd.id = responses.round_id
        and rd.opens_at is null
        and rd.closes_at is null
    )
  );

drop policy if exists responses_update_admin_draft on public.responses;
create policy responses_update_admin_draft
  on public.responses
  for update
  to authenticated
  using (
    (select public.is_admin())
    and user_id = (select auth.uid())
    and submitted_at is null
    and exists (
      select 1 from public.rounds rd
      where rd.id = responses.round_id
        and rd.opens_at is null
        and rd.closes_at is null
    )
  )
  with check (
    (select public.is_admin())
    and user_id = (select auth.uid())
    and exists (
      select 1 from public.rounds rd
      where rd.id = responses.round_id
        and rd.opens_at is null
        and rd.closes_at is null
    )
  );

drop policy if exists answers_insert_admin_draft on public.answers;
create policy answers_insert_admin_draft
  on public.answers
  for insert
  to authenticated
  with check (
    (select public.is_admin())
    and exists (
      select 1 from public.rounds rd
      where rd.id = answers.round_id
        and rd.opens_at is null
        and rd.closes_at is null
    )
    and exists (
      select 1 from public.responses r
      where r.id = answers.response_id
        and r.user_id = (select auth.uid())
        and r.submitted_at is null
    )
  );

drop policy if exists answers_update_admin_draft on public.answers;
create policy answers_update_admin_draft
  on public.answers
  for update
  to authenticated
  using (
    (select public.is_admin())
    and exists (
      select 1 from public.rounds rd
      where rd.id = answers.round_id
        and rd.opens_at is null
        and rd.closes_at is null
    )
    and exists (
      select 1 from public.responses r
      where r.id = answers.response_id
        and r.user_id = (select auth.uid())
        and r.submitted_at is null
    )
  )
  with check (
    (select public.is_admin())
    and exists (
      select 1 from public.rounds rd
      where rd.id = answers.round_id
        and rd.opens_at is null
        and rd.closes_at is null
    )
    and exists (
      select 1 from public.responses r
      where r.id = answers.response_id
        and r.user_id = (select auth.uid())
        and r.submitted_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Leaving the unopened-draft state clears the test answers. AFTER UPDATE
--    means the clear only runs once the date change itself (including
--    rounds_prevent_overlap and the one-open-window constraint) has
--    succeeded, and it is in the same transaction. admin_open_round,
--    admin_update_round, update_round_at, open_round_at and direct
--    service-role updates all go through it, so none of them is replaced.
--    The BEFORE UPDATE guard refuses, for every role, to turn a round that
--    has responses back into an unopened draft: real responses only exist
--    on rounds that were open, so they can never be cleared here. A
--    scheduled round with no responses can still go back to no dates.
-- ---------------------------------------------------------------------------

create or replace function public.rounds_clear_test_answers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.results_consent_rounds where round_id = new.id;
  delete from public.responses where round_id = new.id;
  return null;
end;
$$;

drop trigger if exists rounds_clear_test_answers on public.rounds;
create trigger rounds_clear_test_answers
  after update of opens_at, closes_at on public.rounds
  for each row
  when (old.opens_at is null and old.closes_at is null and (new.opens_at is not null or new.closes_at is not null))
  execute function public.rounds_clear_test_answers();

create or replace function public.rounds_keep_responses_out_of_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.responses where round_id = new.id) then
    raise exception 'A round that has responses can''t go back to having no dates'
      using errcode = '23514', hint = 'round_has_responses';
  end if;
  return new;
end;
$$;

drop trigger if exists rounds_keep_responses_out_of_draft on public.rounds;
create trigger rounds_keep_responses_out_of_draft
  before update of opens_at, closes_at on public.rounds
  for each row
  when (new.opens_at is null and new.closes_at is null and (old.opens_at is not null or old.closes_at is not null))
  execute function public.rounds_keep_responses_out_of_draft();

-- ---------------------------------------------------------------------------
-- 6. Test answers never block deleting a draft's statement (answers ->
--    statements has no ON DELETE action). Real answers on a round that is
--    not an unopened draft still block it, as before. The content lock is
--    date-based and untouched.
-- ---------------------------------------------------------------------------

create or replace function public.statements_before_delete_clear_test_answers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.round_is_draft(old.round_id) then
    delete from public.answers
    where statement_id = old.id and round_id = old.round_id;
  end if;
  return old;
end;
$$;

drop trigger if exists statements_before_delete_clear_test_answers on public.statements;
create trigger statements_before_delete_clear_test_answers
  before delete on public.statements
  for each row execute function public.statements_before_delete_clear_test_answers();

-- ---------------------------------------------------------------------------
-- 7. Admin test functions. Each is admin-only (42501), takes a FOR SHARE
--    lock on the round (it serialises with the FOR UPDATE lock taken by
--    open_round_at / update_round_at), and refuses unless the round is an
--    unopened draft (23514, hint round_not_draft).
-- ---------------------------------------------------------------------------

-- 7a. Start again: delete the caller's own response on the draft.
create or replace function public.admin_test_reset(p_round_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked uuid;
  v_deleted integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can reset test answers' using errcode = '42501', hint = 'not_admin';
  end if;

  select id into v_locked from public.rounds where id = p_round_id for share;
  if not found then
    raise exception 'Round not found' using errcode = 'P0002', hint = 'round_not_found';
  end if;

  if not public.round_is_draft(p_round_id) then
    raise exception 'Test answers are only available while a round has no open or close date'
      using errcode = '23514', hint = 'round_not_draft';
  end if;

  delete from public.responses
  where round_id = p_round_id and user_id = (select auth.uid());
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.admin_test_reset(uuid) from public, anon;
grant execute on function public.admin_test_reset(uuid) to authenticated, service_role;

-- 7b. Clear test answers: every response (and consent row) on the draft.
create or replace function public.admin_test_clear(p_round_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked uuid;
  v_deleted integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can clear test answers' using errcode = '42501', hint = 'not_admin';
  end if;

  select id into v_locked from public.rounds where id = p_round_id for share;
  if not found then
    raise exception 'Round not found' using errcode = 'P0002', hint = 'round_not_found';
  end if;

  if not public.round_is_draft(p_round_id) then
    raise exception 'Test answers are only available while a round has no open or close date'
      using errcode = '23514', hint = 'round_not_draft';
  end if;

  delete from public.results_consent_rounds where round_id = p_round_id;
  delete from public.responses where round_id = p_round_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.admin_test_clear(uuid) from public, anon;
grant execute on function public.admin_test_clear(uuid) to authenticated, service_role;

-- 7c. Deterministic pick in 0..p_n-1 from a seed string. The mask keeps the
--     hash non-negative without abs() overflowing on the minimum int.
create or replace function public.test_sample_pick(p_seed text, p_n integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_n is null or p_n < 1 then 0
    else ((hashtext(p_seed)::bigint & 2147483647) % p_n)::integer
  end;
$$;

revoke execute on function public.test_sample_pick(text, integer) from public, anon, authenticated;

-- 7d. Add sample answers: replaces earlier sample rows (user_id null) with
--     p_count submitted responses covering every question kind. Never
--     touches the admin's own response and never creates an auth user.
create or replace function public.admin_test_add_samples(p_round_id uuid, p_count integer default 20)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked uuid;
  v_response_id uuid;
  v_st record;
  v_all smallint[];
  v_plain smallint[];
  v_exclusive smallint[];
  v_n integer;
  v_lean integer;
  v_noise integer;
  v_k integer;
  v_value smallint;
  v_choices smallint[];
  v_skip boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can add sample answers' using errcode = '42501', hint = 'not_admin';
  end if;

  select id into v_locked from public.rounds where id = p_round_id for share;
  if not found then
    raise exception 'Round not found' using errcode = 'P0002', hint = 'round_not_found';
  end if;

  if not public.round_is_draft(p_round_id) then
    raise exception 'Test answers are only available while a round has no open or close date'
      using errcode = '23514', hint = 'round_not_draft';
  end if;

  if p_count is null or p_count < 1 or p_count > 50 then
    raise exception 'Choose between 1 and 50 sample answers' using errcode = '22023';
  end if;

  if not exists (select 1 from public.statements where round_id = p_round_id) then
    raise exception 'This round has no questions yet' using errcode = '22023';
  end if;

  delete from public.responses where round_id = p_round_id and user_id is null;

  for v_i in 1..p_count loop
    insert into public.responses (round_id, user_id) values (p_round_id, null)
    returning id into v_response_id;

    for v_st in
      select st.id, st.key, st.kind, st.options, st.choice_count, st.optional, sec.scale_key
      from public.statements st
      join public.sections sec on sec.id = st.section_id and sec.round_id = st.round_id
      where st.round_id = p_round_id
      order by sec.sort_order, st.sort_order
    loop
      v_value := null;
      v_choices := null;
      v_skip := false;
      v_all := null;
      v_plain := null;
      v_exclusive := null;
      v_noise := public.test_sample_pick(v_st.key || ':' || v_i, 5) - 2;

      if v_st.options is not null then
        select
          array_agg((t.e ->> 'value')::smallint order by t.ord),
          array_agg((t.e ->> 'value')::smallint order by t.ord)
            filter (where not coalesce((t.e ->> 'exclusive')::boolean, false)),
          array_agg((t.e ->> 'value')::smallint order by t.ord)
            filter (where coalesce((t.e ->> 'exclusive')::boolean, false))
        into v_all, v_plain, v_exclusive
        from jsonb_array_elements(v_st.options) with ordinality as t(e, ord);
        if v_plain is null then
          v_plain := v_all;
        end if;
      end if;

      if v_st.kind = 'scale' then
        select array_agg(so.value order by so.value) into v_all
        from public.scale_options so
        where so.scale_key = v_st.scale_key;
        v_n := coalesce(cardinality(v_all), 0);
        v_lean := public.test_sample_pick(v_st.key || ':lean', v_n);
        v_value := v_all[least(greatest(v_lean + v_noise, 0), greatest(v_n - 1, 0)) + 1];

      elsif v_st.kind = 'choice_one' then
        v_n := coalesce(cardinality(v_plain), 0);
        v_lean := public.test_sample_pick(v_st.key || ':lean', v_n);
        v_value := v_plain[least(greatest(v_lean + v_noise, 0), greatest(v_n - 1, 0)) + 1];

      elsif v_st.kind = 'rating' then
        v_value := least(greatest(2 + public.test_sample_pick(v_st.key || ':lean', 7) + v_noise, 0), 10);

      elsif v_st.kind = 'two_ended' then
        v_value := least(greatest(
          15 + public.test_sample_pick(v_st.key || ':lean', 71)
            + public.test_sample_pick(v_st.key || ':' || v_i, 41) - 20,
          0), 100);

      elsif v_st.kind = 'prediction' then
        if v_st.optional and public.test_sample_pick(v_st.key || ':' || v_i || ':skip', 4) = 0 then
          v_skip := true;
        else
          v_value := 10 + public.test_sample_pick(v_st.key || ':' || v_i, 81);
        end if;

      elsif v_st.kind = 'choice_multi' then
        if coalesce(cardinality(v_exclusive), 0) > 0
          and public.test_sample_pick(v_st.key || ':' || v_i || ':excl', 10) = 0
        then
          v_choices := array[v_exclusive[1]];
        else
          select array_agg(p.x order by p.ord) into v_choices
          from unnest(v_plain) with ordinality as p(x, ord)
          where public.test_sample_pick(v_st.key || ':' || v_i || ':' || p.x, 100)
            < 25 + public.test_sample_pick(v_st.key || ':bias:' || p.x, 50);
          if v_choices is null then
            v_n := coalesce(cardinality(v_plain), 0);
            v_lean := public.test_sample_pick(v_st.key || ':lean', v_n);
            v_choices := array[v_plain[least(greatest(v_lean, 0), greatest(v_n - 1, 0)) + 1]];
          end if;
        end if;

      elsif v_st.kind = 'choice_exact' then
        select (array_agg(p.x order by
                 public.test_sample_pick(v_st.key || ':bias:' || p.x, 6)
                   + public.test_sample_pick(v_st.key || ':' || v_i || ':' || p.x, 6),
                 p.x))[1:v_st.choice_count]
        into v_choices
        from unnest(v_plain) as p(x);

      elsif v_st.kind = 'choice_up_to' then
        if coalesce(cardinality(v_exclusive), 0) > 0
          and public.test_sample_pick(v_st.key || ':' || v_i || ':excl', 10) = 0
        then
          v_choices := array[v_exclusive[1]];
        else
          v_k := 1 + public.test_sample_pick(v_st.key || ':' || v_i || ':k', v_st.choice_count);
          select (array_agg(p.x order by
                   public.test_sample_pick(v_st.key || ':bias:' || p.x, 6)
                     + public.test_sample_pick(v_st.key || ':' || v_i || ':' || p.x, 6),
                   p.x))[1:v_k]
          into v_choices
          from unnest(v_plain) as p(x);
        end if;

      elsif v_st.kind = 'ranking' then
        select array_agg(p.x order by
                 public.test_sample_pick(v_st.key || ':bias:' || p.x, 6)
                   + public.test_sample_pick(v_st.key || ':' || v_i || ':' || p.x, 4),
                 p.x)
        into v_choices
        from unnest(v_all) as p(x);

      else
        raise exception 'Sample answers do not support this question kind' using errcode = '22023';
      end if;

      if not v_skip then
        insert into public.answers (response_id, round_id, statement_id, value, choice_values)
        values (v_response_id, p_round_id, v_st.id, v_value, v_choices);
      end if;
    end loop;

    update public.responses set submitted_at = now() where id = v_response_id;
  end loop;

  return p_count;
end;
$$;

revoke execute on function public.admin_test_add_samples(uuid, integer) from public, anon;
grant execute on function public.admin_test_add_samples(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Comments.
-- ---------------------------------------------------------------------------

comment on column public.responses.user_id is $t$The participant. Null only for sample test answers on a round with no open or close date (enforced by responses_before_write); such rows are deleted when the round is given a date.$t$;

comment on function public.round_is_draft(uuid) is $t$Internal: true when the round exists with no open date and no close date (an unopened draft). Not executable by signed-in users.$t$;

comment on function public.responses_before_write() is $t$SURV-06/07: submit requires every NON-optional statement answered; submit is immutable. A response with no participant is allowed only on an unopened draft (sample test answers).$t$;

comment on policy responses_insert_admin_draft on public.responses is $t$Admin test mode: an admin may create their own unsubmitted response on a round with no open or close date.$t$;
comment on policy responses_update_admin_draft on public.responses is $t$Admin test mode: an admin may update (and submit) their own unsubmitted response on a round with no open or close date.$t$;
comment on policy answers_insert_admin_draft on public.answers is $t$Admin test mode: an admin may answer on their own unsubmitted response on a round with no open or close date.$t$;
comment on policy answers_update_admin_draft on public.answers is $t$Admin test mode: an admin may change answers on their own unsubmitted response on a round with no open or close date.$t$;

comment on function public.rounds_clear_test_answers() is $t$Trigger: when a round with no dates is given an open or close date, deletes every response (answers by cascade) and every per-round results consent row on it, in the same transaction.$t$;
comment on function public.rounds_keep_responses_out_of_draft() is $t$Trigger: refuses to remove both dates from a round that has responses (hint round_has_responses), so real responses are never treated as test answers.$t$;
comment on function public.statements_before_delete_clear_test_answers() is $t$Trigger: deleting a statement of an unopened draft first deletes its test answers.$t$;

comment on function public.admin_test_reset(uuid) is $t$Admin test mode: deletes the calling admin's own response on an unopened draft (Start again). Returns the number of responses deleted.$t$;
comment on function public.admin_test_clear(uuid) is $t$Admin test mode: deletes every response and per-round consent row on an unopened draft. Returns the number of responses deleted.$t$;
comment on function public.test_sample_pick(text, integer) is $t$Internal: deterministic pick in 0..n-1 from a seed string, used by admin_test_add_samples.$t$;
comment on function public.admin_test_add_samples(uuid, integer) is $t$Admin test mode: replaces the sample answers on an unopened draft with p_count (1..50) submitted responses that have no participant, covering every question kind. Deterministic. Returns p_count.$t$;
