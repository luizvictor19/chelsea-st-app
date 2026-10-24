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

The lesson server always runs in Luiz's own terminal, never in a Claude Code session.

## Gate (the CI steps, minus verify-rls.sql, which only CI runs)

    npm run check                  # format:check, lint, typecheck, test, build; stops at the first failure

## Merge PR NN and clean up (session in the main folder, not in the worktree)

    gh pr merge NN --merge
    git pull
    git worktree remove ../chelsea-st-app-NN
    git branch -d feat/NN-scope
    git push origin --delete feat/NN-scope

## Migrations (Luiz only)

    supabase db push               # from the worktree that holds the new file
    scripts/gen-types.sh           # regenerate types from the migrations

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
    supabase stop --workdir "$S" --no-backup   # deletes the local copy

## GitHub quirks

    gh api -X PATCH repos/luizvictor19/chelsea-st-app/pulls/NN -f base=main     # change PR base
    gh api -X PATCH repos/luizvictor19/chelsea-st-app/pulls/NN -F body=@body.md # replace PR body
    gh issue list --state open                                                  # open issues

`gh pr edit` fails in this repository; use the calls above.

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

Open http://127.0.0.1:3100, not localhost, and type the URL again after signing in.

## Supabase CLI

    npm i -g supabase              # global npm packages are per Node version
