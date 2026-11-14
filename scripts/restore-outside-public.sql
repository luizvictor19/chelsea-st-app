-- What a restored copy needs that supabase db dump leaves out (#101, #104).
--
-- The dump writes the schemas of the project, not storage or auth, so a copy
-- restored by docs/commands.md ("Backup and local restore") comes back without
-- the objects the migrations create there. This file recreates them in the
-- state the migrations leave, each with the migration it comes from. The block
-- "A restored copy gets back what the dump leaves out" at the end of
-- scripts/verify-rls.sql holds it to the migrations: a migration that changes
-- one of these and forgets this file fails in CI.
--
-- Plain create, no "if not exists": if the dump ever starts carrying one of
-- these, the restore fails loudly instead of keeping two versions.
--
-- It runs as postgres, which owns neither storage.objects nor auth.users: the
-- Supabase image lets it create policies there through supautils.policy_grants,
-- which on production names storage.objects and auth.users for postgres
-- (measured through the MCP on 2026-11-12). A trigger needs the trigger
-- privilege on the table and execute on the function: on production postgres
-- holds trigger on auth.users and owns both functions, with the owner's
-- execute that 0047 left (measured through the MCP on 2026-11-12).
--
-- A copy takes the file of its own commit, saved with it in $B/commit
-- (docs/commands.md). A copy from before 0043 has no
-- public.is_platform_admin(), and the restore fails on it.

-- The policies of the vocabulary-images bucket.

create policy vocabulary_images_read on storage.objects                -- 0008
  for select using (bucket_id = 'vocabulary-images');

create policy vocabulary_images_write on storage.objects               -- 0043, 0047
  for all to authenticated
  using (bucket_id = 'vocabulary-images' and (select public.is_platform_admin()))
  with check (bucket_id = 'vocabulary-images' and (select public.is_platform_admin()));

-- The triggers of auth.users. Their functions are in public and come with the
-- dump; the triggers are on a table of auth, and do not. Postgres fires them
-- in the order of their names, and on_auth_user_created runs first, as 0031
-- needs: the profile exists before an invite is accepted.

create trigger on_auth_user_created                                    -- 0002
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger on_auth_user_email_confirmed                            -- 0031, 0040
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.accept_organization_invites_on_confirmation();
