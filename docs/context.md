# Context

What a plan must know before touching anything. Decisions here are settled; changing one is an
architecture question for Luiz.

## The product

- One company, two lines, on one app and one database (ADR 0005, ADR 0006 of 12/11/2026):
  - GrifoAI is the company. Its B2B line sells AI automation to companies; their employees practise
    English with the tutor (Grifo) only, with no teacher and no teacher tools, under the GrifoAI
    brand (griffin mascot), billed on the automation contract.
  - "Chelsea St by GrifoAI" is the B2C line, sold to people: Robin, a voice tutor for daily practice
    (not built yet), and lessons with a teacher booked and paid with credits (one trial class given
    on 02/10/2026; no students yet).
  - The teaching material belongs to GrifoAI and serves both lines.
- Three levels of practice on one engine (ADR 0006): the trail (Robin v1, minutes per day, no
  credit), live voice (a voice question inside the trail, free conversation) and video (the same
  engine with an avatar). The plan opens the doors, credits pay for what goes through them; a
  question by chat spends none. Chelsea St pays through Asaas (#72). Robin always leads the trail:
  the reviewer mode of 07/11 is withdrawn.
- English schools are not customers. Each tenant is an organization: Chelsea St, or one company.
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
  - Supabase Site URL is `https://app.chelsea-st.com`. Since #196 an auth email (login,
    "Esqueci minha senha", invite) links to the origin of the site of the request, from the
    allowlist below. The templates take `{{ .RedirectTo }}` only when it is one of their listed
    origins, whole, and the Site URL otherwise (`docs/commands.md`): a host outside the list, an
    origin missing from the Redirect URLs or a redirect with a path gets a working link on the
    Chelsea domain. Since #195 an invite follows the brand of the organization invited, not the
    inviter's host: the site of that brand in the allowlist, `https` only, so a GrifoAI invite
    gets the Site URL until the GrifoAI domain exists (#193). The `token_hash` works on any host,
    so a link's start can still be swapped by hand.
- The brand of a request comes from its Host, by an allowlist in `src/lib/brand.ts` (#194), read
  through `currentSite()` (`src/lib/current-site.ts`):
  - `app.chelsea-st.com` is Chelsea St, on `https://app.chelsea-st.com`.
  - The host in `GRIFOAI_HOST` is GrifoAI, on `https://` (`http://` for a `.localhost` host). The
    variable is empty in production until the domain exists (#193).
  - Off Vercel only (`VERCEL` unset), `localhost` and `127.0.0.1` on any port are Chelsea St, on
    `http://` and the request's port.
  - Any other host (a preview, the `.vercel.app` alias of production, anything else) gets the
    neutral brand: no brand name on the screen, the page's name alone as the title, no description,
    no icon, `noindex, nofollow`, no canonical. Never Chelsea St.
  - Compared whole and lower-cased, port included: `app.chelsea-st.com:443` is unknown. A site's
    origin comes from the list, never from the Host text.
  - "Chelsea St" is written only in `src/lib/brand.ts` (a test in `brand.test.ts` holds it there).
    Icons live in `public/brand/<brand>/`, not in `src/app/`: the icon file convention would
    override the brand.
  - What a brand looks like (name, description, icons, contact, mascot, host) stays in
    `src/lib/brand.ts`, reviewed in a PR; its colours are `:root[data-brand]` in `globals.css`,
    set on `<html>` from the Host. Only the accent changes between brands: the ground stays, the
    mascot art is painted on it. The database says only which brand an organization wears
    (`organizations.brand`, 0041, #195).
  - The Host decides what a screen looks like, before and after sign-in. The organization decides
    where a person goes: at the front door (`/`), someone signed in whose organizations all wear
    the other brand is sent to that brand's site (`homeSite`, `src/lib/brand-home.ts`), and signs
    in there again (the session is per domain). A platform admin, someone with no organization,
    a host outside the list, and a brand with no site of the same scheme (no GrifoAI domain yet,
    or a dev server) stay.
  - The GrifoAI mascot is Robin's art until the griffin files arrive in `public/grifo/`;
    `mascot-files.test.ts` holds every file the tutor shows to exist, for every brand.
- Luiz also runs it locally on port 3100 (`npm run dev`).
- The landing page (chelsea-st.com) is the repository `luizvictor19/chelsea-st-site` (local clone
  `~/Projects/chelsea-st`), deployed by Luiz. Its form writes leads into this project's database
  (see Database rules); everything else on it is out of scope for this repository.
- DNS on Cloudflare (grey cloud). Email: Cloudflare Email Routing, Resend, Supabase SMTP from
  contato@chelsea-st.com.

## Database rules

- DDL only through a migration in `supabase/migrations`, applied by Luiz with `supabase db push`
  from the worktree that holds the file. The SQL Editor is for reads only.
- Migration numbers: 0023 and 0024 stay unused (0023 was reserved for payments until ADR 0006); the next free number
  is the lowest one above the highest file on disk. Luiz gives the number in the prompt; a session
  never picks it.
- Every migration appears in `scripts/verify-rls.sql`, or in `LEFT_OUT` of
  `scripts/migrations.test.ts` with the reason, and each new clause is proven by reversion.
- `types.ts` is generated from the migrations with `scripts/gen-types.sh`, never from the live project.
- No relation of `public` gives `truncate`, `references`, `trigger` or `maintain` to `anon`,
  `authenticated` or `service_role`, and the `postgres` default ACL in `public` gives none of them
  to a new table (0037; RLS filters none of the four). `scripts/verify-rls.sql` replays
  production's default ACL from before 0001 and checks this in its last block, for every table.
  The `supabase_admin` default in `public` is Supabase's and still gives every privilege; on
  2026-11-04 no relation of `public` was owned by it.
- Every function of `public` says who executes it (0047, #148). Since 0047 a function `postgres`
  creates in `public` is born executable by its owner alone (the global default of `postgres`: a
  default per schema cannot narrow what the global one gives PUBLIC). Not in `storage`, whose own
  default adds `anon`, `authenticated` and `service_role`; and an extension created or updated
  later may give its new functions to `postgres` alone, so check their `execute` after the push.
  If Supabase creates `rls_auto_enable` again (as `supabase_admin`, whose default in `public`
  grants `anon`), it comes back open; only a query on the project shows it. The migration that
  creates a function grants `execute` to who calls it: `authenticated` for what policies, checks and the
  app call; `anon` only for the site's door (`submit_lead`). A trigger function, and
  `rls_auto_enable` behind the event trigger `ensure_rls`, is executable by nobody: execute is
  checked when a trigger is created, not when it fires. `service_role` gets none (it bypasses
  RLS). A forgotten grant shows as "permission denied for function" on the screen, never as an
  open door. `scripts/verify-rls.sql` holds it: no function of `public` executable by PUBLIC, no
  `security definer` executable by `anon` but `submit_lead`. The image bucket's write policy is
  `to authenticated`, so `anon` reading the bucket never reaches `is_platform_admin()`.
- Billing follows 0049 (#72, `docs/spec-pagamento.md`): `plans` (the catalog, every number of the
  offer, written by the platform admin on `/teacher/plans`; active plans read by `anon` too),
  `billing_customers`, `subscriptions`, `payments`, `billing_events` and `overdue_steps`. A person
  reads her own rows, the platform admin all; nobody writes them but ten `security definer`
  functions that only `service_role` executes, the one exception to "service_role gets none" above.
  Billing reaches a student of a `chelsea-st` organization only, never a company. One CPF per person,
  one person per CPF (an HMAC), one trial per person, one subscription alive per person. The state
  of a subscription is always read back from Asaas, never taken from a webhook's body.
- `leads` receives rows only through `submit_lead` (0038), executed by `anon` alone: the site's
  function calls it with the publishable key. Nobody reads `leads` through the API, and the
  service role holds nothing on it. A number sent twice is two rows (history, nothing is
  overwritten); the latest send of each number is the view `leads_latest`, with no privilege for
  any API role. The number is stored with the 55 (`leads_whatsapp_br`).
- A time zone is one both Postgres and the screen read (0048, #219): `profiles.timezone` and
  `lesson_schedules.timezone` take only a name in `pg_timezone_names` that is not `posix/` and not
  `Factory`. A trigger on each, `before insert or update of timezone` (`profiles_timezone_known`,
  `lesson_schedules_timezone_known`), calls `is_known_time_zone` (executed by `authenticated`) and
  refuses with 23514 under its own name. A trigger and not a check: a name the server's tzdata drops
  later keeps its rows, the other columns of such a row still change, only writing the zone again
  is refused, and a restore (`session_replication_role = replica`) skips it.
- Every organization wears a brand since 0041: `organizations.brand`, `chelsea-st` or `grifoai`
  (`organizations_brand_known`), with no default, so a new organization names it. Only the
  platform admin changes it (`organizations_write`); a member reads her own organization's. The
  list equals `BRAND_KEYS` in `src/lib/brand.ts` (`brand-keys.test.ts`): a new brand is a
  migration and a code change together. 0041 also created GrifoAI's own organization
  (`slug = 'grifoai'`). The platform admin creates a company's organization (`grifoai`, no
  teacher) and invites its first admin at `/teacher/organizations` (#205), with her own client
  under `organizations_write`: two writes, no function, so a refused invite leaves the
  organization without an admin, shown there as "Sem admin" and fixed on `/teacher/invites`.
- Organizations follow ADR 0004, applied by 0029: every table carries `organization_id`; people
  and operation rows belong to one organization, content rows are common (`organization_id` null)
  or one organization's. Since 0043 (#211) every content row is common: each of the 10 content
  tables refuses `organization_id` by its own check (`<table>_is_common`), the column stays, always
  null, and only the platform admin writes content (`can_write_content` is `is_platform_admin()`,
  so are the 10 content `_write` policies and the image bucket's). Roles live in `organization_members` (`admin`, `teacher`, `student`, one
  row each) and `platform_admins`; there is no `profiles.role` and no `is_teacher()`. Policies call
  `is_platform_admin()` and `is_organization_member()`. A new table names its organization, and the
  `organization_follows_parents` trigger fills it, on insert, from the first parent present in its
  list and refuses a parent of another organization (first present since 0030: an image attempt's
  parent is a word or a scene). Until 0039 every one of these names said `school` (`schools`,
  `school_id`, `school_role`, `is_school_member`...); 0040 renamed them all, with parameters and
  refusal messages, and the older migrations keep the names of their time.
- An organization says whether it has a teacher since 0042 (#197): `organizations.has_teacher`, with
  no default, written by the platform admin only. Chelsea St has one; GrifoAI's organization and
  every company on GrifoAI have none. "Admin can do everything a teacher can" (ADR 0004) holds only
  where there is a teacher: `teaches_in(organization)` (a teacher, or an admin where `has_teacher`)
  is what the 34 policies of a teacher's power, `teaches_anywhere` and `materialize_lessons`
  ask (0043 then gave the 10 content writes among the 34 to the platform admin alone). Where there is no teacher, the admin
  invites (employees and admins), reads the invites, the members and their names, and nothing
  else; nobody is a teacher there (triggers on members and invites), and an organization with a
  teacher member or an open teacher invite cannot turn into one without. On screen the company
  admin lands on `/team`, the employee (`student`) on `/dashboard`, which shows only the practice
  with Robin.
- The admin of an organization sees her team's practice only through `team_practice` (0044, #198),
  a `security definer` function that refuses (42501) anyone but an admin of that organization or
  the platform admin, and `anon` holds no `execute` on it. Per person who has a row in `students`
  it returns the last day practised, the days practised in each of the last 1 to 12 weeks (Monday
  to Sunday, in `profiles.timezone`, São Paulo when that is not a zone, which since 0048 only a
  name the tzdata dropped can be) and the minutes practised in the month; never what was said.
  The days come from `attempts` and the minutes are 0 until Robin v1 (#71) records sessions with a
  start and an end; #71 rewrites the body and keeps the signature. The policies of `attempts` and
  `review_schedule` did not change. The daily cap (15 min, both brands) lives in
  `src/lib/tutor/daily-cap.ts`; `/team` shows the month's minutes against the cap times the days of
  the month so far, and the employee's card says the company sees the days and the time.
- What a question shows follows 0030: the picture of one word (`shown_vocabulary_item_id`), one
  scene (`scene_id`), or acted out (`is_acted_out`), at most one of the three, checked by
  `questions_one_image`; none of them means not decided yet. An image attempt belongs to exactly
  one word or one scene (`image_attempts_one_owner`). Publishing needs a word or a scene with an
  approved picture, or acted out: checked on the screen and in `addQuestion`/`saveQuestion`
  (`publishRefusal`, #180), not in the database.
- Where a student stopped follows 0035: one point per lesson, `lessons.stopped_at_point_id`,
  written by "Parei aqui" on the live lesson screen. The points of a lesson are the ones between
  the previous lesson's mark and its own; they are not stored. A marked point cannot be deleted
  (`on delete restrict`), and `materialize_points` names this refusal before deleting (0039). A
  mark names a common point or one of the lesson's organization (`lessons_stop_in_organization`,
  a trigger).
- Joining an organization follows 0031 and 0032: a membership is born only from a row of
  `organization_invites`, when the invited email is first confirmed (a trigger on `auth.users`) or,
  for an account that already exists, when that person accepts it signed in
  (`accept_my_organization_invite`, offered by `my_open_organization_invites` on `/teacher` and
  `/dashboard`). Since 0046 (#213) `my_open_organization_invites` also gives the organization's
  `has_teacher`, because the invited person is not a member yet and cannot read `organizations`:
  the screen names the role with it (`invitedAs`, `roleLabel`).
  Writing an invite never makes a membership, and the inviter reads the same "Convite enviado"
  whether or not the email has an account (a mail that failed is still said as failed). Never insert into `organization_members` or `students` from the app. An organization's admin
  invites any role, its teacher students only; a student belongs to one organization, checked on
  acceptance.
  No account is created without an invite (#109): the magic link asks with
  `shouldCreateUser: false`, and "Allow new users to sign up" is off in the Auth dashboard.
  With sign-ups off, GoTrue refuses the magic link to an invite not yet accepted (an unconfirmed
  account goes through Signup), so the login action sends that one the recovery link, which
  confirms the email and accepts the invite.

## Sensitive data and secrets

- `.env.local` is never read, printed or committed. Worktrees get a copy with `cp`.
- API keys are server-only, never `NEXT_PUBLIC_`.
- `SUPABASE_SERVICE_ROLE_KEY` is read by `src/lib/supabase/admin.ts`, to send invite emails (#96),
  and by `src/lib/billing/supabase-store.ts` (#72, Q2), which calls only the ten `billing_*`
  functions of 0049 and reads a person's e-mail from auth for the overdue e-mails. It passes every
  policy: never use it to read or write a table directly; it holds no privilege on the billing
  tables, only `execute` on their functions.
- Asaas (#72, `docs/spec-pagamento.md`): `ASAAS_API_KEY` (the address follows its prefix; written
  `\$aact_...` in `.env.local`, or Next reads it empty; the app runs the sandbox key only against a
  local Supabase, never the production one `.env.local` points at, and never in Vercel
  Production), `ASAAS_WEBHOOK_TOKEN`, `BILLING_CPF_KEY` (the HMAC of a CPF; the digits stay at
  Asaas), `RESEND_API_KEY` (the billing e-mails, a key of its own) and `CRON_SECRET` (the daily
  routine). Production has no Asaas key until the CNPJ's account exists.
- Supabase API keys are the new kind only (#149). The variable names stayed, the formats changed:
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` holds a publishable key (`sb_publishable_`, the one named
  `default`) and `SUPABASE_SERVICE_ROLE_KEY` holds a secret key (`sb_secret_`). The app's Vercel
  Production uses the secret named `vercel_app`; `.env.local` and the Supabase CLI use the secret
  named `default`, so each one rotates without touching the other.
- Since 2026-11-04 the legacy JWT keys (`anon`, `service_role`) are disabled and the legacy HS256
  JWT secret is revoked. A key starting with `eyJ` is refused with 401, as `apikey` and as
  `Authorization: Bearer`. User sessions are signed with an asymmetric key (ES256).
- In a hand-written call (curl, a script), the new key goes only in the `apikey` header, never in
  `Authorization: Bearer`. The secret key is refused (401) when the User-Agent is a browser's: it
  runs on a server only.
- `ANTHROPIC_API_KEY` is read by the app since #187 (the scene's "Sugerir instrução"), for all four
  content suggestions since #225 (also the word's instruction, "Sugerir tipos" and "Sugerir
  conjuntos"), and by the measurement scripts. The app reads no `DEEPSEEK_API_KEY` since #225
  (`no-deepseek.test.ts`). Two Console keys: `chelsea-vercel` in Vercel Production only, as a Secret,
  and `chelsea-local` in `.env.local`, so each one rotates without touching the other.
- The site (`luizvictor19/chelsea-st-site`) holds only the publishable key
  (`SUPABASE_PUBLISHABLE_KEY`), never the service role (#146). Its Vercel project has only
  `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` among the Supabase variables.
- Student personal data (name, email, audio) is processed under the privacy terms published on the
  landing. Never log it, never paste it into an issue.

## Test accounts

The phone screen test (the `phone-drive` skill, outside this repository) logs in with accounts
that are aliases of Luiz's e-mail. Their e-mails and passwords live only in
`~/.config/chelsea-test/credentials` (mode 600, never committed), one `<KEY>_EMAIL` and one
`<KEY>_PASSWORD` per account, and `wd.py login <key>` picks one by its key.

| Key       | Account                                                    | Can                                                                           |
| --------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `TEACHER` | teacher of the Chelsea St organization, not platform admin | the teacher's screens; not the content screens, which redirect to `/teacher`  |
| `STUDENT` | student of Chelsea St                                      | the student's screens; any write a test makes there goes only to this student |
| `ADMIN`   | platform admin, in no organization (#237)                  | the content screens, and every organization's people                          |

- **The test admin isolates nothing.** There is one database, production, so what it writes is
  real common content, as Luiz's own account would. A test says what it will write before, checks
  it through the MCP after, and leaves it unpublished for Luiz to keep or delete.
- It sees the people of every organization: use it on the content screens only, and never copy a
  student's name into an issue, a PR or a report.
- It was made by Luiz in the Supabase dashboard (Authentication, then a row in `platform_admins`
  from the SQL Editor), as 0029 allows, and not by a migration: it is one production account, and
  its e-mail or id does not belong in this public repository. Taking it back is deleting that row.
- The accounts of the Empresa Teste (an organization without a teacher: its admin and an employee)
  come with #213.

## Content state

- Book 1 is fully ingested (points 1 to 52). Book 2 is extracted but not re-ingested (points 53 to 128).
- Book 1 lesson images (measured 08/10/2026): lessons 1 to 3 complete (37, 11 and 21 words);
  lesson 4 has 5 words that need an image and none approved; lessons 5 to 9 have 124 words whose
  type (representation) is not decided yet, so it is not known how many will need images.
- Questions are written by hand by the platform admin on /teacher/content/questions (the only
  one who sees the content screens since #211); suggestion is planned, not built.

## Known traps

- Specs live only in `docs/` (`spec-ingestao.md`, `spec-imagens.md`, `spec-f1.md`,
  `spec-pagamento.md`). The Cowork
  project keeps no copy; a version found anywhere else is stale.
- `gh pr edit` fails in this repository. Change a PR base with
  `gh api -X PATCH repos/luizvictor19/chelsea-st-app/pulls/N -f base=main`.
- A dev server started by a Claude Code session dies with the session. The lesson server always
  runs in Luiz's own terminal.
- Claude Code sessions have no browser: screens are tested by Luiz, and the PR must say so.
