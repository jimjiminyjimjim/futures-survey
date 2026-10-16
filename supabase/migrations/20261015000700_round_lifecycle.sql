-- Round lifecycle: schedule a round's title/open/close dates, open a round
-- now, or close one early (RND-02, RND-05, RND-06). Every transition rule
-- lives here, instant-parameterised so it is fully testable at past
-- instants without ever touching the live, currently-open Round 1.
--
-- Additive only — never edits 20261015000100/200/300/400/500/600. No
-- BEGIN/COMMIT: the Supabase CLI wraps each migration file in its own
-- transaction already.
--
-- Once this migration has been applied to the hosted project, NEVER edit it
-- again — fixes are forward migrations (same convention as the six prior
-- migrations in this project).

-- ---------------------------------------------------------------------------
-- 1. public.update_round_at — title/opens_at/closes_at edits while a round
--    is still editable (draft/scheduled/open; refused once closed).
--    Validates in a fixed order so a submission with several problems
--    always reports the first one (RND-02 ordering edge): not found,
--    closed, blank title, opens locked, opens in past, closes in past,
--    close-before-open — then the rounds_prevent_overlap trigger (600) is
--    the last word on overlap.
-- ---------------------------------------------------------------------------

create or replace function public.update_round_at(
  p_round_id uuid,
  p_title text,
  p_opens_at timestamptz,
  p_closes_at timestamptz,
  p_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_opens_at timestamptz;
  v_old_closes_at timestamptz;
  v_status text;
  v_title text;
begin
  select opens_at, closes_at into v_old_opens_at, v_old_closes_at
  from public.rounds
  where id = p_round_id
  for update;

  if not found then
    raise exception 'Round not found' using errcode = 'P0002', hint = 'round_not_found';
  end if;

  v_status := public.round_status_at(v_old_opens_at, v_old_closes_at, p_at);

  if v_status = 'closed' then
    raise exception 'This round has closed and can''t be changed.'
      using errcode = '23514', hint = 'round_closed';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then
    raise exception 'Enter a round title.' using errcode = '22023', hint = 'round_title_blank';
  end if;

  if v_status = 'open' and p_opens_at is distinct from v_old_opens_at then
    raise exception 'This round has opened — its open date can''t be changed.'
      using errcode = '23514', hint = 'opens_locked';
  end if;

  if v_status in ('draft', 'scheduled')
    and p_opens_at is not null
    and p_opens_at is distinct from v_old_opens_at
    and p_opens_at <= p_at
  then
    raise exception 'Choose an open date and time in the future, or use Open now.'
      using errcode = '22023', hint = 'opens_in_past';
  end if;

  if p_closes_at is not null
    and p_closes_at is distinct from v_old_closes_at
    and p_closes_at <= p_at
  then
    raise exception 'Choose a close date and time in the future.'
      using errcode = '22023', hint = 'closes_in_past';
  end if;

  if p_opens_at is not null and p_closes_at is not null and p_closes_at <= p_opens_at then
    raise exception 'The close date must be after the open date.'
      using errcode = '22023', hint = 'dates_order';
  end if;

  update public.rounds
  set title = v_title, opens_at = p_opens_at, closes_at = p_closes_at
  where id = p_round_id;
end;
$$;

revoke execute on function public.update_round_at(uuid, text, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.update_round_at(uuid, text, timestamptz, timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 2. public.open_round_at — opens a round at a given instant, refusing
--    while it is already open/closed, while another round is open at that
--    instant (the friendly pre-check; rounds_one_open_window/
--    rounds_prevent_overlap from 500 are the race-proof boundary either
--    way), or once its own preset close date has already passed.
-- ---------------------------------------------------------------------------

create or replace function public.open_round_at(p_round_id uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opens_at timestamptz;
  v_closes_at timestamptz;
  v_status text;
begin
  select opens_at, closes_at into v_opens_at, v_closes_at
  from public.rounds
  where id = p_round_id
  for update;

  if not found then
    raise exception 'Round not found' using errcode = 'P0002', hint = 'round_not_found';
  end if;

  v_status := public.round_status_at(v_opens_at, v_closes_at, p_at);

  if v_status = 'open' then
    raise exception 'This round is already open.' using errcode = '23514', hint = 'round_already_open';
  end if;

  if v_status = 'closed' then
    raise exception 'This round has closed and can''t be changed.'
      using errcode = '23514', hint = 'round_closed';
  end if;

  if exists (
    select 1 from public.rounds r
    where r.id <> p_round_id
      and public.is_round_open_at(r.opens_at, r.closes_at, p_at)
  ) then
    raise exception 'Another round is currently open — close it before opening this one.'
      using errcode = '23514', hint = 'another_round_open';
  end if;

  if v_closes_at is not null and v_closes_at <= p_at then
    raise exception 'This round''s close date has already passed — change it before opening.'
      using errcode = '23514', hint = 'close_date_passed';
  end if;

  update public.rounds set opens_at = p_at where id = p_round_id;
end;
$$;

revoke execute on function public.open_round_at(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.open_round_at(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 3. public.close_round_at — closes an open round at a given instant.
--    Refuses when the round isn't open at that instant, and refuses an
--    empty window (closing at the exact instant it opened).
-- ---------------------------------------------------------------------------

create or replace function public.close_round_at(p_round_id uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opens_at timestamptz;
  v_closes_at timestamptz;
begin
  select opens_at, closes_at into v_opens_at, v_closes_at
  from public.rounds
  where id = p_round_id
  for update;

  if not found then
    raise exception 'Round not found' using errcode = 'P0002', hint = 'round_not_found';
  end if;

  if not public.is_round_open_at(v_opens_at, v_closes_at, p_at) then
    raise exception 'This round isn''t currently open.' using errcode = '23514', hint = 'round_not_open';
  end if;

  if v_opens_at = p_at then
    raise exception 'Choose a close time after this round opened.'
      using errcode = '23514', hint = 'empty_window';
  end if;

  update public.rounds set closes_at = p_at where id = p_round_id;
end;
$$;

revoke execute on function public.close_round_at(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.close_round_at(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Admin-only wrappers — exactly is_admin() + the matching *_at function
--    called with now(). No time argument ever comes from the caller
--    (RND-06 precision: Open now / Close early stamp the DB clock, never a
--    client-supplied "now").
-- ---------------------------------------------------------------------------

create or replace function public.admin_update_round(
  p_round_id uuid,
  p_title text,
  p_opens_at timestamptz,
  p_closes_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can edit rounds' using errcode = '42501', hint = 'not_admin';
  end if;

  perform public.update_round_at(p_round_id, p_title, p_opens_at, p_closes_at, now());
end;
$$;

create or replace function public.admin_open_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can open rounds' using errcode = '42501', hint = 'not_admin';
  end if;

  perform public.open_round_at(p_round_id, now());
end;
$$;

create or replace function public.admin_close_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can close rounds' using errcode = '42501', hint = 'not_admin';
  end if;

  perform public.close_round_at(p_round_id, now());
end;
$$;

revoke execute on function public.admin_update_round(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_update_round(uuid, text, timestamptz, timestamptz) to authenticated, service_role;
revoke execute on function public.admin_open_round(uuid) from public, anon;
grant execute on function public.admin_open_round(uuid) to authenticated, service_role;
revoke execute on function public.admin_close_round(uuid) from public, anon;
grant execute on function public.admin_close_round(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Comments — which requirement each function serves.
-- ---------------------------------------------------------------------------

comment on function public.update_round_at(uuid, text, timestamptz, timestamptz, timestamptz) is 'RND-02: title/open/close edits while a round is still editable, validated in a fixed order; service_role only.';
comment on function public.open_round_at(uuid, timestamptz) is 'RND-05/RND-06: opens a round at a given instant, refusing another-open/already-open/closed/close-date-passed; service_role only.';
comment on function public.close_round_at(uuid, timestamptz) is 'RND-06: closes an open round at a given instant, refusing not-open/empty-window; service_role only.';
comment on function public.admin_update_round(uuid, text, timestamptz, timestamptz) is 'RND-02: admin wrapper — is_admin() then update_round_at(..., now()).';
comment on function public.admin_open_round(uuid) is 'RND-06: admin wrapper — is_admin() then open_round_at(id, now()); no time argument from the caller.';
comment on function public.admin_close_round(uuid) is 'RND-06: admin wrapper — is_admin() then close_round_at(id, now()); no time argument from the caller.';
