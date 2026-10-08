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
- Supabase Pro. Daily backups come with the plan; retention and a restore have never been checked.
- The platform is not deployed yet. Luiz runs it locally on port 3100 (`npm run dev`).
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

## Sensitive data and secrets

- `.env.local` is never read, printed or committed. Worktrees get a copy with `cp`.
- API keys are server-only, never `NEXT_PUBLIC_`.
- Student personal data (name, email, audio) is processed under the privacy terms published on the
  landing. Never log it, never paste it into an issue.

## Content state

- Book 1 is fully ingested (points 1 to 52). Book 2 is extracted but not re-ingested (points 53 to 128).
- Book 1 lesson images (measured 08/10/2026): lessons 1 to 3 complete (37, 11 and 21 words);
  lesson 4 has 5 words that need an image and none approved; lessons 5 to 9 have 124 words whose
  type (representation) is not decided yet, so it is not known how many will need images.
- Questions are written by hand on /teacher/content/questions; suggestion is planned, not built.

## Known traps

- `gh pr edit` fails in this repository. Change a PR base with
  `gh api -X PATCH repos/luizvictor19/chelsea-st-app/pulls/N -f base=main`.
- A dev server started by a Claude Code session dies with the session. The lesson server always
  runs in Luiz's own terminal.
- Claude Code sessions have no browser: screens are tested by Luiz, and the PR must say so.
