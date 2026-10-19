-- Narrow signup/sign-in eligibility to UAL: replace the RCA-only domain
-- with a contains-match against "arts.ac.uk", so every UAL college's mail
-- domain is covered (arts.ac.uk, csm.arts.ac.uk, csmarts.ac.uk,
-- lcf.arts.ac.uk, ...) without having to list each one individually.
--
-- The two existing admin_emails rows (rhodes.james@gmail.com and
-- james.carrigan@network.rca.ac.uk) are untouched and keep access: they're
-- matched by exact email in is_email_eligible/is_admin, independently of
-- allowed_domains.

delete from public.allowed_domains where domain = 'network.rca.ac.uk';

insert into public.allowed_domains (domain)
values ('arts.ac.uk')
on conflict (domain) do nothing;

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
        -- Contains-match, not exact: an allowed_domains row matches any
        -- email domain that has it as a substring (so one "arts.ac.uk" row
        -- covers every UAL subdomain/prefixed variant).
        select 1 from public.allowed_domains
        where position(domain in split_part(lower(btrim(p_email)), '@', 2)) > 0
      )
  end;
$$;

revoke execute on function public.is_email_eligible(text) from public;
grant execute on function public.is_email_eligible(text) to anon, authenticated;
