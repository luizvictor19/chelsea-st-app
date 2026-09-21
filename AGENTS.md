# Chelsea St platform · working agreements

Read this before writing code in this repository.

## Language

- English where the text lives among code: identifiers, comments, commit
  messages. There it is not a choice, it is the neighbourhood.
- Portuguese where the text is for a person to read: README, the specs under
  docs/, and every string the teacher or the student sees. Their job is to be
  read, and the reader is Brazilian.
- Reports, summaries and answers to Luiz are written in Portuguese. English is
  for code, identifiers, comments, commit messages and files under docs/adr/.
- When unsure, ask before deciding.

## Content and licensing

The teaching material in this product is written by Luiz. This platform
does not redistribute or serve published course books to third parties.
Extraction targets and the teacher's own working notes, derived from
books he owns and used for his own lessons, are his material and may be
stored here. Book page images are never committed to this repository.
The wording of every generated practice sentence is original.

## Stack

Next.js App Router, TypeScript in strict mode, Tailwind, Supabase for
Postgres, Auth and Storage. Deployed on Vercel.

## Rules

- Row Level Security is enabled on every table, in the same migration that
  creates it. Never a follow-up task.
- Secrets live in the environment. `.env.example` is committed, `.env.local`
  never is.
- No `any` without a comment explaining why.
- A bug fix starts with a failing test.
- Never commit, push or deploy unless asked.
- DDL only through a migration. Write migrations, never apply them: Luiz
  applies with `supabase db push`.
- Never choose a migration number yourself. Use the number given in the
  prompt; if none was given, ask. Parallel branches share one sequence.
- After writing a migration and before it is applied, the regenerated
  `types.ts` describes a database that does not exist yet, and the gate stays
  green anyway. Apply before running or deploying.
- Types come from `./scripts/gen-types.sh`, never from the live project.
- Any script that pays for external calls writes each result as it arrives
  (JSONL, append mode). A measurement that lives only in memory is lost whole
  on interruption.
- No em dash in any text. The separator is ·.

## Where rigor goes

- **High, where a mistake stays hidden.** Extraction, reconciliation,
  migrations, RLS, anything written to the database, and any convention about
  the shape of stored data. No threshold enters here without being measured
  against the real fixtures first, and the measurement is recorded next to the
  constant it justifies.
- **Low, where the screen shows the mistake at once.** Layout, spacing, colour
  and screen copy. The gate and one look at the page catch these, so decide and
  move on.
- **The exception.** UI state that can eat the teacher's work without saying so
  goes back in the high column, however small the change looks: a destructive
  action behind an unlabelled control, a save that drops an edit in silence.
- **Never report the state of the database from files on disk.** The Supabase
  MCP server is configured and read-only: query it. A migration file in
  `supabase/migrations` only proves the file exists. "Not applied" without a
  query is not a finding, it is a guess.
- **Review follows the same columns.** Run code-review once per delivery, over
  the whole diff, in exactly these cases: before Luiz applies a migration;
  before opening a PR that touches payments, webhooks, auth or RLS; after
  fixing a bug in a high-rigor area. Never for layout, screen copy, docs or
  tests only.

## Git

- Branches: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`, `docs/<scope>`.
- Conventional Commits: `feat(auth): add magic link sign-in`.
- One commit per logical unit.
- Before the first commit, check the current branch. Never commit on `main`.
  If on `main`, create a branch first. A hook in `.claude/settings.json`
  enforces this; the rule stands without it.
- No amend. A second commit instead.
- When Luiz asks, commit, push and open the PR yourself. Write the PR body to
  a file and use `gh pr create --body-file`; never pass a long body inline.
- Never merge: merging is Luiz's.
- Squash merge a messy branch. A branch deliberately sliced so that every commit
  is a valid state is merged whole: the slicing is the information, and squashing
  it would put a broken intermediate state in history as if it had never existed.

## Parallel work

- One stream is one branch, one git worktree, one Claude Code session.
- Stay inside the files the prompt assigns to the stream. Touching a file
  another stream owns is a question for Luiz, not a decision.
- The dev server of each worktree runs on the port given in the prompt.
- `merge` and `rebase` are denied to you on purpose. Bringing `main` into a
  branch is Luiz's; after he does, `./scripts/gen-types.sh` resolves
  `types.ts`.

## Verifying

```bash
npx prettier --check .
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Run `./scripts/gen-types.sh` before the gate whenever a migration was added or
changed, and after Luiz brings `main` into a branch.
