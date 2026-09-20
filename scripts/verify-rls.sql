-- Criterion 10, as a test rather than a claim: a signed-in student reaches no
-- row of the teacher's content, while the published questions still reach her.
--
-- Runs against an empty Postgres with the migrations applied. The auth schema
-- is stubbed to the two things the migrations touch, so this needs no Supabase.
\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

-- The storage schema, stubbed to the two tables 0008 touches, for the same
-- reason auth is stubbed above: this runs on a plain Postgres. The columns are
-- only the ones the bucket row and the policies name.
create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets,
  name text,
  owner uuid
);
alter table storage.objects enable row level security;

\i supabase/migrations/0001_init.sql
\i supabase/migrations/0002_profile_on_signup.sql
\i supabase/migrations/0003_lesson_schedules.sql
\i supabase/migrations/0004_content.sql
\i supabase/migrations/0005_block_source_page.sql
\i supabase/migrations/0006_book_first_point.sql
\i supabase/migrations/0008_vocabulary_images.sql
\i supabase/migrations/0009_image_write_paths.sql
\i supabase/migrations/0010_pose_representation.sql
\i supabase/migrations/0011_attempt_subject.sql
\i supabase/migrations/0012_word_class.sql
\i supabase/migrations/0013_attempt_completed_at.sql
\i supabase/migrations/0014_structure_reference.sql
\i supabase/migrations/0015_backfill_credits_spent.sql
\i supabase/migrations/0016_replacing_is_not_rejecting.sql
\i supabase/migrations/0017_image_style.sql
\i supabase/migrations/0018_none_was_three_things.sql
\i supabase/migrations/0019_not_drawn_is_not_nothing.sql
\i supabase/migrations/0020_suggestion_run_id.sql
\i supabase/migrations/0021_reclassifying_is_not_rejecting.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'teacher@example.com', '{"full_name":"Teacher"}'),
  ('22222222-2222-2222-2222-222222222222', 'student@example.com', null);
update profiles set role = 'teacher' where id = '11111111-1111-1111-1111-111111111111';
insert into students (id) values ('22222222-2222-2222-2222-222222222222');

insert into books (position, title) values (2, 'Book 2');
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
select materialize_points((select id from books where position = 2), 1, 128);
insert into lessons_content (book_id, number, first_point, last_point)
  values ((select id from books where position = 2), 10, 53, 60);
insert into blocks (point_id, position, kind, content)
  values ((select id from points where number = 53), 0, 'vocabulary', 'a word');
insert into vocabulary_items (term, first_point_id)
  values ('a word', (select id from points where number = 53));
insert into image_attempts (vocabulary_item_id, provider, status)
  values ((select id from vocabulary_items where term = 'a word'), 'upload', 'generated');
insert into questions (point_id, position, prompt, expected_answer, is_published)
  values ((select id from points where number = 53), 0, 'p', 'a', true);

do $$
declare
  v_books integer;
  v_lessons integer;
  v_points integer;
  v_blocks integer;
  v_vocab integer;
  v_attempts integer;
  v_questions integer;
begin
  perform set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
  set local role authenticated;

  select count(*) into v_books from books;
  select count(*) into v_lessons from lessons_content;
  select count(*) into v_points from points;
  select count(*) into v_blocks from blocks;
  select count(*) into v_vocab from vocabulary_items;
  select count(*) into v_attempts from image_attempts;
  select count(*) into v_questions from questions;

  if v_books <> 0 or v_lessons <> 0 or v_points <> 0 or v_blocks <> 0
     or v_vocab <> 0 or v_attempts <> 0 then
    raise exception
      'criterion 10 failed: student saw books=% lessons=% points=% blocks=% vocabulary=% image_attempts=%',
      v_books, v_lessons, v_points, v_blocks, v_vocab, v_attempts;
  end if;

  if v_questions <> 1 then
    raise exception
      'a published question must still reach the student, saw % rows', v_questions;
  end if;

  raise notice 'criterion 10 passed: content 0 rows, published question reachable';
end;
$$;

do $$
declare
  v_unprotected text;
begin
  select string_agg(tablename, ', ') into v_unprotected
  from pg_tables
  where schemaname = 'public' and not rowsecurity;

  if v_unprotected is not null then
    raise exception 'tables without row level security: %', v_unprotected;
  end if;

  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'stages') then
    raise exception 'stages should have been dropped by 0004';
  end if;

  raise notice 'every table in public has row level security enabled';
end;
$$;

