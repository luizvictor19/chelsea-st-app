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

    npx prettier --check . && npm run lint && npx tsc --noEmit && npm test && npm run build

## Merge PR NN and clean up (session in the main folder, not in the worktree)

    gh pr merge NN --merge
    git pull
    git worktree remove ../chelsea-st-app-NN
    git branch -d feat/NN-scope
    git push origin --delete feat/NN-scope

## Migrations (Luiz only)

    supabase db push               # from the worktree that holds the new file
    scripts/gen-types.sh           # regenerate types from the migrations

## GitHub quirks

    gh api -X PATCH repos/luizvictor19/chelsea-st-app/pulls/NN -f base=main     # change PR base
    gh api -X PATCH repos/luizvictor19/chelsea-st-app/pulls/NN -F body=@body.md # replace PR body
    gh issue list --state open                                                  # open issues

`gh pr edit` fails in this repository; use the calls above.

## Phone testing (Android)

    adb reverse tcp:3100 tcp:3100  # after every cable connection

Open http://127.0.0.1:3100, not localhost, and type the URL again after signing in.

## Supabase CLI

    npm i -g supabase              # global npm packages are per Node version
