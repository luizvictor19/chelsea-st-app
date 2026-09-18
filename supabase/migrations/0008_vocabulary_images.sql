-- What is written when a word gets an image: generated or uploaded, approved
-- or refused.
--
-- Two ideas shape this. Every attempt is kept, because "attempts until
-- approval" per model is the number that decides which model the product pays
-- for, and an attempt that is thrown away cannot be counted. And what a model
-- suggests is stored apart from what the teacher decides, so a suggestion can
-- never become a decision on its own; the distance between the two columns is
-- the measurement of how good the suggestions are.
--
-- Measured against the project before writing this, on 2026-09-18:
--
--   select count(*), count(*) filter (where image_path is not null)
--   from vocabulary_items;   ->   283 rows, 0 with image_path
--
-- That is what lets the approved-pair check below be added with no backfill
-- and no NOT VALID step: every existing row already satisfies it.

-- Three gaps accepted on 2026-09-18, listed so they are known rather than
-- forgotten. approved_attempt_id is not held to an attempt of the same word,
-- because the composite key that would hold it collides with the on delete
-- set null. image_path is a copy and can drift from the storage_path of the
-- approved attempt; the check below pairs the two columns, it does not
-- compare them. And the bucket is public while refused files are kept, so a
-- refused image stays fetchable by URL until the cleanup that is not in this
-- delivery.

create type representation_kind as enum
  ('photo', 'symbol', 'figure', 'action', 'none');

create table image_attempts (
  id uuid primary key default gen_random_uuid(),
  vocabulary_item_id uuid not null references vocabulary_items on delete cascade,
  -- 'freepik' for generated, 'upload' for a file the teacher sent.
  provider text not null,
  -- Provider model id; null for uploads.
  model text,
  prompt text,
  -- Provider task id, to trace a charge back to a call.
  provider_request_id text,
  storage_path text,
  status text not null check (status in
    ('pending', 'generated', 'failed', 'approved', 'rejected')),
  credits_spent integer,
  error text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index image_attempts_item_idx on image_attempts (vocabulary_item_id, created_at);

-- One approved attempt per word, held by the database rather than by the
-- transaction that approves. A second writer, a retry or a future call site
-- that forgets would otherwise leave two approved rows for one word and
-- nothing would say so: the screen would show whichever came back first.
--
-- This index is not deferrable, so it fixes the order of the approval: demote
-- the previous approved row to rejected first, promote the new one second,
-- both in the same transaction. Promoting first raises a unique violation
-- halfway through.
create unique index image_attempts_one_approved_per_item
  on image_attempts (vocabulary_item_id) where status = 'approved';

alter table vocabulary_items
  add column representation representation_kind,
  add column suggested_representation representation_kind,
  add column approved_attempt_id uuid references image_attempts on delete set null,
  -- The word stores the approved image twice on purpose: the attempt id is the
  -- truth, the path is a copy so the tutor reads a word and its image in one
  -- row with no join. The check keeps the copy from existing alone.
  add constraint vocabulary_items_approved_pair check (
    (approved_attempt_id is null) = (image_path is null)
  );

-- Pending list: undecided, or decided as something that needs an image and
-- has none yet. Keyed on first_point_id, not term: the screen reads this in
-- book order, so the index serves the filter and the ordering comes from the
-- point the word is introduced at.
create index vocabulary_items_pending_image_idx on vocabulary_items (first_point_id)
  where representation is null
     or (representation <> 'none' and image_path is null);
-- Superseded by the index above: "no image" stopped meaning "still to do" the
-- moment 'none' became a decision a word can carry.
drop index vocabulary_items_without_image_idx;

alter table image_attempts enable row level security;

-- Same shape as vocabulary_items: this is the teacher's working material, and
-- the student is not denied so much as matched by nothing.
create policy image_attempts_teacher_all on image_attempts
  for all using (is_teacher()) with check (is_teacher());

-- Explicit privileges, because the project does not expose new tables
-- automatically. RLS still decides the rows; this decides whether the API may
-- reach the table at all.
grant select, insert, update, delete on image_attempts to authenticated;
revoke all on image_attempts from anon;

-- A word's picture is not sensitive, and a public bucket is what spares the
-- student's screen a signed URL per image. Writing stays with the teacher.
-- Path: {vocabulary_item_id}/{attempt_id}.{ext}
insert into storage.buckets (id, name, public)
  values ('vocabulary-images', 'vocabulary-images', true);

create policy vocabulary_images_read on storage.objects
  for select using (bucket_id = 'vocabulary-images');

-- public.is_teacher(), qualified: a storage request does not arrive with
-- public on its search_path.
create policy vocabulary_images_write_teacher on storage.objects
  for all
  using (bucket_id = 'vocabulary-images' and public.is_teacher())
  with check (bucket_id = 'vocabulary-images' and public.is_teacher());
