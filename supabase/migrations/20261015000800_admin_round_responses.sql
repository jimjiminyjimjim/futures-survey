-- Admin-only individual responses (ADM-02, ADM-03). This is the single
-- identity-bearing read in the whole app: it joins public.responses to
-- auth.users for the participant's email. Phase 2's aggregates
-- (admin_round_response_counts/admin_statement_answer_counts) stay
-- identity-free by design; this is a separate, narrowly-scoped capability,
-- never a loosening of that model.
--
-- Additive only — never edits 20261015000100/200/300/400/500/600/700. No
-- BEGIN/COMMIT: the Supabase CLI wraps each migration file in its own
-- transaction already.
--
-- Once this migration has been applied to the hosted project, NEVER edit it
-- again — fixes are forward migrations (same convention as the seven prior
-- migrations in this project).

create or replace function public.admin_round_responses(p_round_id uuid)
returns table (
  response_id uuid,
  user_email text,
  started_at timestamptz,
  submitted_at timestamptz,
  statement_key text,
  value smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Only admins can read individual responses'
      using errcode = '42501', hint = 'not_admin';
  end if;

  return query
    select
      responses.id as response_id,
      users.email::text as user_email,
      responses.created_at as started_at,
      responses.submitted_at as submitted_at,
      statements.key as statement_key,
      answers.value as value
    from public.responses
    join auth.users as users on users.id = responses.user_id
    left join public.answers on answers.response_id = responses.id
    left join public.statements on statements.id = answers.statement_id
    where responses.round_id = p_round_id
    order by users.email, statements.key nulls first;
end;
$$;

revoke execute on function public.admin_round_responses(uuid) from public, anon;
grant execute on function public.admin_round_responses(uuid) to authenticated, service_role;

comment on function public.admin_round_responses(uuid) is 'ADM-02/ADM-03: the only identity-bearing read in this app — admin-only, joins responses to auth.users for email. Call sites must stay limited to src/lib/admin/responses-queries.ts and the CSV export route.';
