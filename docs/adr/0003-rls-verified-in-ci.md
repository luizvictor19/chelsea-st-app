# 0003 · RLS policies verified in CI against a real Postgres

- **Status**: accepted
- **Date**: 2026-09-18, recorded retrospectively. The decision dates from
  phase F1 (early September 2026).

## Context

With Supabase, the database is reachable from the browser with the anon
key. Row Level Security is the only thing standing between a student and
another student's data, or the teacher's unpublished content. A policy
mistake is invisible in normal use and only shows up as a leak. Unit tests
against a mock cannot catch it, because the policies live in Postgres.

## Decision

CI runs a Postgres 17 service and executes `scripts/verify-rls.sql` with
`ON_ERROR_STOP`. The script stubs the two things the migrations need from
Supabase's `auth` schema (`auth.users` and `auth.uid()`, the latter reading
a session setting), applies every migration in order, seeds a teacher, a
student and some content, then switches to the `authenticated` role as the
student and asserts: zero rows visible in every content table, exactly one
published question visible, and every table in `public` with RLS enabled.
A failing assertion fails the build.

## Consequences

- Every new table needs its policies, and the script needs its assertion,
  in the same PR, or CI goes red. The "every table has RLS" check catches a
  table added without any policy at all.
- The migrations are proven to apply cleanly from zero on every push.
- The stub is not Supabase: JWT claims, `service_role` behaviour and the
  API's grants are not exercised here. What the script proves is row
  visibility per role; what production has is checked through the read-only
  Supabase MCP, never inferred from files on disk.
- CI is a minute slower than a suite without a database. Accepted.
