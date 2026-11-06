# Useful commands

Run from the main folder `~/Projects/chelsea-st-app` unless a step says otherwise.

## Start work on issue NN

    git pull
    git worktree add ../chelsea-st-app-NN -b feat/NN-scope
    cp -r supabase/.temp ../chelsea-st-app-NN/supabase/
    cp .env.local ../chelsea-st-app-NN/
    cd ../chelsea-st-app-NN && npm install && claude

Open Claude Code inside the worktree: the no-commit-on-main hook reads the session folder.

## Dev servers

    npm run dev                    # main folder, port 3100 (the script fixes the port)
    npx next dev -p 3110           # a worktree, on another port
    fuser -k 3110/tcp              # free a port

The brand follows the Host (#194). `localhost` and `127.0.0.1` are Chelsea St. To see GrifoAI,
start with `GRIFOAI_HOST=grifoai.localhost:3100 npm run dev` and open
`http://grifoai.localhost:3100` (no setup: `next dev` accepts subdomains of `localhost`). Any other
Host shows the neutral brand:

    curl -s -H "Host: qualquer.example" http://127.0.0.1:3100/login | grep -o '<title>[^<]*</title>'

The lesson server always runs in Luiz's own terminal, never in a Claude Code session.

## Gate (the CI steps, minus verify-rls.sql, which only CI runs)

    npm run check                  # format:check, lint, typecheck, test, build; stops at the first failure
    npm run test:coverage          # what CI runs instead of npm test: coverage per file and in total, fails below the floor; counts only the files a test loads

## Merge PR NN and clean up (session in the main folder, not in the worktree)

    gh pr merge NN --merge
    git pull
    git worktree remove ../chelsea-st-app-NN
    git branch -d feat/NN-scope
    git push origin --delete feat/NN-scope

## Migrations (Luiz only)

    supabase db push               # from the worktree that holds the new file
    scripts/gen-types.sh           # regenerate types from the migrations

Every merge to `main` deploys to production (#68). In a PR with a migration, push first, then
merge: the new code may read what only the migration creates.

## Vercel (Luiz only, set up once in #68)

Hobby plan. Project imported from `luizvictor19/chelsea-st-app`, framework Next.js, Node 24
(`engines` in `package.json`). Functions in `gru1` (`vercel.json`).

Settings > Environment Variables, by name only (values live in Vercel and in `.env.local`):

    Production   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
                 NEXT_PUBLIC_SITE_URL=https://app.chelsea-st.com,
                 NEXT_PUBLIC_TEACHER_CONTACT_EMAIL=contato@chelsea-st.com,
                 SUPABASE_SERVICE_ROLE_KEY, FREEPIK_API_KEY, DEEPSEEK_API_KEY,
                 ANTHROPIC_API_KEY
    Preview      NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
                 NEXT_PUBLIC_TEACHER_CONTACT_EMAIL

`GRIFOAI_HOST` (the GrifoAI domain, server only) enters Production only after #193, when the
domain exists; until then it stays unset and nothing changes. A preview has no allowlisted host, so
it always shows the neutral brand.

`OPENAI_API_KEY` and `DEEPGRAM_API_KEY` are read only by the measurement scripts, never by the
app: they stay out of Vercel.

`ANTHROPIC_API_KEY` is read by the app (the scene panel's "Sugerir instrução", #187) and by the
scripts. Two keys in the Claude Console, in the mould of the Supabase ones: `chelsea-vercel` in
Vercel, type Secret, Production only (a preview spends no credit, and its button says the
suggestion is not set up there); `chelsea-local` in `.env.local`. Each rotates without touching
the other.

Supabase key formats (#149; the names stayed from the legacy keys, the values did not):

    NEXT_PUBLIC_SUPABASE_ANON_KEY   publishable key, sb_publishable_ (named default).
                                    Type Config, not Secret: it is public, and a Secret
                                    variable cannot change type (recreate it instead).
    SUPABASE_SERVICE_ROLE_KEY       secret key, sb_secret_, the one named vercel_app.
                                    Type Secret, Production only.

`.env.local` holds the same publishable key and the secret named `default`. A legacy key
(`eyJ...`) is refused with 401: the legacy keys are disabled and the legacy JWT secret is revoked
since 2026-11-04. A new variable value takes effect only on a new deploy: redeploy the environment.

The site's Vercel project (`chelsea-st`) holds only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`
among the Supabase variables, in Production, Preview and Development.

Settings > Deployment Protection: Vercel Authentication on for previews (the default).

Settings > Domains: `app.chelsea-st.com`. On Cloudflare, the CNAME record Vercel shows, grey
cloud (DNS only).

Supabase, Authentication > URL Configuration:

    Site URL        https://app.chelsea-st.com
    Redirect URLs   https://app.chelsea-st.com/**
                    https://*-<vercel-account>.vercel.app/**   (previews)
                    http://localhost:3100/**

## Backup and local restore (Luiz only)

The copy holds personal data (`auth.users`). It lives in `~/backups/chelsea-st/`, outside the
repository and outside any synced folder, and never goes into an issue, a PR or a chat.

Take the copy, from the main folder (it reads the linked project through the CLI login; no
database password was asked on 2026-10-24). The Supabase CLI is a global npm package, so it is
installed once per Node version (`nvm use`, then `npm i -g supabase`):

    B=~/backups/chelsea-st/$(date +%F)
    mkdir -p "$B"
    supabase db dump --linked --role-only -f "$B/roles.sql"
    supabase db dump --linked -f "$B/schema.sql"
    supabase db dump --linked --data-only --use-copy -f "$B/data.sql"
    supabase storage cp -r ss:///vocabulary-images "$B/vocabulary-images" --linked --experimental

Restore it on a local stack that has none of the repository's migrations (they seed rows, and the
copy already holds them). Two lines of the copy are refused locally and are filtered out first,
both found in the 2026-10-24 rehearsal: a grant on `log_min_messages` to the Realtime role, and
the `storage.buckets_vectors` and `storage.vector_indexes` tables (empty in production). The
restore runs in one transaction, so any other error leaves the local database empty.

    S=~/backups/chelsea-st/stack
    supabase init --workdir "$S"   # once
    supabase start --workdir "$S"
    grep -v 'GRANT SET ON PARAMETER' "$B/roles.sql" > "$B/roles-local.sql"
    sed -e '/^COPY "storage"\."buckets_vectors"/,/^\\\.$/d' \
      -e '/^COPY "storage"\."vector_indexes"/,/^\\\.$/d' "$B/data.sql" > "$B/data-local.sql"
    psql --single-transaction --variable ON_ERROR_STOP=1 \
      --file "$B/roles-local.sql" --file "$B/schema.sql" \
      --command 'SET session_replication_role = replica' \
      --file "$B/data-local.sql" \
      --dbname postgresql://postgres:postgres@127.0.0.1:54322/postgres

Compare: run `scripts/row-counts.sql` on the copy and ask Claude to run it on production through
the MCP. Every line must match.

    psql -P pager=off postgresql://postgres:postgres@127.0.0.1:54322/postgres --file scripts/row-counts.sql

Rehearse a migration on the copy (first for 0040, #199), from the worktree that holds it. Three
read-only outputs, before and after: the row counts, the catalog of `public` and the policies of
`storage` (`scripts/catalog-fingerprint.sql`), and how many rows each account sees in each table
(`scripts/rls-visibility.sql`, local copy only: accounts by number, no email). Ask Claude to run
the first two on production through the MCP and compare them with the copy before the migration:
equal means the copy is production. A migration that changes behaviour states, in its plan, the
expected difference; one that only renames, like 0040, expects none after its map.

    B=~/backups/chelsea-st/YYYY-MM-DD    # the folder of the copy restored above
    DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres
    for f in row-counts catalog-fingerprint rls-visibility; do
      psql -X -q -At -v ON_ERROR_STOP=1 -f scripts/$f.sql "$DB" > "$B/$f.before"
    done
    psql -X -q --single-transaction -v ON_ERROR_STOP=1 \
      -f supabase/migrations/NNNN_name.sql "$DB"
    for f in row-counts catalog-fingerprint rls-visibility; do
      psql -X -q -At -v ON_ERROR_STOP=1 -f scripts/$f.sql "$DB" > "$B/$f.after"
    done

The three outputs carry no personal data. Then:

    supabase stop --workdir "$S" --no-backup   # deletes the local copy

## Auth settings and email templates (Luiz only, in the Supabase dashboard)

Every email link carries a `token_hash` that `/auth/callback` verifies on the server. The link
then works on any device and in any browser, because it does not depend on the PKCE cookie of
the browser where it was requested (#96, #102).

Authentication > URL Configuration:

    Site URL        http://localhost:3100   (https://app.chelsea-st.com after #68)
    Redirect URLs   http://localhost:3100/**

Authentication > Sign In / Providers: "Allow new users to sign up" off (#109). Nobody gets an
account without an invite; `inviteUserByEmail` is an admin call and still works.

Authentication > Providers > Email: minimum password length 8, and Email OTP Expiration 86400
seconds (24 hours, the most Supabase allows). The invite stays open 15 days in `organization_invites`,
but its email link lasts only this long; after that, "Reenviar" or "Esqueci minha senha" with
the same email.

Authentication > Emails. Each template's link is exactly this (`/set-password` since #116; an email
sent before still says `/definir-senha`, which redirects there, see `src/lib/renamed-paths.ts`):

    Confirm signup   {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email
    Magic link       {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email
    Invite user      {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/set-password
    Reset password   {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/set-password

Every template is in Portuguese, like every string a teacher or student reads. Subject and body
of each, as set in the dashboard on 2026-10-25:

    Subject: Confirme o seu e-mail na Chelsea St

    <h2>Confirme o seu e-mail</h2>
    <p>Clique no link abaixo para confirmar este e-mail e entrar na Chelsea St.</p>
    <p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">Confirmar e-mail</a></p>
    <p>Se não foi você, ignore esta mensagem.</p>

    Subject: Seu convite para a Chelsea St

    <h2>Você foi convidada para a Chelsea St</h2>
    <p>Clique no link abaixo para escolher a sua senha e entrar.</p>
    <p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/set-password">Aceitar o convite</a></p>
    <p>O link vale por 24 horas. Se ele vencer, peça um novo em "Esqueci minha senha", na tela de entrar, com este e-mail.</p>

    Subject: Seu link para entrar na Chelsea St

    <h2>Entrar na Chelsea St</h2>
    <p>Clique no link abaixo para entrar. Ele vale uma vez só.</p>
    <p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">Entrar</a></p>
    <p>Se não foi você que pediu, ignore esta mensagem.</p>

    Subject: Nova senha na Chelsea St

    <h2>Escolher uma nova senha</h2>
    <p>Clique no link abaixo para escolher uma nova senha.</p>
    <p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/set-password">Escolher nova senha</a></p>
    <p>O link vale por 24 horas. Se não foi você que pediu, ignore esta mensagem: a sua senha continua a mesma.</p>

## GitHub quirks

    gh api -X PATCH repos/luizvictor19/chelsea-st-app/pulls/NN -f base=main     # change PR base
    gh api -X PATCH repos/luizvictor19/chelsea-st-app/pulls/NN -F body=@body.md # replace PR body
    gh issue list --state open                                                  # open issues

`gh pr edit` fails in this repository; use the calls above.

## Dependabot PRs

`.github/dependabot.yml` (#137) opens them every Monday at 06:00 (São Paulo), for npm and GitHub
Actions, with the `chore` label and commits `chore(deps): ...` or `chore(deps-dev): ...`. A
Dependabot PR needs no issue of its own: the PR is its record.

    gh pr list --author app/dependabot     # the queue

- The gate is the same: CI green. The merge is Luiz's, with the same `gh pr merge NN --merge`,
  and it is a production deploy like any other merge. No auto-merge.
- The grouped PR (`minor-and-patch`, and `actions`) can go straight in when CI passes.
- A major comes alone in its own PR and is read before the merge: the package's changelog, and
  for `next` (grouped with `eslint-config-next`) the upgrade guide in `node_modules/next/dist/docs/`.
- A security PR (group `security`) goes ahead of the queue.
- A Dependabot PR behind `main`: comment `@dependabot rebase` on the PR. Dependabot rewrites its
  own branch; no session rebases it.
- A branch left behind after the merge: `git push origin --delete <branch>`.

Repository settings (Luiz only, once, after #137 is merged), Settings > Advanced Security:

1. Dependency graph: on (the alerts depend on it).
2. Dependabot alerts: Enable.
3. Dependabot security updates: Enable.

Security updates go on only after `dependabot.yml` is on `main`, so the first security PR already
carries the `chore` label, the `chore(deps-dev)` prefix and the grouping. Version updates have no
switch: they start when the file reaches `main`. Each run shows in Insights > Dependency graph >
Dependabot. Steps 2 and 3 from the command line, with Luiz's token:

    gh api -X PUT repos/luizvictor19/chelsea-st-app/vulnerability-alerts
    gh api -X PUT repos/luizvictor19/chelsea-st-app/automated-security-fixes

## Labels

Type:

- `feat`: new behaviour.
- `fix`: a defect; the fix starts with a failing test.
- `chore`: maintenance, no change in behaviour.
- `docs`: documentation only.
- `ops`: deploy, backup, production operation.

Area:

- `infra`: repository and environment configuration.
- `ingestion`: book extraction and ingestion.
- `images`: the images screen and image generation.
- `lesson`: the live lesson screen.
- `questions`: questions and question suggestion.
- `payments`: payment through Appmax.
- `tutor`: Robin, the voice tutor.

State:

- `epic`: a parent issue with sub-issues.
- `needs-decision`: a question for Luiz before the plan.
- `blocked`: waiting for something outside the repository.

The other labels are GitHub's defaults and are not used.

## Phone testing (Android)

    adb reverse tcp:3100 tcp:3100  # after every cable connection

Open http://127.0.0.1:3100, not localhost. An email link opened there, with its start swapped
for `http://127.0.0.1:3100`, signs in and stays on that host (#102). Signing out still lands on
`localhost:3100/login` (the sign-out route builds its redirect on the server's host): go back to
127.0.0.1 before signing in again.

## Supabase CLI

    npm i -g supabase              # global npm packages are per Node version

The CLI fetches the project's API keys through the management API and keeps none. The database
password is not kept in `.env.local`: when a command needs it, the CLI asks.
