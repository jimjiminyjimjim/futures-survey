-- AUTH-07: admins maintain who is allowed in. Adds admin-only write access
-- (insert + delete, no update) to admin_emails/allowed_domains, plus a
-- before-delete trigger on admin_emails that refuses to let the table ever
-- become empty, including inside a single multi-row delete or two
-- concurrent single-row deletes (serialised by a transaction advisory
-- lock).
--
-- No BEGIN/COMMIT: the Supabase CLI wraps each migration file in its own
-- transaction already.

-- AUTH-07: only an admin may add a new admin email.
create policy admin_emails_insert_admins
  on public.admin_emails
  for insert
  to authenticated
  with check ((select public.is_admin()));

-- AUTH-07: only an admin may remove an admin email (subject to the
-- keep-one trigger below).
create policy admin_emails_delete_admins
  on public.admin_emails
  for delete
  to authenticated
  using ((select public.is_admin()));

-- AUTH-07: only an admin may add an allowed domain.
create policy allowed_domains_insert_admins
  on public.allowed_domains
  for insert
  to authenticated
  with check ((select public.is_admin()));

-- AUTH-07: only an admin may remove an allowed domain (no floor — unlike
-- admin_emails, allowed_domains has no keep-one guarantee).
create policy allowed_domains_delete_admins
  on public.allowed_domains
  for delete
  to authenticated
  using ((select public.is_admin()));

-- AUTH-07: the admin list must never become empty. Takes a transaction
-- advisory lock first so two concurrent single-row deletes (each leaving
-- "1" at the time they start) are serialised rather than both passing the
-- count check and together emptying the table; the second transaction
-- blocks until the first commits (or rolls back), then sees the first's
-- result. A single multi-row DELETE fires this trigger once per row, so a
-- statement that would empty the table is refused as a whole, since later
-- rows see earlier rows' (not-yet-committed, but visible-within-statement)
-- deletions via the per-row count check.
create or replace function public.admin_emails_keep_one()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.admin_emails:keep-one'));

  if (select count(*) from public.admin_emails) <= 1 then
    raise exception 'Cannot remove the last admin.'
      using errcode = '23514', hint = 'last_admin';
  end if;

  return old;
end;
$$;

create trigger admin_emails_keep_one
  before delete on public.admin_emails
  for each row
  execute function public.admin_emails_keep_one();
