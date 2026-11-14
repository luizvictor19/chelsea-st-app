# Useful commands

Run from the main folder `~/Projects/chelsea-st-app` unless a step says otherwise.

## Start work on issue NN

    git pull
    git worktree add ../chelsea-st-app-NN -b feat/NN-scope
    cp -r supabase/.temp ../chelsea-st-app-NN/supabase/
    cp .env.local ../chelsea-st-app-NN/
    cd ../chelsea-st-app-NN && npm install && claude

Open Claude Code inside the worktree: the guard-main hook reads the session folder.

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

The Claude merges when every condition of Merging in `AGENTS.md` holds; if one is missing, it
stops and says which.

    gh pr checks NN --watch --fail-fast
    gh pr merge NN --merge
    git pull
    gh release create "$(date -u +%Y.%m.%d)-NN" \
      --target "$(gh pr view NN --json mergeCommit --jq .mergeCommit.oid)" --generate-notes
    git worktree remove ../chelsea-st-app-NN
    git branch -d feat/NN-scope
    gh api -X DELETE repos/luizvictor19/chelsea-st-app/git/refs/heads/feat/NN-scope

The remote branch is deleted through the API: the hook in `.claude/settings.json` refuses every
push made from `main`, including one that only deletes a branch (#262).

One GitHub release per merge (#140): the tag is the UTC date of the merge and the PR number
(`2026.11.07-245`), it points at that PR's merge commit, and its notes are the PR titles GitHub
lists since the previous release. Nothing is committed for it, so parallel branches never
conflict over a changelog. A Dependabot merge gets its release too. The release is the Claude's
step, right after each merge: `gh release create` is allowed in Luiz's own permissions since
07/11/2026. The history of what reached production is `gh release list`. `package.json` stays at
`0.1.0`: its `version` is not used.

## Migrations

The Claude applies the migration of issue NN right before its merge, after code-review and a green
`verify-rls.sql` in CI, and tells Luiz. It runs from the issue's worktree, which holds the new file:
the hook denies `supabase db push` from the main folder. NNNN is the migration's number.

    cd ../chelsea-st-app-NN
    supabase link --project-ref gmgkoriwsmlrtwdqdsuo    # once per worktree
    B=~/backups/chelsea-st/$(date +%F)-NNNN
    mkdir -p "$B"
    git fetch -q && git rev-parse origin/main > "$B/commit"   # what production runs before the push
    supabase db dump --linked --role-only -f "$B/roles.sql"
    supabase db dump --linked -f "$B/schema.sql"
    supabase db dump --linked --data-only --use-copy -f "$B/data.sql"
    supabase db push --dry-run     # must list this PR's migrations and nothing else
    supabase db push
    scripts/gen-types.sh           # regenerate types from the migrations

Then query `supabase_migrations.schema_migrations` through the MCP: the new version is there. Only
then merge. Every merge to `main` deploys to production (#68): the new code may read what only the
migration creates. If the dry-run lists anything else, stop and say what.

The backup holds personal data (`auth.users`): never read it, never put it in an issue, a PR or a
chat. If `db push` or a dump asks for the database password, stop and ask Luiz where it lives; it
never goes in the repository or in a chat.

## Vercel (Luiz only, set up once in #68)

Hobby plan. Project imported from `luizvictor19/chelsea-st-app`, framework Next.js, Node 24
(`engines` in `package.json`). Functions in `gru1` (`vercel.json`).

Settings > Environment Variables, by name only (values live in Vercel and in `.env.local`):

    Production   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
                 NEXT_PUBLIC_TEACHER_CONTACT_EMAIL=contato@chelsea-st.com,
                 SUPABASE_SERVICE_ROLE_KEY, FREEPIK_API_KEY, DEEPSEEK_API_KEY,
                 ANTHROPIC_API_KEY
    Preview      NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
                 NEXT_PUBLIC_TEACHER_CONTACT_EMAIL

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (#275), Production only, the second
as a Secret: the widget of `/cadastro`, created in the Cloudflare dashboard (Turnstile, Add widget,
hostname `app.chelsea-st.com` and no other, mode Managed). The server does not compare the
hostname siteverify returns: the widget's list is what keeps a token solved elsewhere out, so
`localhost` or a preview never enters it. Without both the signup stays closed ("As inscrições
abrem em breve"), as it does while there is no Asaas key; a preview never has the page. Locally,
Cloudflare's test keys stand in: site key `1x00000000000000000000AA` and secret
`1x0000000000000000000000000000000AA` always pass, and a real secret refuses their token.

`GRIFOAI_HOST` (the GrifoAI domain, server only) enters Production only after #193, when the
domain exists; until then it stays unset and nothing changes. A preview has no allowlisted host, so
it always shows the neutral brand.

`NEXT_PUBLIC_SITE_URL` is read by nothing since #196 (auth links follow the site of the request):
it can be deleted from Production whenever, and keeping it changes nothing.

`OPENAI_API_KEY` and `DEEPGRAM_API_KEY` are read only by the measurement scripts, never by the
app: they stay out of Vercel.

`DEEPSEEK_API_KEY` is read only by the measurement scripts since #225: the app calls Claude for
every suggestion, and `no-deepseek.test.ts` keeps any file of `src/` from importing
`src/lib/text/deepseek.ts`. It stays in Production by Luiz's decision (06/11/2026), so going back
to DeepSeek is an issue and a deploy, not a key to create again.

`ANTHROPIC_API_KEY` is read by the app (the four content suggestions: the scene's and the word's
"Sugerir instrução", #187, "Sugerir tipos" and "Sugerir conjuntos", #225) and by the scripts. Two keys in the Claude Console, in the mould of the Supabase ones: `chelsea-vercel` in
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

Supabase, Authentication > URL Configuration: see "Auth settings and email templates" below.

## Backup and local restore

The copy holds personal data (`auth.users`). It lives in `~/backups/chelsea-st/`, outside the
repository and outside any synced folder, and never goes into an issue, a PR or a chat. Luiz takes
it and restores it below. The Claude also takes it before every migration (Migrations above), in
a folder of its own, and never opens what it holds.

Take the copy, from the main folder (it reads the linked project through the CLI login; no
database password was asked on 2026-10-24). The Supabase CLI is a global npm package, so it is
installed once per Node version (`nvm use`, then `npm i -g supabase`):

    B=~/backups/chelsea-st/$(date +%F)
    mkdir -p "$B"
    git fetch -q && git rev-parse origin/main > "$B/commit"   # whose restore file fits this copy
    supabase db dump --linked --role-only -f "$B/roles.sql"
    supabase db dump --linked -f "$B/schema.sql"
    supabase db dump --linked --data-only --use-copy -f "$B/data.sql"
    supabase storage cp -r ss:///vocabulary-images "$B/vocabulary-images" --linked --experimental

Restore it on a local stack that has none of the repository's migrations (they seed rows, and the
copy already holds them). Two lines of the copy are refused locally and are filtered out first,
both found in the 2026-10-24 rehearsal: a grant on `log_min_messages` to the Realtime role, and
the `storage.buckets_vectors` and `storage.vector_indexes` tables (empty in production). The
restore runs in one transaction, so any other error leaves the local database empty.

The dump writes the schemas of the project, not `storage` or `auth`, so the copy comes back
without the objects the migrations create there: the policies of `storage.objects` (#101), found
missing in the 2026-10-24 rehearsal, and the two triggers of `auth.users` (#104), found missing in
the 2026-10-25 one: without `on_auth_user_created` a new account gets no `profile`, and without
`on_auth_user_email_confirmed` a confirmed email accepts no invite. Their functions are in `public`
and come with the dump. `scripts/restore-outside-public.sql` recreates both kinds, last,
inside the same transaction, as `$R` below. CI holds the file to the migrations. A copy takes the
file of its own commit, saved with it in `$B/commit`. A copy without it, or whose commit is older
than the merge of #104, takes the file of `main` instead: the objects in it have not changed since
0047 (2026-11-07), only the file grew to cover them.

    git show "$(cat "$B/commit")":scripts/restore-outside-public.sql > "$B/restore-outside-public.sql"
    R="$B/restore-outside-public.sql"

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
      --file "$R" \
      --dbname postgresql://postgres:postgres@127.0.0.1:54322/postgres

Compare: run `scripts/row-counts.sql` and `scripts/catalog-fingerprint.sql` on the copy, and ask
Claude to run both on production through the MCP and write the output, one line per row, to
`$B/row-counts.production` and `$B/catalog-fingerprint.production`. Both `diff` must print
nothing; the fingerprint is what shows a `policy|storage.objects|...` or a `trigger|auth.users|...`
line missing from the copy.

    DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres
    for f in row-counts catalog-fingerprint; do
      psql -X -q -At -v ON_ERROR_STOP=1 -f scripts/$f.sql "$DB" > "$B/$f.copy"
      diff "$B/$f.production" "$B/$f.copy"
    done

Rehearse a migration on the copy (first for 0040, #199), from the worktree that holds it. Three
read-only outputs, before and after: the row counts, the catalog of `public`, the policies of
`storage` and the triggers that call a function of `public` (`scripts/catalog-fingerprint.sql`), and how many rows each account sees in each table
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

    Site URL        https://app.chelsea-st.com
    Redirect URLs   http://localhost:3100                      (exact, #196)
                    http://127.0.0.1:3100                      (exact, #196)
                    http://grifoai.localhost:3100              (exact, #196)
                    https://<grifoai-host>                     (exact, after #193)

No entry ends in `/**` (#209, removed on 2026-11-06): the app sends only an origin, which no
`/**` pattern matches, a preview sends nothing, and production is accepted as the Site URL's
hostname. A pattern would only widen what Supabase accepts.

Since #196 every auth email leads to the site the request came from (`src/lib/auth-links.ts`):
login and "Esqueci minha senha" pass Supabase only the origin of that site, from the allowlist of
`src/lib/brand.ts`. Since #195 an invite follows the brand of the organization invited, not the
inviter's host, and only to an `https` site, because the invitee opens it on her own machine: a
Chelsea invite leads to `https://app.chelsea-st.com` even when sent from a dev server, and a
GrifoAI invite gets the Site URL until the GrifoAI origin is in the allowlist (#193). An origin has no path, so no `/**`
pattern matches it: each one is an exact entry. GoTrue (`internal/utilities/request.go`) accepts a
redirect whose hostname is the Site URL's, with any scheme, port, path or query, or one that
matches a Redirect URL; otherwise, and when nothing is sent (a host outside the allowlist, a
preview), it puts the Site URL in `{{ .RedirectTo }}`.

Authentication > Sign In / Providers: "Allow new users to sign up" off (#109). Nobody gets an
account without an invite; `inviteUserByEmail` is an admin call and still works. The signup of
Chelsea St (#275) goes through it too, from the server, behind Turnstile: the switch stays off.

Authentication > Rate Limits: the emails sent per hour are one cap for the whole project, and the
public `/cadastro` spends from it, as the magic link and "Esqueci minha senha" do. Measured on the
local stack on 2026-11-12, `inviteUserByEmail` has no limit per address (two invites to the same
address, one right after the other, both went out), so Turnstile is the only thing between the form and that
cap. Check the value there before the signup opens, and the Resend plan's quota, which the same
SMTP spends.

Authentication > Providers > Email: minimum password length 8, and Email OTP Expiration 86400
seconds (24 hours, the most Supabase allows). The invite stays open 15 days in `organization_invites`,
but its email link lasts only this long; after that, "Reenviar" or "Esqueci minha senha" with
the same email.

Authentication > Emails. Each template's link is exactly this (`/set-password` since #116; an email
sent before still says `/definir-senha`, which redirects there, see `src/lib/renamed-paths.ts`):

    Confirm signup   {{ $origem }}/auth/callback?token_hash={{ .TokenHash }}&type=email
    Magic link       {{ $origem }}/auth/callback?token_hash={{ .TokenHash }}&type=email
    Invite user      {{ $origem }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/set-password
    Reset password   {{ $origem }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/set-password

The link never starts with `{{ .RedirectTo }}` itself. Anyone with the public key can call
Supabase directly, and any redirect on the Site URL's hostname (or under a `/**` pattern, if one
were added) is accepted, path and query included: at the start of a link that carries a
`token_hash`, it could send the person to a link of the caller's choosing. The templates are Go templates, one set for
every brand. The first line of each body sets `$origem` to `{{ .SiteURL }}` and takes
`{{ .RedirectTo }}` only when it equals one of the exact Redirect URLs above, whole (`eq` with
several values is true when the first equals any of the others). The same line, and the first line
of each subject, picks the brand name. `src/lib/auth-links.test.ts` holds every link here on
`{{ $origem }}`, the four bodies on one line, and every origin the code sends in that line: a new
origin enters the Redirect URLs, the line and the dashboard together.

Until #193 the GrifoAI domain is written as the placeholder `https://<grifoai-host>`, which never
matches: replace it with the real origin then, in the four subjects and the four bodies. A GrifoAI
origin missing from the line or from the Redirect URLs gives no error: the email says Chelsea St
and links to the Site URL. The sender stays `contato@chelsea-st.com` for both brands (one SMTP); a
sender per brand is a new issue.

A redirect that is not a listed origin, such as the `/auth/callback?next=/set-password` the code
sent before #196 (a rollback, another branch), gets the Site URL in the link: it stays whole and
only loses the host it was asked from. The order between a deploy and a template change does not
break a link.

The invite template has two branches since #275. The signup of Chelsea St (`/cadastro`) is an
invite the person asks for: the server calls `inviteUserByEmail` with the metadata
`{ signup: true, full_name }`, which the template reads as `.Data.signup` (measured on the local
stack on 2026-11-12: the subject and the body of the branch arrived in Mailpit). A signup always
sends a Chelsea St origin, so its email says Chelsea St. An organization's invite has no `signup`
and keeps the text it had.

Every template is in Portuguese, like every string a teacher or student reads. Subject and body
of each (#196; the ones before named Chelsea St and used `{{ .SiteURL }}` alone):

    Subject: {{ $marca := "Chelsea St" }}{{ if eq .RedirectTo "http://grifoai.localhost:3100" "https://<grifoai-host>" }}{{ $marca = "GrifoAI" }}{{ end }}Confirme o seu e-mail na {{ $marca }}

    {{ $origem := .SiteURL }}{{ $marca := "Chelsea St" }}{{ if eq .RedirectTo "https://app.chelsea-st.com" "http://localhost:3100" "http://127.0.0.1:3100" }}{{ $origem = .RedirectTo }}{{ end }}{{ if eq .RedirectTo "http://grifoai.localhost:3100" "https://<grifoai-host>" }}{{ $origem = .RedirectTo }}{{ $marca = "GrifoAI" }}{{ end }}
    <h2>Confirme o seu e-mail</h2>
    <p>Clique no link abaixo para confirmar este e-mail e entrar na {{ $marca }}.</p>
    <p><a href="{{ $origem }}/auth/callback?token_hash={{ .TokenHash }}&type=email">Confirmar e-mail</a></p>
    <p>Se não foi você, ignore esta mensagem.</p>

    Subject: {{ $marca := "Chelsea St" }}{{ if eq .RedirectTo "http://grifoai.localhost:3100" "https://<grifoai-host>" }}{{ $marca = "GrifoAI" }}{{ end }}{{ if .Data.signup }}Confirme o seu cadastro na {{ $marca }}{{ else }}Seu convite para a {{ $marca }}{{ end }}

    {{ $origem := .SiteURL }}{{ $marca := "Chelsea St" }}{{ if eq .RedirectTo "https://app.chelsea-st.com" "http://localhost:3100" "http://127.0.0.1:3100" }}{{ $origem = .RedirectTo }}{{ end }}{{ if eq .RedirectTo "http://grifoai.localhost:3100" "https://<grifoai-host>" }}{{ $origem = .RedirectTo }}{{ $marca = "GrifoAI" }}{{ end }}
    {{ if .Data.signup }}
    <h2>Confirme o seu cadastro na {{ $marca }}</h2>
    <p>Clique no link abaixo para confirmar este e-mail e escolher a sua senha.</p>
    <p><a href="{{ $origem }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/set-password">Confirmar e escolher a senha</a></p>
    <p>O link vale por 24 horas. Se ele vencer, peça um novo em "Esqueci minha senha", na tela de entrar, com este e-mail. Se não foi você que se cadastrou, ignore esta mensagem.</p>
    {{ else }}
    <h2>Você foi convidada para a {{ $marca }}</h2>
    <p>Clique no link abaixo para escolher a sua senha e entrar.</p>
    <p><a href="{{ $origem }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/set-password">Aceitar o convite</a></p>
    <p>O link vale por 24 horas. Se ele vencer, peça um novo em "Esqueci minha senha", na tela de entrar, com este e-mail.</p>
    {{ end }}

    Subject: {{ $marca := "Chelsea St" }}{{ if eq .RedirectTo "http://grifoai.localhost:3100" "https://<grifoai-host>" }}{{ $marca = "GrifoAI" }}{{ end }}Seu link para entrar na {{ $marca }}

    {{ $origem := .SiteURL }}{{ $marca := "Chelsea St" }}{{ if eq .RedirectTo "https://app.chelsea-st.com" "http://localhost:3100" "http://127.0.0.1:3100" }}{{ $origem = .RedirectTo }}{{ end }}{{ if eq .RedirectTo "http://grifoai.localhost:3100" "https://<grifoai-host>" }}{{ $origem = .RedirectTo }}{{ $marca = "GrifoAI" }}{{ end }}
    <h2>Entrar na {{ $marca }}</h2>
    <p>Clique no link abaixo para entrar. Ele vale uma vez só.</p>
    <p><a href="{{ $origem }}/auth/callback?token_hash={{ .TokenHash }}&type=email">Entrar</a></p>
    <p>Se não foi você que pediu, ignore esta mensagem.</p>

    Subject: {{ $marca := "Chelsea St" }}{{ if eq .RedirectTo "http://grifoai.localhost:3100" "https://<grifoai-host>" }}{{ $marca = "GrifoAI" }}{{ end }}Nova senha na {{ $marca }}

    {{ $origem := .SiteURL }}{{ $marca := "Chelsea St" }}{{ if eq .RedirectTo "https://app.chelsea-st.com" "http://localhost:3100" "http://127.0.0.1:3100" }}{{ $origem = .RedirectTo }}{{ end }}{{ if eq .RedirectTo "http://grifoai.localhost:3100" "https://<grifoai-host>" }}{{ $origem = .RedirectTo }}{{ $marca = "GrifoAI" }}{{ end }}
    <h2>Escolher uma nova senha</h2>
    <p>Clique no link abaixo para escolher uma nova senha.</p>
    <p><a href="{{ $origem }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/set-password">Escolher nova senha</a></p>
    <p>O link vale por 24 horas. Se não foi você que pediu, ignore esta mensagem: a sua senha continua a mesma.</p>

### "O link não chegou" (#110)

The two link screens say "Link enviado" whatever happens, so a failed send shows only in the logs.
Ask Claude to run this through the MCP (`query_logs`, at most the last 24 hours, the Free plan's
retention), and look in the Vercel runtime log of the same hour for `link request failed`:

    select timestamp, log_attributes['request.path'] as path,
           log_attributes['response.status_code'] as status
      from logs
     where source = 'edge_logs'
       and log_attributes['request.path'] in ('/auth/v1/otp', '/auth/v1/recover')
       and toInt32OrZero(log_attributes['response.status_code']) >= 400
     order by timestamp desc

A 429 has three causes, and the Vercel log line of the same minute tells them apart: the limit of
one email per address per minute (`link request rate limited`, a warning: the person asked twice,
and the first link is the one to use); the project's cap of emails per hour (`link request failed`
with "email rate limit exceeded": nothing goes out for anyone until the hour turns); or the limit
of requests per IP, which every request from Vercel shares (`over_request_rate_limit`).

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
- A branch left behind after the merge:
  `gh api -X DELETE repos/luizvictor19/chelsea-st-app/git/refs/heads/<branch>`.

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

## Secret scanning and push protection

On since 07/11/2026 (#150), in Settings > Advanced Security. Only Luiz changes them. Check:

    gh api repos/luizvictor19/chelsea-st-app --jq .security_and_analysis

`secret_scanning` and `secret_scanning_push_protection` read `enabled`. Non-provider patterns and
validity checks stay off.

**A push refused with `GH013` ("Push cannot contain secrets").** The commit never reached GitHub.
The session stops and tells Luiz. It never uses the bypass link in the message.

- A real key: take it out of the file (the value goes to `.env.local`, only the name stays in the
  code), undo the local commits that never left the machine, and commit again:

      git reset --soft @{u}                                   # the branch was pushed before
      git reset --soft $(git merge-base HEAD origin/main)     # the branch was never pushed

  This rewrites only commits that never reached GitHub: it is not an amend, a rebase or a force
  push. The refused push did not publish the key; rotate it at the provider only if it left the
  machine some other way.

- A false positive (a fixture, a test string): the call and the bypass are Luiz's, through the
  link in the message.

**An alert in Security > Secret scanning** (a key that got in before, or by another path): rotate
the key at the provider first, then remove it from the code in a normal PR. Git history keeps the
old value, so only the rotation closes the leak. Close the alert as "Revoked".

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

Open http://127.0.0.1:3100, not localhost. An email link asked for there already starts with
`http://127.0.0.1:3100` (#196; before its templates, swap the start by hand), signs in and stays
on that host (#102). Signing out stays on it too (#172).

## Supabase CLI

    npm i -g supabase              # global npm packages are per Node version

The CLI fetches the project's API keys through the management API and keeps none. The database
password is not kept in `.env.local`: when a command needs it, the CLI asks.

## Asaas (#72)

The environment is read as the app reads it (`@next/env`), so `ASAAS_API_KEY=\$aact_...` in
`.env.local` works for the scripts too. The address follows the key's prefix.

    node scripts/asaas-sandbox-smoke.ts        # the adapter through the real sandbox; JSONL in fixtures/asaas/
    node scripts/asaas-webhook.ts --url https://<host>/api/asaas/webhook --email <alerts>

End to end with the sandbox, never against production (the database is production):

    supabase start                             # the local stack; stop it with supabase stop, never --no-backup
    cloudflared tunnel --url http://localhost:3100
    node scripts/asaas-webhook.ts --url https://<tunnel>.trycloudflare.com/api/asaas/webhook --email <alerts>

The daily overdue routine by hand (Vercel Cron calls it at 12h UTC in production):

    curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/billing/daily

## Calendar invites (#294)

The daily routine by hand (Vercel Cron calls it at 13h UTC in production). It sends the pending
invites of every lesson, in the database `.env.local` points at, which is production:

    curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/calendar/daily

A real invite and its cancel of a made-up lesson, without the database, to see a calendar take
them (Luiz only: it sends real e-mails). The answers go to `fixtures/calendar/smoke-<date>.jsonl`,
without the addresses:

    node scripts/calendar-smoke.ts --student <e-mail> --teacher <e-mail> --wait 60

What is waiting or was given up, through the MCP (no address in the table):

    select status, method, recipient, attempts, last_error, count(*)
      from calendar_invites group by 1, 2, 3, 4, 5 order by 1;
