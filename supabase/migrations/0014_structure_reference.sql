-- The structure reference: the one the word is set up with, and the one each
-- attempt actually used.
--
-- Two columns and not one, because they answer different questions and the
-- answers come apart. The word's is a working state: the teacher uploads a
-- reference once and generates from it several times, changing the
-- instruction between tries, and it has to survive a reload and a trip to
-- another word. The attempt's is a record: it says what produced that
-- picture. The moment the teacher replaces the word's reference, a single
-- column would rewrite the history of every attempt made under the old one,
-- and the row would be confidently wrong about an image sitting in the
-- bucket.
--
-- Null on the attempt means the generation used no reference, which is every
-- attempt made before today and every one made with a model that takes none.
-- Null on the word means no reference is set up.
--
-- Both live in the vocabulary-images bucket under a prefix of their own:
--
--   references/<vocabulary_item_id>/<uuid>.<ext>
--
-- and the final pictures keep their own shape, <vocabulary_item_id>/<attempt
-- id>.<ext>, so the two never collide. The prefix is held by a check rather
-- than by habit: a path written somewhere else would still read back, still
-- resolve to a public URL and still look right, and the only thing that would
-- notice is whoever comes to clean the bucket up. storage_path gets the
-- mirror of that check below, so the separation is held from both sides.
--
-- No backfill, and nothing to backfill: no attempt has ever been generated
-- from a reference.
--
-- RLS: both tables already have it enabled, vocabulary_items from 0001 and
-- image_attempts from 0008, each with a policy covering every operation. A
-- column is not a new table and this grants nothing new. The bucket needs
-- nothing either: vocabulary_images_read and vocabulary_images_write_teacher
-- key on bucket_id alone, with no path predicate, so the new prefix inherits
-- public read and teacher-only write. Confirmed against pg_policies on
-- 2026-09-19 rather than read off the migration that created them.
alter table vocabulary_items
  add column reference_path text,
  add constraint vocabulary_items_reference_path_prefix check (
    reference_path is null or reference_path like 'references/%'
  );

alter table image_attempts
  add column reference_path text,
  add constraint image_attempts_reference_path_prefix check (
    reference_path is null or reference_path like 'references/%'
  );

-- The mirror, on the column that was there first.
--
-- storage_path is where the finished picture lives, and it is never under
-- references/. The reason is the one above, read the other way round: a
-- finished picture written into the reference prefix would still read back,
-- still resolve to a public URL and still look right, and the only one to
-- notice would be whoever comes to clean the bucket up — who would then
-- delete a picture a word is pointing at, because everything under
-- references/ is supposed to be a discardable input.
--
-- Two checks and not one shared rule, because the two columns are not saying
-- the same thing. One says "this is a reference"; the other says "this is
-- not". A single convention naming only the prefix would be satisfied by a
-- path that is neither.
--
-- No `not valid` and no backfill: measured against the project on
-- 2026-09-19, image_attempts has 43 rows, none of them under the prefix and
-- none of them null, so the constraint is true of the table before it is
-- written.
alter table image_attempts
  add constraint image_attempts_storage_path_not_reference check (
    storage_path is null or storage_path not like 'references/%'
  );

comment on column vocabulary_items.reference_path is
  'The structure reference this word is set up to generate from. Null when none is set. Upload once, generate many.';

comment on column image_attempts.reference_path is
  'The structure reference this attempt actually used. Null when it used none. Kept apart from the word''s, which can change afterwards.';