-- Approving twice in a row leaves exactly one approved attempt and the word
-- pointing at the second. This is the invariant the partial unique index
-- holds, and the reason approve_image_attempt demotes before it promotes.
--
-- And the first attempt goes back to being a candidate rather than a
-- refusal: 'generated' with no decided_at, since 0016. Being replaced is not
-- the teacher having looked and said no, and the screen now reads 'rejected'
-- as "discarded, and the file is gone".
do $$
declare
  v_word uuid;
  v_first uuid;
  v_second uuid;
  v_approved integer;
  v_pointer uuid;
  v_path text;
  v_first_status text;
  v_first_decided timestamptz;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;

  select id into v_word from vocabulary_items where term = 'a word';

  insert into image_attempts (vocabulary_item_id, provider, status, storage_path)
    values (v_word, 'upload', 'generated', v_word::text || '/first.png')
    returning id into v_first;
  insert into image_attempts (vocabulary_item_id, provider, status, storage_path)
    values (v_word, 'upload', 'generated', v_word::text || '/second.png')
    returning id into v_second;

  perform approve_image_attempt(v_first);
  perform approve_image_attempt(v_second);

  select count(*) into v_approved
    from image_attempts
   where vocabulary_item_id = v_word and status = 'approved';

  select approved_attempt_id, image_path into v_pointer, v_path
    from vocabulary_items where id = v_word;

  select status, decided_at into v_first_status, v_first_decided
    from image_attempts where id = v_first;

  if v_approved <> 1 then
    raise exception 'two approvals left % approved attempts, expected exactly 1', v_approved;
  end if;

  if v_pointer is distinct from v_second then
    raise exception 'the word points at the wrong attempt after the second approval';
  end if;

  if v_path is distinct from v_word::text || '/second.png' then
    raise exception 'image_path is %, expected the second attempt path', v_path;
  end if;

  if v_first_status <> 'generated' then
    raise exception 'the replaced attempt is %, expected generated', v_first_status;
  end if;

  if v_first_decided is not null then
    raise exception 'the replaced attempt kept a decided_at of %', v_first_decided;
  end if;

  raise notice 'approving twice leaves one approved attempt, pointed at the second';
  raise notice 'and the replaced one is a candidate again, not a refusal';
end;
$$;

-- Reclassifying is not rejecting, since 0021. Moving a word to a kind that
-- carries no picture takes the picture off the word — and leaves the attempt
-- a candidate with its file, rather than marking it refused.
--
-- Both halves are asserted because both are promised. The first is what the
-- teacher is about to do; the second is what the confirmation dialog tells
-- them, in as many words, so that they do not go and generate a replacement
-- for a picture that is still in the list. A screen that says "continua na
-- lista como candidata" over a function that writes 'rejected' — which this
-- product reads as "discarded, and the file is gone" — would be a false
-- sentence the teacher acts on, about the one thing here that can cost
-- fifteen attempts to get back.
do $$
declare
  v_word uuid;
  v_attempt uuid;
  v_status text;
  v_decided timestamptz;
  v_stored text;
  v_pointer uuid;
  v_path text;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;

  insert into vocabulary_items (term, first_point_id)
    values ('a reclassified word', (select id from points where number = 54))
    returning id into v_word;

  insert into image_attempts (vocabulary_item_id, provider, status, storage_path)
    values (v_word, 'upload', 'generated', v_word::text || '/only.png')
    returning id into v_attempt;

  perform approve_image_attempt(v_attempt);
  -- Any kind that carries no picture; usage is one of the two 0018 added.
  perform clear_word_representation(v_word, 'usage');

  select status, decided_at, storage_path
    into v_status, v_decided, v_stored
    from image_attempts where id = v_attempt;

  select approved_attempt_id, image_path into v_pointer, v_path
    from vocabulary_items where id = v_word;

  if v_pointer is not null or v_path is not null then
    raise exception 'reclassified word still points at an image: % / %',
      v_pointer, v_path;
  end if;

  if v_status <> 'generated' then
    raise exception 'the reclassified attempt is %, expected generated', v_status;
  end if;

  if v_decided is not null then
    raise exception 'the reclassified attempt kept a decided_at of %', v_decided;
  end if;

  -- The file is what makes approving it again possible at all, so losing it
  -- would make the dialog's second sentence untrue by another road.
  if v_stored is null then
    raise exception 'the reclassified attempt lost its storage_path';
  end if;

  raise notice 'reclassifying a word takes the picture off the word';
  raise notice 'and leaves the attempt a candidate, with its file: reclassifying is not rejecting';
end;
$$;
