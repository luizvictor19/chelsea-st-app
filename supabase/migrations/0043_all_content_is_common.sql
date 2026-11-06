-- All content is common (issue #211, ADR 0005).
--
-- ADR 0004 let an organization hold content of its own, written by its admin
-- and teachers. On 2026-11-06 Luiz decided the teacher only teaches: every
-- piece of content is common, written by the platform admin alone, and read
-- where a lesson needs it. organization_id stays on the content tables,
-- always null: dropping it would rewrite policies and triggers for no gain.
--
-- Measured on 2026-11-06 through the MCP, with 0001 to 0042 applied: 0 rows
-- with organization_id in the 10 content tables (12 books, 9 lessons_content,
-- 128 points, 144 blocks, 283 vocabulary_items, 187 image_attempts, 25
-- contrast_sets, 75 contrast_set_items, 10 questions, 3 scenes), and 0 of
-- the 194 objects of vocabulary-images under an organization's folder. No
-- check on organization_id existed in any of the 10. Each <table>_write was
-- (SELECT is_platform_admin()) OR (organization_id IS NOT NULL AND
-- teaches_in(organization_id)), the same in using and with check.

-- The parameter stays: materialize_points, reorder_questions,
-- delete_question and the scene suggestion pass the row's organization,
-- which is now always null.
create or replace function can_write_content(p_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_platform_admin();
$$;

-- No row of content belongs to an organization. One named constraint per
-- table, so a refusal says which table refused.
alter table books              add constraint books_is_common              check (organization_id is null);
alter table lessons_content    add constraint lessons_content_is_common    check (organization_id is null);
alter table points             add constraint points_is_common             check (organization_id is null);
alter table blocks             add constraint blocks_is_common             check (organization_id is null);
alter table vocabulary_items   add constraint vocabulary_items_is_common   check (organization_id is null);
alter table image_attempts     add constraint image_attempts_is_common     check (organization_id is null);
alter table contrast_sets      add constraint contrast_sets_is_common      check (organization_id is null);
alter table contrast_set_items add constraint contrast_set_items_is_common check (organization_id is null);
alter table questions          add constraint questions_is_common          check (organization_id is null);
alter table scenes             add constraint scenes_is_common             check (organization_id is null);

-- Only the platform admin writes content. The branch for an organization's
-- own rows is dead under the checks above; it goes so that no policy says a
-- teacher writes.
alter policy books_write on books
  using ((select is_platform_admin())) with check ((select is_platform_admin()));
alter policy lessons_content_write on lessons_content
  using ((select is_platform_admin())) with check ((select is_platform_admin()));
alter policy points_write on points
  using ((select is_platform_admin())) with check ((select is_platform_admin()));
alter policy blocks_write on blocks
  using ((select is_platform_admin())) with check ((select is_platform_admin()));
alter policy vocabulary_items_write on vocabulary_items
  using ((select is_platform_admin())) with check ((select is_platform_admin()));
alter policy image_attempts_write on image_attempts
  using ((select is_platform_admin())) with check ((select is_platform_admin()));
alter policy contrast_sets_write on contrast_sets
  using ((select is_platform_admin())) with check ((select is_platform_admin()));
alter policy contrast_set_items_write on contrast_set_items
  using ((select is_platform_admin())) with check ((select is_platform_admin()));
alter policy questions_write on questions
  using ((select is_platform_admin())) with check ((select is_platform_admin()));
alter policy scenes_write on scenes
  using ((select is_platform_admin())) with check ((select is_platform_admin()));

-- Storage: the platform admin writes anywhere in the bucket, nobody else
-- writes. Qualified, as in 0029 and 0042: a storage request does not arrive
-- with public on its search_path.
drop policy vocabulary_images_write on storage.objects;
create policy vocabulary_images_write on storage.objects
  for all
  using (bucket_id = 'vocabulary-images' and (select public.is_platform_admin()))
  with check (bucket_id = 'vocabulary-images' and (select public.is_platform_admin()));
