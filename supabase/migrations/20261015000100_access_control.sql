-- Access control for the Design Futures Survey: admin/eligibility lists,
-- eligibility + admin check functions, and the two Auth Hooks that enforce
-- them at the Supabase Auth level (so a direct API call can't bypass the
-- app's server-action pre-check).
--
-- No BEGIN/COMMIT: the Supabase CLI wraps each migration file in its own
-- transaction already.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.admin_emails (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint admin_emails_email_normalized check (email = lower(btrim(email))),
  constraint admin_emails_email_shape check (email ~ '^[^\s@"]+@[^\s@"]+$')
);

create table if not exists public.allowed_domains (
  domain text primary key,
  created_at timestamptz not null default now(),
  constraint allowed_domains_domain_normalized check (domain = lower(btrim(domain))),
  constraint allowed_domains_domain_no_at check (domain !~ '@'),
  constraint allowed_domains_domain_has_dot check (domain ~ '\.')
);

-- ---------------------------------------------------------------------------
-- Seed rows (idempotent — this migration ships identically to every
-- environment via `supabase db push`; there is no separate seed.sql because
-- this project's single hosted DB is both dev and live)
-- ---------------------------------------------------------------------------

insert into public.admin_emails (email)
values
  ('rhodes.james@gmail.com'),
  ('james.carrigan@network.rca.ac.uk')
on conflict (email) do nothing;

insert into public.allowed_domains (domain)
values
  ('network.rca.ac.uk')
on conflict (domain) do nothing;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

create or replace function public.is_email_eligible(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_email is null then false
    when btrim(lower(p_email)) = '' then false
    when lower(btrim(p_email)) !~ '^[^\s@"]+@[^\s@"]+$' then false
    else
      exists (
        select 1 from public.admin_emails
        where email = lower(btrim(p_email))
      )
      or exists (
        select 1 from public.allowed_domains
        where domain = split_part(lower(btrim(p_email)), '@', 2)
      )
  end;
$$;

revoke execute on function public.is_email_eligible(text) from public;
grant execute on function public.is_email_eligible(text) to anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_emails
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- Auth Hook: before_user_created. Rejects signups (including those
-- triggered by signInWithOtp for a brand-new or unconfirmed email) for any
-- address that is not admin-listed or on an allowed domain.
create or replace function public.hook_restrict_signup_by_email_domain(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  v_email := event->'user'->>'email';

  if public.is_email_eligible(v_email) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This email isn''t eligible for this survey.'
    )
  );
end;
$$;

-- Auth Hook: custom_access_token. Refuses to issue claims for a password
-- grant, so password sign-in is never an available login method even if an
-- account somehow has a password set.
create or replace function public.hook_reject_password_sign_in(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if event->>'authentication_method' = 'password' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Password sign-in isn''t available. Sign in with an emailed code.'
      )
    );
  end if;

  return jsonb_build_object('claims', event->'claims');
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants for the Auth Hooks (supabase_auth_admin calls these; no other role
-- should be able to invoke them directly)
-- ---------------------------------------------------------------------------

grant usage on schema public to supabase_auth_admin;

grant execute on function public.hook_restrict_signup_by_email_domain(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_by_email_domain(jsonb) from authenticated, anon, public;

grant execute on function public.hook_reject_password_sign_in(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_reject_password_sign_in(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- Row Level Security — admins may read; no write policies yet (AUTH-07 is
-- Phase 3)
-- ---------------------------------------------------------------------------

alter table public.admin_emails enable row level security;
alter table public.allowed_domains enable row level security;

create policy admin_emails_select_admins
  on public.admin_emails
  for select
  to authenticated
  using (public.is_admin());

create policy allowed_domains_select_admins
  on public.allowed_domains
  for select
  to authenticated
  using (public.is_admin());
