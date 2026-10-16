-- Admin-only password sign-in (2026-10-15 user decision, this quick task).
--
-- Supabase's built-in email sender only delivers to Supabase org members at
-- 2 emails/hour, which blocks admin OTP sign-in in practice. This migration
-- gives admins a separate email + password path at /login/admin, while the
-- participant-facing /login OTP flow (AUTH-02: one eligibility oracle, no
-- admin-specific branch) is completely untouched.
--
-- This is a deliberate, scoped departure from AUTH-02 for the admin-only
-- password path. AUTH-02 stays in full force for /login.
--
-- The replacement function keeps its original name
-- (public.hook_reject_password_sign_in), so the
-- [auth.hook.custom_access_token] uri in supabase/config.toml is unchanged
-- and no `supabase config push` is needed or allowed by this migration.
--
-- No BEGIN/COMMIT: the Supabase CLI wraps each migration file in its own
-- transaction already. Once applied, this file must never be edited — any
-- later fix is a new forward migration.

create or replace function public.hook_reject_password_sign_in(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Every non-password authentication method (otp, magiclink,
  -- token_refresh, email/signup, ...), including a NULL
  -- authentication_method, passes through unchanged — byte-for-byte the
  -- same behavior as the original hook in migration 20261015000100.
  if event->>'authentication_method' is distinct from 'password' then
    return jsonb_build_object('claims', event->'claims');
  end if;

  -- A password grant is allowed through only when BOTH hold:
  --   1. the account carries the service-role-only
  --      app_metadata.admin_password_login = true flag (compared as jsonb
  --      so a non-boolean value can never raise a cast error), and
  --   2. the email is currently a member of public.admin_emails.
  -- SECURITY DEFINER is required here (matching
  -- hook_restrict_signup_by_email_domain in migration 20261015000100) so
  -- this function can read public.admin_emails past its admin-only RLS
  -- policy while evaluated for a caller who isn't signed in yet.
  if
    event->'claims'->'app_metadata'->'admin_password_login' = 'true'::jsonb
    and exists (
      select 1
      from public.admin_emails
      where email = lower(btrim(coalesce(event->'claims'->>'email', '')))
    )
  then
    return jsonb_build_object('claims', event->'claims');
  end if;

  -- Every other password grant is refused with migration 100's original
  -- error object: a participant who sets a password through the public
  -- API, an admin without the flag, or a flagged account that is no
  -- longer on admin_emails.
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Password sign-in isn''t available. Sign in with an emailed code.'
    )
  );
end;
$$;

comment on function public.hook_reject_password_sign_in(jsonb) is
  'custom_access_token Auth Hook. Allows a password grant to issue claims '
  'only when the account is a current public.admin_emails member AND '
  'carries the service-role-only app_metadata.admin_password_login = true '
  'flag (set by scripts/set-admin-password.ts). Every other password grant '
  'is refused; every non-password authentication method is unchanged.';

-- Restate the grants (unchanged from migration 20261015000100): only
-- supabase_auth_admin may invoke this hook.
grant execute on function public.hook_reject_password_sign_in(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_reject_password_sign_in(jsonb) from authenticated, anon, public;
