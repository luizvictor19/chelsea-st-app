-- What a restored copy needs that supabase db dump leaves out (#101).
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
-- A copy older than the commit that changed this file needs the file of its
-- own day: git show <commit>:scripts/restore-outside-public.sql. A copy from
-- before 0043 has no public.is_platform_admin(), and the restore fails on it.

-- The policies of the vocabulary-images bucket.

create policy vocabulary_images_read on storage.objects                -- 0008
  for select using (bucket_id = 'vocabulary-images');

create policy vocabulary_images_write on storage.objects               -- 0043, 0047
  for all to authenticated
  using (bucket_id = 'vocabulary-images' and (select public.is_platform_admin()))
  with check (bucket_id = 'vocabulary-images' and (select public.is_platform_admin()));
