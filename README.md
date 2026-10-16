# Design Futures Survey

A web app that runs a recurring attitudes survey for design students and
staff (RCA network). Participants sign in with a one-time email code (only
from allowed email domains), answer one statement at a time on a Likert
scale, and submit once per survey round. Admins open and close rounds on
dates they choose, view every response, and run an anonymous presentation
mode that steps through each question showing how the group answered as a
whole.

## Getting started

```bash
yarn install
yarn dev
```

Open [http://localhost:3000](http://localhost:3000). A signed-out visitor is
redirected to `/login`.

## Environment

Copy `.env.example` to `.env.local` and fill in the real values from the
Supabase dashboard (Project Settings → API Keys) or
`supabase projects api-keys --project-ref <ref> -o json`:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — public
  browser values.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only secret, used only by `tests/`,
  never by code under `src/`.
- `SUPABASE_DB_PASSWORD` — Supabase CLI only (e.g. `supabase db push` when
  the CLI's own login role can't be used).

`.env.local` is git-ignored; `.env.example` is tracked and must never hold
real values.

## Dev == live

This app has exactly **one** hosted Supabase project, used for both local
development and the live survey. There is no Docker and no local Supabase
stack.

- Schema changes go out with `supabase db push`. Once a migration has been
  applied, never edit it — write a new migration instead.
- Auth settings (hooks, email templates, OTP length) go out with
  `supabase config push`.
- Never run `supabase start` or `supabase db reset --linked` against this
  project — there is no local stack to reset to, and `--linked` resets the
  live database.

## Email delivery

Sign-in codes are currently sent with Supabase's **built-in** email sender
(no custom SMTP configured yet).

- **Limits:** the built-in sender only delivers to addresses that are
  members of the Supabase organisation that owns this project, at **2
  emails per hour**. Any other address — including real
  `network.rca.ac.uk` participants — gets rejected by Supabase Auth with
  "Email address not authorized" and never receives a code. This means
  **the survey cannot go live to real participants until custom SMTP is
  configured** (tracked as a launch blocker in `.planning/STATE.md`).
- **Template:** the custom `supabase/templates/sign-in-code.html` template
  (6-digit code only, no link) is written and ready but not yet pushed —
  Supabase's free tier rejects any auth-config push that includes an email
  template change while using the default (built-in) email provider.
- **Tests never send email:** `tests/` always issues codes via the
  service-role `generateLink`/admin API, which returns the OTP directly.
  No automated check here ever calls `signInWithOtp` for a real address,
  so test runs never depend on — or risk — actual email delivery.

### Switching to custom SMTP

1. Get SMTP credentials (host, port, username, password, sender email,
   sender name) from a provider (e.g. Resend, Postmark, SES) and verify the
   sending domain (SPF/DKIM) in that provider's dashboard.
2. Append `SUPABASE_AUTH_SMTP_PASS=<password>` to `.env.local` (git-ignored
   — never commit this value).
3. In `supabase/config.toml`, uncomment and fill in the `[auth.email.smtp]`
   block: `enabled = true`, plus `host`, `port`, `user`, `admin_email`
   (sender email) and `sender_name`, with
   `pass = "env(SUPABASE_AUTH_SMTP_PASS)"` so the CLI resolves the secret
   from the environment at push time rather than reading it from the file.
4. Raise `[auth.rate_limit] email_sent` from `2` to `100`.
5. Re-enable the sign-in-code email template that this plan's predecessor
   (01-02) deferred: uncomment the `[auth.email.template.magic_link]` and
   `[auth.email.template.confirmation]` blocks in `supabase/config.toml`
   (both point at `supabase/templates/sign-in-code.html`, already written).
6. Run `supabase config push --yes` (run it twice — the second run should
   report "Remote Auth config is up to date").

## Admin password sign-in

The built-in email sender's limits described above in "Email delivery" mean
admin OTP sign-in is often blocked in practice (only Supabase org members
receive emails, at 2/hour). To get into `/admin` without depending on email
delivery, admins can also sign in with an email + password.

- **Where:** admins sign in at `/login/admin` with email + password.
  Participants keep using emailed codes at `/login`. The two pages are
  deliberately not linked from each other.
- **Who:** only emails already on `admin_emails`, and only once the owner
  has enabled that account with the script below. Supabase Auth enforces
  this itself through the `custom_access_token` hook (migration
  `20261015001000`), so a password created any other way — even by calling
  Supabase directly — cannot sign in. `/admin` access is still decided by
  `is_admin()` exactly as before, regardless of which sign-in method
  produced the session.
- **How to set or rotate:** `yarn admin:set-password you@example.com`,
  which needs `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. It creates the
  sign-in account if that admin has never signed in before, and prints a
  generated password once. Rerun it any time to rotate the password.
- **How to revoke:** remove the email from `admin_emails` in the Supabase
  Table Editor. The database keeps at least one admin. This removes
  password sign-in and admin access together.
- **What it is not:** there is no sign-up, forgot-password or
  change-password page. The only way to set a password is the operator
  script above.

## Tests

```bash
yarn test:api   # API-level checks (env reading, Supabase health)
yarn test:e2e   # Browser checks (app shell, redirects)
```

Tests run against the one hosted project, so they run with a single worker
(`workers: 1`) and clean up after themselves.

## Demo data

```bash
yarn demo:seed    # create/refresh 20 demo.NN@example.com participants with Round 1 answers
yarn demo:remove  # delete all demo.NN@example.com participants and their answers
```

`demo:seed` creates `demo.01@example.com` … `demo.20@example.com` (18 fully
submitted, 2 left started-but-not-submitted), with realistic, deterministically
seeded answers across every Round 1 statement. It temporarily adds
`example.com` to `allowed_domains` (required so the `before_user_created`
auth hook accepts the signups) and always removes it again in a `finally`
block, even on error. Reruns are idempotent — existing demo users/responses
are skipped, not duplicated. `demo:remove` deletes only
`demo.NN@example.com` users (and their responses/answers); it never touches
`admin_emails`, `allowed_domains`, real users, or Round 1's content.

## Contributing

The user commits their own work — this repo's GSD workflow does not run
`git add`, `git commit`, or create branches.
