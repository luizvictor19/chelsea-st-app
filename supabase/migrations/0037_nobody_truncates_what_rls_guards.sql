-- Nobody truncates what RLS guards. Issue #147, number 0037 approved by Luiz
-- on 2026-11-04.
--
-- In production the default ACL of the postgres role in schema public grants
-- Dxtm (truncate, references, trigger, maintain) on every new table to anon,
-- authenticated and service_role. "Automatically expose new tables" is off
-- (0001), and what Supabase revokes for that is only select, insert, update
-- and delete: the Dxtm stays. Row level security filters none of the four, so
-- a signed-in user could truncate a table whose rows the policies hide from
-- her.
--
-- Measured through the MCP on 2026-11-04, before this migration (0001 to 0036
-- applied, Postgres 17.6):
--   pg_default_acl, postgres in public, tables:
--     {postgres=arwdDxtm/postgres,anon=Dxtm/postgres,authenticated=Dxtm/postgres,service_role=Dxtm/postgres}
--   23 relations in public, all tables (no view, no sequence). Of the 22 from
--   0001 to 0035, every one gives Dxtm to authenticated and to service_role;
--   anon holds nothing, because each migration revoked all from it. leads
--   (0036) gives service_role insert and nothing else.
--   Holders per privilege on those 23 tables:
--     authenticated  select 22, insert 20, update 20, delete 19,
--                    truncate 22, references 22, trigger 22, maintain 22
--     service_role   insert 1 (leads), truncate 22, references 22,
--                    trigger 22, maintain 22
--     anon           none
--
-- Nobody uses the four: no migration and nothing in src/ truncates, locks,
-- vacuums, analyzes, reindexes, creates a trigger or a foreign key as one of
-- these roles; the API (PostgREST) uses only select, insert, update and delete;
-- and the service role only sends invites through Auth. The row locks the
-- functions take (for update, for share) ask for update, which stays.
--
-- Two revokes, because each closes half: the default ACL, so the next table a
-- migration creates (as postgres) is born closed, and every table of public as
-- it stands, so the 23 of today are.
--
-- Left as it is: supabase_admin has a default ACL of its own in public, giving
-- arwdDxtm to the three roles on a table it creates there. It belongs to
-- Supabase, postgres cannot alter it, and on 2026-11-04 no relation of public
-- had any owner but postgres. The last block of scripts/verify-rls.sql checks
-- every relation of public whoever made it, but the CI never sees a table
-- supabase_admin would create in production.
-- Only the four. select, insert, update and delete were granted on purpose by
-- the migrations and stay as they are; a revoke all would take the API down.
-- anon is named too, with nothing to lose today, because the default named it.
--
-- Privileges only: no row changes.

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables
  from anon, authenticated, service_role;

revoke truncate, references, trigger, maintain
  on all tables in schema public
  from anon, authenticated, service_role;
