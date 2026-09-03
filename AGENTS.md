# Chelsea St platform — working agreements

Read this before writing code in this repository.

## Language

- File names, folders, identifiers, types, tables, columns and comments: **English**.
- Portuguese only in user-facing copy: UI strings, emails, teaching content.
- When unsure, ask before deciding.

## Content and licensing

The teaching material in this product is written by Luiz. Published course
books are not reproduced, stored or served here. A stage's `grammar_targets`
and `vocabulary_targets` describe what to teach; the wording of every question
is original.

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

## Git

- Branches: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`, `docs/<scope>`.
- Conventional Commits: `feat(auth): add magic link sign-in`.
- One commit per logical unit. Squash merge into `main`.

## Verifying

```bash
npx prettier --check .
npm run lint
npx tsc --noEmit
npm run build
```
