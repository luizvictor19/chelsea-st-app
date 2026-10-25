# Context

What a plan must know before touching anything. Decisions here are settled; changing one is an
architecture question for Luiz.

## The product

- Chelsea St: an English school by Luiz. Two parts: live 45-min lessons with Luiz (one trial class
  given on 02/10/2026; no students yet) and Robin, a voice tutor for daily practice (not built yet).
- Today only Luiz uses the platform, as teacher. Students will sign in later.
- Offer and prices live outside this repository and do not drive code decisions without an issue.

## Environments

- **One environment.** The single Supabase project is production. There is no staging, by
  decision. Every migration, RLS change, function change or data write is a production change.
- Supabase Pro, Postgres 17. Backups, checked against the Supabase docs and the dashboard on
  2026-10-24:
  - Daily physical backups, the last 7 days, taken around 09:15 UTC (the dashboard listed 17 to 23
    October). PITR is off (about US$ 100/month plus Small compute); revisit when students arrive
    (#68).
  - A backup holds the database only. Storage files are not in it (185 objects, 156 MB in
    `vocabulary-images`, measured 2026-10-24): a deleted file never comes back from a restore.
  - Restoring in place overwrites production and takes the project offline. "Restore to a new
    project" copies the database and `auth`, not Storage or keys, and is billed by the hour while
    the new project exists (Micro, about US$ 0.013/hour). Tested on 2026-10-24 with the 23 October
    backup: every row count matched production; the new project was deleted the same day.
  - Before every large migration, Luiz takes a logical copy (`supabase db dump`) and the Storage
    files, and restores the copy on a local stack. Commands in `docs/commands.md`. First rehearsal
    on 2026-10-24: every row count matched production, and the 185 Storage files were copied.
- The platform runs at `app.chelsea-st.com` on Vercel (#68), set up by Luiz:
  - Hobby plan, by Luiz's decision on 2026-10-25. Vercel restricts Hobby to non-commercial use;
    if Vercel pauses the project for that, the way out is Pro or another host.
  - Functions in `gru1` (São Paulo, `vercel.json`), next to the database in `sa-east-1`.
  - Every merge to `main` is a production deploy. A PR with a migration is merged only after
    Luiz's `supabase db push`: the new code may read what only the migration creates.
  - A preview per PR, behind Vercel's login, against the production database (there is no
    staging). Preview variables are only the public Supabase ones and the contact: no service
    role and no paid API key, so a preview sends no invite and spends no credit.
  - Supabase Site URL is `https://app.chelsea-st.com`, so every auth email links there, also one
    asked for from `localhost`. To test one locally, swap the start of the link for
    `http://localhost:3100`: the `token_hash` works on any host.
- Luiz also runs it locally on port 3100 (`npm run dev`).
- The landing page (chelsea-st.com) is a separate folder, not in git, deployed by Luiz with the
  Vercel CLI. Out of scope for this repository.
- DNS on Cloudflare (grey cloud). Email: Cloudflare Email Routing, Resend, Supabase SMTP from
  contato@chelsea-st.com.

## Database rules

- DDL only through a migration in `supabase/migrations`, applied by Luiz with `supabase db push`
  from the worktree that holds the file. The SQL Editor is for reads only.
- Migration numbers: 0023 is reserved for payments; 0024 must never be used; the next free number
  is the lowest one above the highest file on disk. Luiz gives the number in the prompt; a session
  never picks it.
- Every migration appears in `scripts/verify-rls.sql`, or in `LEFT_OUT` of
  `scripts/migrations.test.ts` with the reason, and each new clause is proven by reversion.
- `types.ts` is generated from the migrations with `scripts/gen-types.sh`, never from the live project.
- Schools follow ADR 0004, applied by 0029: every table carries `school_id`; people and operation
  rows belong to one school, content rows are common (`school_id` null) or one school's. Roles live
  in `school_members` (`admin`, `teacher`, `student`, one row each) and `platform_admins`; there is
  no `profiles.role` and no `is_teacher()`. Policies call `is_platform_admin()` and
  `is_school_member()`. A new table names its school, and the `school_follows_parents` trigger
  fills it from the parent and refuses a parent of another school.
- Joining a school follows 0031 and 0032: a membership is born only from a row of
  `school_invites`, when the invited email is first confirmed (a trigger on `auth.users`) or, for
  an account that already exists, when that person accepts it signed in
  (`accept_my_school_invite`, offered by `my_open_school_invites` on `/teacher` and `/dashboard`).
  Writing an invite never makes a membership, and the inviter reads the same "Convite enviado"
  whether or not the email has an account (a mail that failed is still said as failed). Never insert into `school_members` or `students` from the app. A school's admin invites
  any role, its teacher students only; a student belongs to one school, checked on acceptance.
  No account is created without an invite (#109): the magic link asks with
  `shouldCreateUser: false`, and "Allow new users to sign up" is off in the Auth dashboard.
  With sign-ups off, GoTrue refuses the magic link to an invite not yet accepted (an unconfirmed
  account goes through Signup), so the login action sends that one the recovery link, which
  confirms the email and accepts the invite.

## Sensitive data and secrets

- `.env.local` is never read, printed or committed. Worktrees get a copy with `cp`.
- API keys are server-only, never `NEXT_PUBLIC_`.
- `SUPABASE_SERVICE_ROLE_KEY` is read only by `src/lib/supabase/admin.ts`, to send invite emails
  (#96). It passes every policy: never use it to read or write tables.
- Student personal data (name, email, audio) is processed under the privacy terms published on the
  landing. Never log it, never paste it into an issue.

## Content state

- Book 1 is fully ingested (points 1 to 52). Book 2 is extracted but not re-ingested (points 53 to 128).
- Book 1 lesson images (measured 08/10/2026): lessons 1 to 3 complete (37, 11 and 21 words);
  lesson 4 has 5 words that need an image and none approved; lessons 5 to 9 have 124 words whose
  type (representation) is not decided yet, so it is not known how many will need images.
- Questions are written by hand on /teacher/content/questions; suggestion is planned, not built.

## Known traps

- Specs live only in `docs/` (`spec-ingestao.md`, `spec-imagens.md`, `spec-f1.md`). The Cowork
  project keeps no copy; a version found anywhere else is stale.
- `gh pr edit` fails in this repository. Change a PR base with
  `gh api -X PATCH repos/luizvictor19/chelsea-st-app/pulls/N -f base=main`.
- A dev server started by a Claude Code session dies with the session. The lesson server always
  runs in Luiz's own terminal.
- Claude Code sessions have no browser: screens are tested by Luiz, and the PR must say so.
