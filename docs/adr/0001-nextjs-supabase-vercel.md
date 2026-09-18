# 0001 · Next.js on Vercel with Supabase

- **Status**: accepted
- **Date**: 2026-09-18, recorded retrospectively. The decision dates from the
  start of the platform (August 2026).

## Context

One developer, part time, building a platform that needs authentication,
a relational database with per-user access rules, file storage for
vocabulary images and audio, and a public web app. The developer's daily
stack is React and TypeScript. Operating servers is not where the time
should go.

## Decision

Next.js (App Router) in strict TypeScript, deployed on Vercel. Supabase for
Postgres, Auth (magic link, no passwords) and Storage. Schema changes only
through versioned migrations in `supabase/migrations`.

## Consequences

- No infrastructure to run. Deploys are a push to `main`.
- Row Level Security is the real access control, not application code;
  every table needs policies and they need tests (see 0003).
- Vendor coupling to Supabase Auth and Storage is accepted. Postgres itself
  is portable.
- Server-side rendering and server actions keep secrets off the client;
  the browser only ever holds the anon key.
