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
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb,
  email_confirmed_at timestamptz
);
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
\i supabase/migrations/0022_contrast_is_between_pictures.sql
\i supabase/migrations/0025_an_upload_is_a_file_not_a_generation.sql
\i supabase/migrations/0026_the_instruction_belongs_to_the_word.sql
\i supabase/migrations/0027_an_answer_has_a_language.sql
\i supabase/migrations/0028_a_question_shows_a_word.sql
\i supabase/migrations/0029_every_row_knows_its_school.sql
\i supabase/migrations/0031_joining_a_school_by_invite.sql
\i supabase/migrations/0032_an_invite_waits_for_a_yes.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'teacher@example.com', '{"full_name":"Teacher"}'),
  ('22222222-2222-2222-2222-222222222222', 'student@example.com', null);
-- Since 0029 the teacher is a platform admin and admin of Chelsea St, and the
-- student is a Chelsea St student: the roles live in school_members.
insert into platform_admins (user_id) values ('11111111-1111-1111-1111-111111111111');
insert into school_members (school_id, user_id, role) values
  ((select id from schools where slug = 'chelsea-st'), '11111111-1111-1111-1111-111111111111', 'admin'),
  ((select id from schools where slug = 'chelsea-st'), '22222222-2222-2222-2222-222222222222', 'student');
insert into students (id, school_id)
  values ('22222222-2222-2222-2222-222222222222', (select id from schools where slug = 'chelsea-st'));

insert into books (position, title) values (2, 'Book 2');
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
select materialize_points((select id from books where position = 2), 1, 128);
insert into lessons_content (book_id, number, first_point, last_point)
  values ((select id from books where position = 2), 10, 53, 60);
insert into blocks (point_id, position, kind, content)
  values ((select id from points where number = 53), 0, 'vocabulary', 'a word');
insert into vocabulary_items (term, first_point_id)
  values ('a word', (select id from points where number = 53));
insert into image_attempts
  (vocabulary_item_id, provider, status, storage_path, credits_spent, completed_at)
  values ((select id from vocabulary_items where term = 'a word'), 'upload', 'generated',
          'fixture/only.png', 0, now());
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

  insert into image_attempts (vocabulary_item_id, provider, status, storage_path, credits_spent, completed_at)
    values (v_word, 'upload', 'generated', v_word::text || '/first.png', 0, now())
    returning id into v_first;
  insert into image_attempts (vocabulary_item_id, provider, status, storage_path, credits_spent, completed_at)
    values (v_word, 'upload', 'generated', v_word::text || '/second.png', 0, now())
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

  insert into image_attempts (vocabulary_item_id, provider, status, storage_path, credits_spent, completed_at)
    values (v_word, 'upload', 'generated', v_word::text || '/only.png', 0, now())
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

-- Contrast sets, since 0022. Seven words at point 55 and two sets saved the
-- way the screen saves them, through save_contrast_set: a pair (large,
-- small) and a trio (in, on, under). black and white stay free for the
-- blocks that try to build a set the database must refuse.
--
-- Most blocks below force the deferred checks with `set constraints all
-- immediate`, so a refusal surfaces inside the block that provoked it, with
-- its own message, rather than at the commit of the whole statement.
insert into vocabulary_items (term, first_point_id)
select term, (select id from points where number = 55)
  from unnest(array['large', 'small', 'in', 'on', 'under', 'black', 'white']) as term;

do $$
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;

  perform save_contrast_set(array(
    select id from vocabulary_items where term in ('large', 'small') order by term));
  perform save_contrast_set(array(
    select id from vocabulary_items where term in ('in', 'on', 'under')
     order by array_position(array['in', 'on', 'under'], term)));
end;
$$;

-- The student reads no contrast set and no member, and is not refused for
-- trying: the same case as vocabulary_items, one teacher policy and nothing
-- for her. The teacher's counts come first, so a zero from the student
-- cannot be a zero from an empty table.
do $$
declare
  v_sets integer;
  v_items integer;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;
  select count(*) into v_sets from contrast_sets;
  select count(*) into v_items from contrast_set_items;
  if v_sets <> 2 or v_items <> 5 then
    raise exception 'the teacher sees % sets and % members, expected 2 and 5', v_sets, v_items;
  end if;

  perform set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
  select count(*) into v_sets from contrast_sets;
  select count(*) into v_items from contrast_set_items;
  if v_sets <> 0 or v_items <> 0 then
    raise exception 'the student sees % contrast sets and % members, expected none', v_sets, v_items;
  end if;

  raise notice 'the student reads no contrast set and no member';
end;
$$;

-- A set with one member is refused, whatever path wrote it. Written here
-- straight into the tables, not through save_contrast_set, because the
-- function refuses it first and would hide whether the trigger does.
do $$
declare
  v_set uuid;
  v_refused boolean := false;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;

  begin
    insert into contrast_sets default values returning id into v_set;
    insert into contrast_set_items (vocabulary_item_id, set_id, position)
      values ((select id from vocabulary_items where term = 'black'), v_set, 0);
    set constraints all immediate;
  exception when check_violation then
    if sqlerrm not like '%needs at least two%' then
      raise;
    end if;
    v_refused := true;
  end;

  if not v_refused then
    raise exception 'a contrast set with one member was accepted';
  end if;

  raise notice 'a contrast set with one member is refused';
end;
$$;

-- A set with no members is refused too. It fires nothing on
-- contrast_set_items, which is why contrast_sets carries a trigger of its own.
do $$
declare
  v_refused boolean := false;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;

  begin
    insert into contrast_sets default values;
    set constraints all immediate;
  exception when check_violation then
    if sqlerrm not like '%has 0 member(s)%' then
      raise;
    end if;
    v_refused := true;
  end;

  if not v_refused then
    raise exception 'a contrast set with no members was accepted';
  end if;

  raise notice 'a contrast set with no members is refused';
end;
$$;

-- A word is in at most one set. Straight into the tables again: small already
-- belongs to the pair, and save_contrast_set would refuse it by name before
-- the key had a say.
do $$
declare
  v_set uuid;
  v_refused boolean := false;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;

  begin
    insert into contrast_sets default values returning id into v_set;
    insert into contrast_set_items (vocabulary_item_id, set_id, position) values
      ((select id from vocabulary_items where term = 'black'), v_set, 0),
      ((select id from vocabulary_items where term = 'small'), v_set, 1);
    set constraints all immediate;
  exception when unique_violation then
    v_refused := true;
  end;

  if not v_refused then
    raise exception 'a word was accepted into a second contrast set';
  end if;

  raise notice 'a word already in a contrast set cannot join a second one';
end;
$$;

-- A word in a set cannot be deleted: it has to leave its set first. Tried on
-- a member of the trio, where a cascade would leave two members and pass
-- every other check, so only the restrict stands between the delete and a
-- set that shrank without anyone deciding it.
do $$
declare
  v_refused boolean := false;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;

  begin
    delete from vocabulary_items where term = 'under';
    set constraints all immediate;
  exception when foreign_key_violation then
    v_refused := true;
  end;

  if not v_refused then
    raise exception 'a word in a contrast set was deleted';
  end if;

  raise notice 'a word in a contrast set cannot be deleted';
end;
$$;

-- save_contrast_set reorders a set and writes the positions 0 to n - 1 in
-- the order given. And a swap in place, in one statement, is accepted: the
-- unique on (set_id, position) is deferred, and without that every reorder
-- written as an update collides with itself halfway.
do $$
declare
  v_set uuid;
  v_large integer;
  v_small integer;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;

  select set_id into v_set from contrast_set_items
   where vocabulary_item_id = (select id from vocabulary_items where term = 'large');

  perform save_contrast_set(
    array[
      (select id from vocabulary_items where term = 'small'),
      (select id from vocabulary_items where term = 'large')],
    v_set,
    -- What is there, read the way the screen reads it before saving.
    array(select vocabulary_item_id from contrast_set_items
           where set_id = v_set order by position));
  set constraints all immediate;

  select position into v_small from contrast_set_items
   where vocabulary_item_id = (select id from vocabulary_items where term = 'small');
  select position into v_large from contrast_set_items
   where vocabulary_item_id = (select id from vocabulary_items where term = 'large');
  if v_small is distinct from 0 or v_large is distinct from 1 then
    raise exception 'after saving (small, large) the positions are small=% large=%, expected 0 and 1',
      v_small, v_large;
  end if;

  update contrast_set_items set position = 1 - position where set_id = v_set;
  set constraints all immediate;

  select position into v_small from contrast_set_items
   where vocabulary_item_id = (select id from vocabulary_items where term = 'small');
  select position into v_large from contrast_set_items
   where vocabulary_item_id = (select id from vocabulary_items where term = 'large');
  if v_small is distinct from 1 or v_large is distinct from 0 then
    raise exception 'after the swap the positions are small=% large=%, expected 1 and 0',
      v_small, v_large;
  end if;

  raise notice 'save_contrast_set reorders a set and writes positions 0 to n - 1';
  raise notice 'and two positions swap in place in one statement';
end;
$$;

-- Positions are dense: a gap is refused, whatever path wrote it.
do $$
declare
  v_refused boolean := false;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;

  begin
    update contrast_set_items set position = 5
     where vocabulary_item_id = (select id from vocabulary_items where term = 'small');
    set constraints all immediate;
  exception when check_violation then
    if sqlerrm not like '%must run 0 to%' then
      raise;
    end if;
    v_refused := true;
  end;

  if not v_refused then
    raise exception 'a contrast set with a gap in its positions was accepted';
  end if;

  raise notice 'a gap in the positions of a contrast set is refused';
end;
$$;

-- Saving from a stale view is refused, and nothing is written. The pair is
-- (large, small) here, after the swap above; a screen still showing it as
-- (small, large), which is what it was before the swap, tries to save. Were
-- this accepted, a save made in one tab would silently undo whatever another
-- tab saved in between. Saving an existing set without saying what was
-- loaded is refused the same way: there is no saving blind.
--
-- Only CS001 is caught. Any other error means the save was refused for some
-- other reason, which is not what this proves, so it stops the script.
--
-- No `set constraints all immediate` here, unlike the blocks above: CS001 is
-- raised before anything is written, so there is nothing deferred to force,
-- and immediate mode would outlive a save that wrongly succeeded and make the
-- next one fail on its own delete, hiding the real finding.
do $$
declare
  v_set uuid;
  v_large uuid;
  v_small uuid;
  v_members uuid[];
  v_stale boolean := false;
  v_blind boolean := false;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;

  select id into v_large from vocabulary_items where term = 'large';
  select id into v_small from vocabulary_items where term = 'small';
  select set_id into v_set from contrast_set_items where vocabulary_item_id = v_large;

  begin
    perform save_contrast_set(array[v_small, v_large], v_set, array[v_small, v_large]);
  exception when sqlstate 'CS001' then
    v_stale := true;
  end;

  begin
    perform save_contrast_set(array[v_small, v_large], v_set);
  exception when sqlstate 'CS001' then
    v_blind := true;
  end;

  v_members := array(
    select vocabulary_item_id from contrast_set_items
     where set_id = v_set order by position);

  if not v_stale then
    raise exception 'a save made from a stale view of the set was accepted';
  end if;

  if not v_blind then
    raise exception 'a save of an existing set with no expected members was accepted';
  end if;

  if v_members is distinct from array[v_large, v_small] then
    raise exception 'the refused saves changed the set anyway';
  end if;

  raise notice 'saving a contrast set from a stale view is refused, and the set is untouched';
  raise notice 'and saving an existing set without the expected members is refused too';
end;
$$;

-- Dissolving a set takes its members with it, and the trigger does not hold
-- the deleted set to having two. The words themselves stay.
do $$
declare
  v_set uuid;
  v_members integer;
  v_words integer;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;

  select set_id into v_set from contrast_set_items
   where vocabulary_item_id = (select id from vocabulary_items where term = 'in');

  perform dissolve_contrast_set(v_set);
  set constraints all immediate;

  select count(*) into v_members from contrast_set_items where set_id = v_set;
  select count(*) into v_words from vocabulary_items where term in ('in', 'on', 'under');

  if exists (select 1 from contrast_sets where id = v_set) or v_members <> 0 then
    raise exception 'the dissolved set is still there, with % members', v_members;
  end if;

  if v_words <> 3 then
    raise exception 'dissolving the set took % of its 3 words with it', 3 - v_words;
  end if;

  raise notice 'dissolving a contrast set takes its members and leaves the words';
end;
$$;

-- The student calling save_contrast_set writes nothing: the function, being
-- security invoker, gives her no way to write that she lacks outside it.
--
-- What refuses her here is visibility, not the write policies: she sees no
-- word, so the function stops at "not a known vocabulary item" before any
-- insert. That is why this block proves the function and not the policies,
-- and why the block after it goes to the tables directly.
do $$
declare
  v_before integer;
  v_after integer;
  v_refused boolean := false;
  v_words uuid[];
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;
  select count(*) into v_before from contrast_sets;
  -- Read as the teacher: the student sees no word, and a call made with ids
  -- she invented would be refused for that reason alone.
  v_words := array(select id from vocabulary_items where term in ('black', 'white'));

  perform set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
  begin
    perform save_contrast_set(v_words);
    set constraints all immediate;
  exception when others then
    v_refused := true;
  end;

  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  select count(*) into v_after from contrast_sets;

  if not v_refused or v_after <> v_before then
    raise exception 'the student saved a contrast set: % sets before, % after', v_before, v_after;
  end if;

  raise notice 'the student cannot save a contrast set';
end;
$$;

-- The write policies themselves: the student inserting straight into each
-- table is refused by row level security. Only insufficient_privilege (42501)
-- is caught; any other error, a foreign key or the trigger, would mean the
-- insert got past the policy, and stops the script.
--
-- The ids are read as the teacher first, so the member row she tries to
-- insert is one that would be valid in every other respect: black, joining
-- the pair at its next free position.
do $$
declare
  v_set uuid;
  v_black uuid;
  v_set_refused boolean := false;
  v_item_refused boolean := false;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;
  select id into v_black from vocabulary_items where term = 'black';
  select set_id into v_set from contrast_set_items
   where vocabulary_item_id = (select id from vocabulary_items where term = 'large');

  perform set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);

  begin
    insert into contrast_sets default values;
  exception when insufficient_privilege then
    v_set_refused := true;
  end;

  begin
    insert into contrast_set_items (vocabulary_item_id, set_id, position)
      values (v_black, v_set, 2);
  exception when insufficient_privilege then
    v_item_refused := true;
  end;

  if not v_set_refused then
    raise exception 'the student inserted a contrast set';
  end if;

  if not v_item_refused then
    raise exception 'the student inserted a contrast set member';
  end if;

  raise notice 'the student cannot insert a contrast set';
  raise notice 'nor a contrast set member';
end;
$$;

-- An upload is a file, not a generation, since 0025.
--
-- Each case names the constraint that has to refuse it, and the name is
-- checked: a refusal by some other check would leave these green with the one
-- under test removed. The failures are gathered and raised together at the
-- end, so taking one clause out of 0025 shows every assertion that rests on
-- it, not only the first.
--
-- The helpers live in a schema of their own so they stay out of the types,
-- which are generated from public.
create schema verify;
grant usage on schema verify to authenticated;

create table verify.failures (what text not null);
grant insert, select on verify.failures to authenticated;

-- The name of the check that refused a statement, or null when it went in.
create function verify.refused_by(p_sql text) returns text
language plpgsql as $$
declare
  v_name text;
begin
  execute p_sql;
  return null;
exception when check_violation then
  get stacked diagnostics v_name = constraint_name;
  return v_name;
end;
$$;

create function verify.expect_refused(p_what text, p_constraint text, p_sql text)
returns void
language plpgsql as $$
declare
  v_by text := verify.refused_by(p_sql);
begin
  if v_by is null then
    insert into verify.failures values (format('%s: accepted', p_what));
  elsif v_by <> p_constraint then
    insert into verify.failures
      values (format('%s: refused by %s, expected %s', p_what, v_by, p_constraint));
  else
    raise notice '%: refused by %', p_what, v_by;
  end if;
end;
$$;

do $$
declare
  v_word uuid;
  v_kept uuid;
  v_binned uuid;
  v_failures text;
  -- A well formed upload, with one column at a time replaced below.
  c_cols constant text :=
    'vocabulary_item_id, provider, status, storage_path, credits_spent, completed_at';
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;

  insert into vocabulary_items (term, first_point_id)
    values ('an uploaded word', (select id from points where number = 54))
    returning id into v_word;

  -- What is refused, and by which constraint.
  perform verify.expect_refused('a provider spelled Upload',
    'image_attempts_provider_known',
    format('insert into image_attempts (%s) values (%L, ''Upload'', ''generated'', ''w/a.png'', 0, now())',
      c_cols, v_word));

  perform verify.expect_refused('a source_filename on a generated attempt',
    'image_attempts_filename_only_on_upload',
    format('insert into image_attempts (vocabulary_item_id, provider, model, status, source_filename)
            values (%L, ''freepik'', ''mystic'', ''pending'', ''scene.png'')', v_word));

  perform verify.expect_refused('an empty source_filename',
    'image_attempts_filename_not_blank',
    format('insert into image_attempts (%s, source_filename) values (%L, ''upload'', ''generated'', ''w/a.png'', 0, now(), '''')',
      c_cols, v_word));

  perform verify.expect_refused('a blank source_filename',
    'image_attempts_filename_not_blank',
    format('insert into image_attempts (%s, source_filename) values (%L, ''upload'', ''generated'', ''w/a.png'', 0, now(), ''   '')',
      c_cols, v_word));

  perform verify.expect_refused('a pending upload',
    'image_attempts_upload_shape',
    format('insert into image_attempts (%s) values (%L, ''upload'', ''pending'', ''w/a.png'', 0, now())',
      c_cols, v_word));

  perform verify.expect_refused('a failed upload',
    'image_attempts_upload_shape',
    format('insert into image_attempts (%s) values (%L, ''upload'', ''failed'', ''w/a.png'', 0, now())',
      c_cols, v_word));

  perform verify.expect_refused('a generated upload with no file',
    'image_attempts_upload_shape',
    format('insert into image_attempts (%s) values (%L, ''upload'', ''generated'', null, 0, now())',
      c_cols, v_word));

  perform verify.expect_refused('an upload naming a model',
    'image_attempts_upload_shape',
    format('insert into image_attempts (%s, model) values (%L, ''upload'', ''generated'', ''w/a.png'', 0, now(), ''mystic'')',
      c_cols, v_word));

  perform verify.expect_refused('an upload naming a provider task',
    'image_attempts_upload_shape',
    format('insert into image_attempts (%s, provider_request_id) values (%L, ''upload'', ''generated'', ''w/a.png'', 0, now(), ''mystic:task'')',
      c_cols, v_word));

  perform verify.expect_refused('an upload carrying a prompt',
    'image_attempts_upload_shape',
    format('insert into image_attempts (%s, prompt) values (%L, ''upload'', ''generated'', ''w/a.png'', 0, now(), ''a flat picture'')',
      c_cols, v_word));

  perform verify.expect_refused('an upload naming a reference',
    'image_attempts_upload_shape',
    format('insert into image_attempts (%s, reference_path) values (%L, ''upload'', ''generated'', ''w/a.png'', 0, now(), ''references/w/r.png'')',
      c_cols, v_word));

  perform verify.expect_refused('an upload carrying an error',
    'image_attempts_upload_shape',
    format('insert into image_attempts (%s, error) values (%L, ''upload'', ''generated'', ''w/a.png'', 0, now(), ''FAILED'')',
      c_cols, v_word));

  perform verify.expect_refused('an upload with no completed_at',
    'image_attempts_upload_shape',
    format('insert into image_attempts (%s) values (%L, ''upload'', ''generated'', ''w/a.png'', 0, null)',
      c_cols, v_word));

  perform verify.expect_refused('an upload with a null cost',
    'image_attempts_upload_shape',
    format('insert into image_attempts (%s) values (%L, ''upload'', ''generated'', ''w/a.png'', null, now())',
      c_cols, v_word));

  perform verify.expect_refused('an upload that cost credits',
    'image_attempts_upload_shape',
    format('insert into image_attempts (%s) values (%L, ''upload'', ''generated'', ''w/a.png'', 50, now())',
      c_cols, v_word));

  -- The same rules hold on the way there, not only on the way in.
  insert into image_attempts
    (vocabulary_item_id, provider, status, storage_path, credits_spent, completed_at, source_filename)
    values (v_word, 'upload', 'generated', v_word::text || '/kept.png', 0, now(), 'kept.png')
    returning id into v_kept;

  perform verify.expect_refused('an upload moved to pending',
    'image_attempts_upload_shape',
    format('update image_attempts set status = ''pending'' where id = %L', v_kept));

  perform verify.expect_refused('an upload moved to failed',
    'image_attempts_upload_shape',
    format('update image_attempts set status = ''failed'' where id = %L', v_kept));

  perform verify.expect_refused('an upload losing its file while still generated',
    'image_attempts_upload_shape',
    format('update image_attempts set storage_path = null where id = %L', v_kept));

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'upload shape: %', v_failures;
  end if;

  -- What is accepted. The bin as rejectAttempt runs it on an upload: marked
  -- rejected, then the path cleared once the file is gone. Without the
  -- 'rejected' exception in 0025 the second step would fail in production.
  insert into image_attempts
    (vocabulary_item_id, provider, status, storage_path, credits_spent, completed_at)
    values (v_word, 'upload', 'generated', v_word::text || '/binned.png', 0, now())
    returning id into v_binned;
  update image_attempts set status = 'rejected', decided_at = now() where id = v_binned;
  update image_attempts set storage_path = null where id = v_binned;

  -- A generation still opens with no cost and no stamp: credits_spent is
  -- written once the provider accepts the task, completed_at once it ends.
  -- None of the upload rules reach it.
  insert into image_attempts (vocabulary_item_id, provider, model, prompt, status)
    values (v_word, 'freepik', 'mystic', 'a flat picture', 'pending');

  -- An upload may say what it was made from: the upload shape leaves
  -- subject free, and the screen writes it when the teacher fills it in.
  insert into image_attempts
    (vocabulary_item_id, provider, status, storage_path, credits_spent, completed_at, subject)
    values (v_word, 'upload', 'generated', v_word::text || '/told.png', 0, now(), 'a red apple');

  -- And the kept upload approves. The approval rules themselves are asserted
  -- once, near the top, on uploads already.
  perform approve_image_attempt(v_kept);

  raise notice 'a discarded upload loses its file and stays, as the bin leaves it';
  raise notice 'a generation still opens with no cost';
  raise notice 'a well formed upload is accepted and approves';
  raise notice 'an upload may carry the instruction it was made from';
end;
$$;

-- A word's instruction is null or text, never blank, since 0026. Checked by
-- the name of the constraint that refuses, like the upload shape above, and
-- on update as well as insert: the screen writes it by update.
do $$
declare
  v_word uuid;
  v_failures text;
begin
  delete from verify.failures;
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;

  insert into vocabulary_items (term, first_point_id)
    values ('an instructed word', (select id from points where number = 54))
    returning id into v_word;

  perform verify.expect_refused('an empty image_subject',
    'vocabulary_items_image_subject_not_blank',
    format('update vocabulary_items set image_subject = '''' where id = %L', v_word));

  perform verify.expect_refused('a blank image_subject',
    'vocabulary_items_image_subject_not_blank',
    format('update vocabulary_items set image_subject = ''   '' where id = %L', v_word));

  perform verify.expect_refused('a word inserted with a blank image_subject',
    'vocabulary_items_image_subject_not_blank',
    format('insert into vocabulary_items (term, first_point_id, image_subject)
            values (''a blank word'', (select id from points where number = 54), '' '')'));

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'image subject: %', v_failures;
  end if;

  -- What is accepted: text, and back to null.
  update vocabulary_items set image_subject = 'a red apple' where id = v_word;
  update vocabulary_items set image_subject = null where id = v_word;

  raise notice 'a word takes an instruction and gives it up';
end;
$$;

-- An answer has a language, since 0027: English unless said otherwise, never
-- null, and one of the two the type lists.
--
-- The column is an enum, so no check constraint refuses and there is no
-- constraint name to compare. What is compared instead is the SQLSTATE and
-- what the error names: the column for a null, the type for a value outside
-- it. Any other refusal would leave these green with the clause under test
-- removed.
create function verify.refusal(p_sql text) returns text
language plpgsql as $$
declare
  v_state text;
  v_column text;
  v_message text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics
    v_state = returned_sqlstate,
    v_column = column_name,
    v_message = message_text;
  return v_state || ' ' || coalesce(nullif(v_column, ''), v_message);
end;
$$;

create function verify.expect_refusal(p_what text, p_refusal text, p_sql text)
returns void
language plpgsql as $$
declare
  v_by text := verify.refusal(p_sql);
begin
  if v_by is null then
    insert into verify.failures values (format('%s: accepted', p_what));
  elsif v_by <> p_refusal then
    insert into verify.failures
      values (format('%s: refused with %s, expected %s', p_what, v_by, p_refusal));
  else
    raise notice '%: refused with %', p_what, v_by;
  end if;
end;
$$;

do $$
declare
  v_point uuid;
  v_question uuid;
  v_language text;
  v_failures text;
  c_unknown constant text :=
    '22P02 invalid input value for enum answer_language: "fr"';
begin
  delete from verify.failures;
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;
  select id into v_point from points where number = 57;

  -- A question written without naming the column, the way every caller that
  -- predates it does.
  insert into questions (point_id, position, prompt, expected_answer)
    values (v_point, 0, 'a question', 'an answer')
    returning id, answer_language into v_question, v_language;
  if v_language is distinct from 'en' then
    raise exception 'a question with no language said is %, expected en', v_language;
  end if;

  perform verify.expect_refusal('a question inserted with a null language',
    '23502 answer_language',
    format('insert into questions (point_id, position, prompt, expected_answer, answer_language)
            values (%L, 1, ''q'', ''a'', null)', v_point));

  perform verify.expect_refusal('a language set to null',
    '23502 answer_language',
    format('update questions set answer_language = null where id = %L', v_question));

  perform verify.expect_refusal('a question inserted in a language outside the type',
    c_unknown,
    format('insert into questions (point_id, position, prompt, expected_answer, answer_language)
            values (%L, 1, ''q'', ''a'', ''fr'')', v_point));

  perform verify.expect_refusal('a language set outside the type',
    c_unknown,
    format('update questions set answer_language = ''fr'' where id = %L', v_question));

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'answer language: %', v_failures;
  end if;

  -- What is accepted: Portuguese, on the way in and by update, and back.
  insert into questions (point_id, position, prompt, expected_answer, answer_language)
    values (v_point, 1, 'a translation', 'uma resposta', 'pt');
  update questions set answer_language = 'pt' where id = v_question;
  update questions set answer_language = 'en' where id = v_question;

  raise notice 'a question is in English unless said otherwise';
  raise notice 'and takes Portuguese, on insert and on update';
end;
$$;

-- The order of a point's questions is written whole, since 0027. Three
-- questions at point 56, named by their prompts.
insert into questions (point_id, position, prompt, expected_answer)
select (select id from points where number = 56), n, prompt, 'an answer'
  from unnest(array['first', 'second', 'third']) with ordinality as q(prompt, n0),
       lateral (select (n0 - 1)::integer as n) as numbered;

-- The order of point 56, as the prompts in position order with each
-- position: 'first=0 second=1 third=2'.
create function verify.order_of_56() returns text
language sql as $$
  select coalesce(string_agg(prompt || '=' || position, ' ' order by position), '')
    from questions
   where point_id = (select id from points where number = 56);
$$;

-- reorder_questions writes positions 0 to n - 1 in the order given, starting
-- from a point with a gap in it, and trades two neighbours. The second is
-- what two plain updates cannot do: the first of them lands on the position
-- the second still holds, and questions_point_id_position_key refuses it.
do $$
declare
  v_point uuid;
  v_first uuid;
  v_second uuid;
  v_third uuid;
  v_order text;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;
  select id into v_point from points where number = 56;
  select id into v_first from questions where point_id = v_point and prompt = 'first';
  select id into v_second from questions where point_id = v_point and prompt = 'second';
  select id into v_third from questions where point_id = v_point and prompt = 'third';

  -- A gap, as a row written straight into the table can leave one.
  update questions set position = 7 where id = v_third;

  perform reorder_questions(v_point, array[v_third, v_first, v_second]);
  v_order := verify.order_of_56();
  if v_order <> 'third=0 first=1 second=2' then
    raise exception 'after ordering (third, first, second) the point reads: %', v_order;
  end if;

  perform reorder_questions(v_point, array[v_first, v_third, v_second]);
  v_order := verify.order_of_56();
  if v_order <> 'first=0 third=1 second=2' then
    raise exception 'after trading the first two the point reads: %', v_order;
  end if;

  raise notice 'reorder_questions writes positions 0 to n - 1 in the order given';
  raise notice 'and two neighbours trade places';
end;
$$;

-- A list that is not exactly the point's questions is refused with QS001 and
-- nothing is written. Two clauses hold that, and each case below gets past
-- one of them and is stopped by the other: a list one short has only
-- questions of the point in it, and a list of the right length with a
-- stranger in it has the right count. A repeated id and a null are the
-- second case again.
--
-- Only QS001 is caught: any other error would mean the list was refused for
-- some other reason, or got as far as the updates, and stops the script.
do $$
declare
  v_point uuid;
  v_first uuid;
  v_second uuid;
  v_third uuid;
  v_stranger uuid;
  v_before text;
  v_short boolean := false;
  v_foreign boolean := false;
  v_repeated boolean := false;
  v_null boolean := false;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;
  select id into v_point from points where number = 56;
  select id into v_first from questions where point_id = v_point and prompt = 'first';
  select id into v_second from questions where point_id = v_point and prompt = 'second';
  select id into v_third from questions where point_id = v_point and prompt = 'third';
  -- A question of another point: the one this script opens with, at 53.
  select id into v_stranger from questions where prompt = 'p';
  v_before := verify.order_of_56();

  begin
    perform reorder_questions(v_point, array[v_second, v_first]);
  exception when sqlstate 'QS001' then
    v_short := true;
  end;

  begin
    perform reorder_questions(v_point, array[v_second, v_first, v_stranger]);
  exception when sqlstate 'QS001' then
    v_foreign := true;
  end;

  begin
    perform reorder_questions(v_point, array[v_second, v_first, v_first]);
  exception when sqlstate 'QS001' then
    v_repeated := true;
  end;

  begin
    perform reorder_questions(v_point, array[v_second, v_first, null]);
  exception when sqlstate 'QS001' then
    v_null := true;
  end;

  if not v_short then
    raise exception 'an order that leaves a question of the point out was accepted';
  end if;

  if not v_foreign then
    raise exception 'an order naming a question of another point was accepted';
  end if;

  if not v_repeated then
    raise exception 'an order naming a question twice was accepted';
  end if;

  if not v_null then
    raise exception 'an order with a null in it was accepted';
  end if;

  if verify.order_of_56() <> v_before then
    raise exception 'the refused orders changed the point anyway: %', verify.order_of_56();
  end if;

  raise notice 'an order that is not exactly the point''s questions is refused, and nothing moves';
end;
$$;

-- delete_question deletes and closes the gap. The one in the middle goes
-- (the point reads first, third, second), so a delete that only deleted
-- would leave 0 and 2.
do $$
declare
  v_point uuid;
  v_order text;
  v_unknown boolean := false;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;
  select id into v_point from points where number = 56;

  perform delete_question(
    (select id from questions where point_id = v_point and prompt = 'third'));
  v_order := verify.order_of_56();
  if v_order <> 'first=0 second=1' then
    raise exception 'after deleting the middle question the point reads: %', v_order;
  end if;

  begin
    perform delete_question('99999999-9999-9999-9999-999999999999');
  exception when raise_exception then
    if sqlerrm not like 'question % not found' then
      raise;
    end if;
    v_unknown := true;
  end;

  if not v_unknown then
    raise exception 'deleting a question that does not exist said nothing';
  end if;

  raise notice 'delete_question closes the gap it leaves';
  raise notice 'and says so when there is nothing to delete';
end;
$$;

-- The student can call neither. Both questions of point 56 are published
-- first, so she sees them and the list she sends is exactly the point's: the
-- only thing left to refuse her is the teacher check, and without it the
-- call would return as if it had worked, having written nothing.
--
-- Only insufficient_privilege (42501) is caught; any other error stops the
-- script.
do $$
declare
  v_point uuid;
  v_first uuid;
  v_second uuid;
  v_seen integer;
  v_order_refused boolean := false;
  v_delete_refused boolean := false;
  v_order text;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;
  select id into v_point from points where number = 56;
  select id into v_first from questions where point_id = v_point and prompt = 'first';
  select id into v_second from questions where point_id = v_point and prompt = 'second';
  update questions set is_published = true where point_id = v_point;

  perform set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
  select count(*) into v_seen from questions where point_id = v_point;
  if v_seen <> 2 then
    raise exception 'the student sees % of the 2 published questions of the point', v_seen;
  end if;

  begin
    perform reorder_questions(v_point, array[v_second, v_first]);
  exception when insufficient_privilege then
    v_order_refused := true;
  end;

  begin
    perform delete_question(v_first);
  exception when insufficient_privilege then
    v_delete_refused := true;
  end;

  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  v_order := verify.order_of_56();

  if not v_order_refused then
    raise exception 'the student ordered the questions of a point';
  end if;

  if not v_delete_refused then
    raise exception 'the student deleted a question';
  end if;

  if v_order <> 'first=0 second=1' then
    raise exception 'the refused calls changed the point anyway: %', v_order;
  end if;

  raise notice 'the student cannot order the questions of a point';
  raise notice 'nor delete one';
end;
$$;

-- A question shows a word, since 0028: a nullable reference to
-- vocabulary_items, on delete restrict.
--
-- Each refusal names the constraint that has to make it, and the name is
-- checked, for the reason given above verify.refused_by: a refusal by
-- something else would leave these green with the reference removed. Only a
-- foreign key violation is caught; any other error stops the script.
create function verify.foreign_key_refusal(p_sql text) returns text
language plpgsql as $$
declare
  v_name text;
begin
  execute p_sql;
  return null;
exception when foreign_key_violation then
  get stacked diagnostics v_name = constraint_name;
  return v_name;
end;
$$;

create function verify.expect_foreign_key(p_what text, p_constraint text, p_sql text)
returns void
language plpgsql as $$
declare
  v_by text := verify.foreign_key_refusal(p_sql);
begin
  if v_by is null then
    insert into verify.failures values (format('%s: accepted', p_what));
  elsif v_by <> p_constraint then
    insert into verify.failures
      values (format('%s: refused by %s, expected %s', p_what, v_by, p_constraint));
  else
    raise notice '%: refused by %', p_what, v_by;
  end if;
end;
$$;

-- Two words at point 58, in no contrast set and with no attempt, so the only
-- thing that can hold either of them is a question that shows it.
insert into vocabulary_items (term, first_point_id)
select term, (select id from points where number = 58)
  from unnest(array['shown word', 'other word']) as w(term);

do $$
declare
  v_point uuid;
  v_shown uuid;
  v_other uuid;
  v_first uuid;
  v_second uuid;
  v_action "char";
  v_left integer;
  v_failures text;
  c_fkey constant text := 'questions_shown_vocabulary_item_id_fkey';
  c_nowhere constant uuid := '99999999-9999-9999-9999-999999999999';
begin
  delete from verify.failures;
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;
  select id into v_point from points where number = 58;
  select id into v_shown from vocabulary_items where term = 'shown word';
  select id into v_other from vocabulary_items where term = 'other word';

  -- A question written without naming the column, the way every caller that
  -- predates it does. That it goes in is the assertion: with the column not
  -- null this insert is refused, as is the first question this script
  -- inserts, far above.
  insert into questions (point_id, position, prompt, expected_answer)
    values (v_point, 0, 'asked of the room', 'an answer')
    returning id into v_first;

  -- At a position nothing else takes: accepted by mistake, the row is
  -- reported with the other failures instead of colliding with the insert
  -- further down.
  perform verify.expect_foreign_key(
    'a question inserted showing a word that does not exist', c_fkey,
    format('insert into questions
              (point_id, position, prompt, expected_answer, shown_vocabulary_item_id)
            values (%L, 9, ''q'', ''a'', %L)', v_point, c_nowhere));

  perform verify.expect_foreign_key(
    'a question pointed at a word that does not exist', c_fkey,
    format('update questions set shown_vocabulary_item_id = %L where id = %L',
           c_nowhere, v_first));

  -- What is accepted: a word that exists, by update and on the way in, and
  -- the same word under two questions.
  update questions set shown_vocabulary_item_id = v_shown where id = v_first;
  insert into questions
      (point_id, position, prompt, expected_answer, shown_vocabulary_item_id)
    values (v_point, 1, 'asked of the picture', 'an answer', v_shown)
    returning id into v_second;

  perform verify.expect_foreign_key(
    'deleting a word a question shows', c_fkey,
    format('delete from vocabulary_items where id = %L', v_shown));

  -- Refused means nothing moved: the word is there, and both questions are
  -- there and still show it. A cascade would have taken the questions and a
  -- set null the link, and either would have let the delete through above.
  select count(*) into v_left from questions
   where id in (v_first, v_second) and shown_vocabulary_item_id = v_shown;
  if v_left <> 2
     or not exists (select 1 from vocabulary_items where id = v_shown) then
    insert into verify.failures values (format(
      'after the delete of a shown word, %s of 2 questions still show it', v_left));
  end if;

  -- restrict and no action refuse the same delete with the same error, and
  -- the constraint is not deferrable, so nothing a statement does tells them
  -- apart. What 0028 wrote is read from the catalog: 'r' is restrict.
  select confdeltype into v_action from pg_constraint
   where conname = c_fkey and conrelid = 'public.questions'::regclass;
  if v_action is distinct from 'r' then
    insert into verify.failures values (format(
      '%s is on delete %s, expected r (restrict)', c_fkey, coalesce(v_action::text, 'missing')));
  end if;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'a question shows a word: %', v_failures;
  end if;

  -- The way out is deliberate: point the questions elsewhere, or at nothing,
  -- and the word can go. This also shows the reference was the only thing
  -- holding it.
  update questions set shown_vocabulary_item_id = v_other where id = v_first;
  update questions set shown_vocabulary_item_id = null where id = v_second;
  delete from vocabulary_items where id = v_shown;
  if exists (select 1 from vocabulary_items where id = v_shown) then
    raise exception 'a word no question shows any more could not be deleted';
  end if;

  raise notice 'a question shows no word unless told, and takes one on insert and on update';
  raise notice 'and a word is held only while a question shows it';
end;
$$;

-- The student still sees only what is published, with the new column on the
-- row. Point 58 holds two questions that show a word: one published, one not.
-- She reads the published one and not the other, and she can neither take
-- the word off the question she sees nor insert one of her own that shows a
-- word. That she reads no word at all is criterion 10, at the top.
--
-- Her update does not raise: the policy filters the rows, so it matches
-- nothing and returns as if it had worked. What is checked is what the row
-- holds afterwards, read as the teacher.
do $$
declare
  v_point uuid;
  v_other uuid;
  v_published uuid;
  v_draft uuid;
  v_seen integer;
  v_insert_refused boolean := false;
begin
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
  set local role authenticated;
  select id into v_point from points where number = 58;
  select id into v_other from vocabulary_items where term = 'other word';
  select id into v_published from questions
   where point_id = v_point and prompt = 'asked of the room';
  select id into v_draft from questions
   where point_id = v_point and prompt = 'asked of the picture';
  update questions set is_published = true where id = v_published;
  update questions set is_published = false, shown_vocabulary_item_id = v_other
   where id = v_draft;

  perform set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);

  select count(*) into v_seen from questions where point_id = v_point;
  if v_seen <> 1 then
    raise exception
      'the student sees % of the questions of point 58, expected the 1 published', v_seen;
  end if;

  update questions set shown_vocabulary_item_id = null where id = v_published;
  begin
    insert into questions
        (point_id, position, prompt, expected_answer, shown_vocabulary_item_id)
      values (v_point, 2, 'hers', 'an answer', v_other);
  exception when insufficient_privilege then
    v_insert_refused := true;
  end;

  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);

  if not v_insert_refused then
    raise exception 'the student inserted a question that shows a word';
  end if;
  if (select shown_vocabulary_item_id from questions where id = v_published)
     is distinct from v_other then
    raise exception 'the student took the word off a question';
  end if;

  raise notice 'the student sees only the published one of two questions that show a word';
  raise notice 'and cannot change which word a question shows';
end;
$$;

-- Two schools (0029). Chelsea St holds the teacher and student above; a second
-- school, B, gets a teacher and a student of its own. Nothing of one school
-- may reach the people of the other, common content reaches both, and only a
-- platform admin writes what is common.
--
-- Seeded as the owner, so the rows go in past RLS; the reads and writes under
-- test happen as authenticated. Failures are collected and raised together,
-- so taking one clause out of 0029 shows every assertion that rests on it.
insert into schools (slug, name) values ('escola-b', 'Escola B');
insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333333', 'teacher-b@example.com', null),
  ('44444444-4444-4444-4444-444444444444', 'student-b@example.com', null);
insert into school_members (school_id, user_id, role) values
  ((select id from schools where slug = 'escola-b'), '33333333-3333-3333-3333-333333333333', 'teacher'),
  ((select id from schools where slug = 'escola-b'), '44444444-4444-4444-4444-444444444444', 'student');
insert into students (id, school_id)
  values ('44444444-4444-4444-4444-444444444444', (select id from schools where slug = 'escola-b'));

-- One book for each school, at the position of the common Book 2: the
-- position is unique per scope now, not across the table. Their points and
-- questions name no school and take their book's.
insert into books (position, title, school_id) values
  (2, 'Chelsea only', (select id from schools where slug = 'chelsea-st')),
  (2, 'B only', (select id from schools where slug = 'escola-b'));
insert into points (book_id, number)
  select id, 1 from books where title in ('Chelsea only', 'B only');
insert into questions (point_id, position, prompt, expected_answer, is_published)
  select p.id, 0, 'of ' || b.title, 'a', true
    from points p join books b on b.id = p.book_id
   where b.title in ('Chelsea only', 'B only');
-- A lesson for each school's student, so the reads below have something to
-- miss.
insert into lessons (student_id, scheduled_at) values
  ('44444444-4444-4444-4444-444444444444', now() + interval '1 day'),
  ('22222222-2222-2222-2222-222222222222', now() + interval '3 days');

-- The stub storage schema grants nothing; Supabase grants these.
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

-- True when the statement is refused for privilege: no grant, or a policy
-- that rejects the row it would write.
create function verify.refused_for_privilege(p_sql text) returns boolean
language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;

do $$
declare
  c_chelsea constant uuid := (select id from schools where slug = 'chelsea-st');
  c_b constant uuid := (select id from schools where slug = 'escola-b');
  c_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  c_student constant uuid := '22222222-2222-2222-2222-222222222222';
  c_teacher_b constant uuid := '33333333-3333-3333-3333-333333333333';
  c_student_b constant uuid := '44444444-4444-4444-4444-444444444444';
  v_chelsea_book uuid := (select id from books where title = 'Chelsea only');
  v_chelsea_point uuid;
  v_b_point uuid;
  v_b_word uuid;
  v_n integer;
  v_failures text;
begin
  delete from verify.failures;
  select id into v_chelsea_point from points where book_id = v_chelsea_book;
  select p.id into v_b_point
    from points p join books b on b.id = p.book_id where b.title = 'B only';

  -- Rows that name no school take their parent's.
  if (select school_id from points where id = v_b_point) is distinct from c_b then
    insert into verify.failures values ('a point of a school book did not take the school');
  end if;
  if (select school_id from questions where point_id = v_b_point) is distinct from c_b then
    insert into verify.failures values ('a question of a school point did not take the school');
  end if;
  if (select school_id from lessons where student_id = c_student_b) is distinct from c_b then
    insert into verify.failures values ('a lesson did not take its student''s school');
  end if;
  if exists (select 1 from points p join books b on b.id = p.book_id
              where b.school_id is null and p.school_id is not null) then
    insert into verify.failures values ('a point of a common book took a school');
  end if;

  -- A row never points at another school's, and its school never changes.
  insert into vocabulary_items (term, first_point_id) values ('a word of B', v_b_point)
    returning id into v_b_word;
  perform verify.expect_refused('a question of B on a Chelsea point', 'questions_school',
    format('insert into questions (point_id, position, prompt, expected_answer, school_id)
            values (%L, 1, %L, %L, %L)', v_chelsea_point, 'p', 'a', c_b));
  perform verify.expect_refused('a common question showing a word of B', 'questions_school',
    format('insert into questions (point_id, position, prompt, expected_answer, shown_vocabulary_item_id)
            values ((select id from points where number = 53 and school_id is null), 9, %L, %L, %L)',
           'p', 'a', v_b_word));
  -- Points and questions and not books: two books at position 2 already live
  -- in other scopes, so moving a book would trip the unique key first.
  perform verify.expect_refused('a point moved to another school', 'points_school',
    format('update points set school_id = %L where id = %L', c_b, v_chelsea_point));
  perform verify.expect_refused('a common question given a school', 'questions_school',
    format('update questions set school_id = %L
             where id = (select id from questions where school_id is null limit 1)', c_b));
  -- A common row moved under a school's parent is refused, not adopted: on an
  -- update the school is already written.
  perform verify.expect_refused('a common word moved under a point of B', 'vocabulary_items_school',
    format('update vocabulary_items set first_point_id = %L
             where id = (select id from vocabulary_items where term = %L)', v_b_point, 'a word'));

  -- A students row needs the student membership behind it.
  begin
    insert into students (id, school_id) values (c_teacher_b, c_b);
    insert into verify.failures values ('a student row without a student membership');
  exception when foreign_key_violation then
    raise notice 'a student row without a student membership: refused by the foreign key';
  end;
  begin
    delete from school_members where user_id = c_student_b and role = 'student';
    insert into verify.failures values ('a student membership removed under a students row');
  exception when foreign_key_violation then
    raise notice 'a student membership removed under a students row: refused by the foreign key';
  end;

  -- Two guards stand here, the trigger and the foreign key through the
  -- school, and the trigger speaks first; either refusal is the right answer.
  begin
    insert into lessons (student_id, scheduled_at, school_id)
      values (c_student, now() + interval '2 days', c_b);
    insert into verify.failures values ('a lesson of B named a Chelsea student');
  exception
    when check_violation then
      raise notice 'a lesson of B naming a Chelsea student: refused by the trigger';
    when foreign_key_violation then
      raise notice 'a lesson of B naming a Chelsea student: refused by the foreign key';
  end;

  -- People and operation always carry a school.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and column_name = 'school_id' and is_nullable = 'NO'
     and table_name in ('students', 'lessons', 'lesson_schedules', 'assignments',
                        'assignment_items', 'attempts', 'review_schedule');
  if v_n <> 7 then
    insert into verify.failures
      values (format('%s of 7 people and operation tables have school_id not null', v_n));
  end if;

  -- The teacher of B.
  perform set_config('test.uid', c_teacher_b::text, false);
  set local role authenticated;

  if exists (select 1 from books where school_id = c_chelsea) then
    insert into verify.failures values ('the teacher of B reads a Chelsea book');
  end if;
  if exists (select 1 from questions where school_id = c_chelsea) then
    insert into verify.failures values ('the teacher of B reads a Chelsea question');
  end if;
  if not exists (select 1 from books where school_id is null) then
    insert into verify.failures values ('the teacher of B does not read common books');
  end if;
  if not exists (select 1 from books where school_id = c_b) then
    insert into verify.failures values ('the teacher of B does not read her own school''s book');
  end if;
  if exists (select 1 from students where school_id = c_chelsea) then
    insert into verify.failures values ('the teacher of B reads a Chelsea student');
  end if;
  if exists (select 1 from profiles where id in (c_student, c_admin)) then
    insert into verify.failures values ('the teacher of B reads a Chelsea profile');
  end if;
  if not exists (select 1 from profiles where id = c_student_b) then
    insert into verify.failures values ('the teacher of B does not read her student''s profile');
  end if;
  if exists (select 1 from lessons where school_id = c_chelsea) then
    insert into verify.failures values ('the teacher of B reads a Chelsea lesson');
  end if;
  if exists (select 1 from school_members where school_id = c_chelsea) then
    insert into verify.failures values ('the teacher of B reads who belongs to Chelsea');
  end if;
  if exists (select 1 from platform_admins) then
    insert into verify.failures values ('the teacher of B reads the platform admins');
  end if;

  -- An update the policy filters matches nothing and does not raise; what the
  -- rows hold is read back as the owner at the end.
  update books set title = 'taken' where id = v_chelsea_book;
  update questions set prompt = 'taken' where school_id is null;
  if not verify.refused_for_privilege(
       'insert into books (position, title) values (7, ''common, by B'')') then
    insert into verify.failures values ('the teacher of B wrote a common book');
  end if;
  if verify.refused_for_privilege(
       format('insert into books (position, title, school_id) values (7, %L, %L)', 'of B', c_b)) then
    insert into verify.failures values ('the teacher of B could not write her own school''s book');
  end if;
  if not verify.refused_for_privilege(
       format('insert into school_members (school_id, user_id, role) values (%L, %L, %L)',
              c_chelsea, c_teacher_b, 'admin')) then
    insert into verify.failures values ('the teacher of B made herself admin of Chelsea');
  end if;
  if not verify.refused_for_privilege(
       format('insert into platform_admins (user_id) values (%L)', c_teacher_b)) then
    insert into verify.failures values ('the teacher of B made herself platform admin');
  end if;
  if not verify.refused_for_privilege(
       format('insert into storage.objects (bucket_id, name) values (%L, %L)',
              'vocabulary-images', c_chelsea || '/x.png')) then
    insert into verify.failures values ('the teacher of B wrote a file under Chelsea''s folder');
  end if;
  if not verify.refused_for_privilege(
       format('insert into storage.objects (bucket_id, name) values (%L, %L)',
              'vocabulary-images', 'references/x.png')) then
    insert into verify.failures values ('the teacher of B wrote a file outside her school''s folder');
  end if;
  if verify.refused_for_privilege(
       format('insert into storage.objects (bucket_id, name) values (%L, %L)',
              'vocabulary-images', c_b || '/x.png')) then
    insert into verify.failures values ('the teacher of B could not write under her school''s folder');
  end if;

  -- The student of B reads common published questions and her school's, and
  -- not Chelsea's.
  perform set_config('test.uid', c_student_b::text, false);
  if not exists (select 1 from questions where school_id is null and is_published) then
    insert into verify.failures values ('the student of B does not read a common published question');
  end if;
  if not exists (select 1 from questions where school_id = c_b) then
    insert into verify.failures values ('the student of B does not read her school''s published question');
  end if;
  if exists (select 1 from questions where school_id = c_chelsea) then
    insert into verify.failures values ('the student of B reads a Chelsea question');
  end if;
  if exists (select 1 from books) then
    insert into verify.failures values ('the student of B reads a book');
  end if;

  -- And the Chelsea student does not read B's.
  perform set_config('test.uid', c_student::text, false);
  if exists (select 1 from questions where school_id = c_b) then
    insert into verify.failures values ('the Chelsea student reads a question of B');
  end if;

  -- The platform admin reads everything, B's people included.
  perform set_config('test.uid', c_admin::text, false);
  if (select count(*) from students) <> 2 then
    insert into verify.failures values ('the platform admin does not read every student');
  end if;
  if not exists (select 1 from books where school_id = c_b) then
    insert into verify.failures values ('the platform admin does not read a book of B');
  end if;

  reset role;
  if (select title from books where id = v_chelsea_book) <> 'Chelsea only' then
    insert into verify.failures values ('the teacher of B renamed a Chelsea book');
  end if;
  if exists (select 1 from questions where prompt = 'taken') then
    insert into verify.failures values ('the teacher of B changed a common question');
  end if;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'two schools: %', v_failures;
  end if;

  raise notice 'two schools: nothing of one reaches the other, common content reaches both';
  raise notice 'and only a platform admin writes what is common';
end;
$$;

-- Joining a school by invite (0031) ------------------------------------------------
--
-- Who may invite whom, and when an invite becomes a membership. The accounts
-- are written as the owner, the way Supabase Auth writes them; the invites as
-- authenticated, through the policies under test.
do $$
declare
  c_chelsea constant uuid := (select id from schools where slug = 'chelsea-st');
  c_b constant uuid := (select id from schools where slug = 'escola-b');
  c_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  c_teacher_b constant uuid := '33333333-3333-3333-3333-333333333333';
  c_student_b constant uuid := '44444444-4444-4444-4444-444444444444';
  c_new constant uuid := '55555555-5555-5555-5555-555555555555';
  c_late constant uuid := '66666666-6666-6666-6666-666666666666';
  c_created_confirmed constant uuid := '77777777-7777-7777-7777-777777777777';
  v_failures text;
  v_expired uuid;
begin
  delete from verify.failures;

  -- An open invite of each school, written as the owner.
  insert into school_invites (school_id, email, role, invited_by)
    values (c_chelsea, 'someone@example.com', 'teacher', c_admin);
  insert into school_invites (school_id, email, role, invited_by)
    values (c_b, 'someone-b@example.com', 'student', c_teacher_b);

  set local role authenticated;

  -- The teacher of B reads her school's invites and not Chelsea's.
  perform set_config('test.uid', c_teacher_b::text, false);
  if exists (select 1 from school_invites where school_id = c_chelsea) then
    insert into verify.failures values ('the teacher of B reads a Chelsea invite');
  end if;
  if not exists (select 1 from school_invites where school_id = c_b) then
    insert into verify.failures values ('the teacher of B does not read her school''s invite');
  end if;

  -- She invites students to her school, and nothing else.
  if verify.refused_for_privilege(
       format('insert into school_invites (school_id, email, role) values (%L, %L, %L)',
              c_b, 'new-student@example.com', 'student')) then
    insert into verify.failures values ('the teacher of B could not invite a student to B');
  end if;
  if not verify.refused_for_privilege(
       format('insert into school_invites (school_id, email, role) values (%L, %L, %L)',
              c_b, 'new-teacher@example.com', 'teacher')) then
    insert into verify.failures values ('the teacher of B invited a teacher');
  end if;
  if not verify.refused_for_privilege(
       format('insert into school_invites (school_id, email, role) values (%L, %L, %L)',
              c_b, 'new-admin@example.com', 'admin')) then
    insert into verify.failures values ('the teacher of B invited an admin');
  end if;
  if not verify.refused_for_privilege(
       format('insert into school_invites (school_id, email, role) values (%L, %L, %L)',
              c_chelsea, 'other-student@example.com', 'student')) then
    insert into verify.failures values ('the teacher of B invited a student to Chelsea');
  end if;
  if not verify.refused_for_privilege(
       format('insert into school_invites (school_id, email, role, invited_by) values (%L, %L, %L, %L)',
              c_b, 'signed-by-another@example.com', 'student', c_admin)) then
    insert into verify.failures values ('the teacher of B wrote an invite in someone else''s name');
  end if;
  -- Renewing touches expires_at only: accepted_at is not hers to write.
  if not verify.refused_for_privilege(
       format('update school_invites set accepted_at = now() where school_id = %L', c_b)) then
    insert into verify.failures values ('the teacher of B marked an invite accepted');
  end if;
  -- She renews, for fifteen days at most, whatever she asks for.
  update school_invites set expires_at = '2100-01-01'
   where school_id = c_b and email = 'someone-b@example.com';
  if (select expires_at from school_invites
       where school_id = c_b and email = 'someone-b@example.com') > now() + interval '15 days' then
    insert into verify.failures values ('a renewal kept an invite open past fifteen days');
  end if;

  -- A student invites no one, not even to her own school.
  perform set_config('test.uid', c_student_b::text, false);
  if not verify.refused_for_privilege(
       format('insert into school_invites (school_id, email, role) values (%L, %L, %L)',
              c_b, 'friend@example.com', 'student')) then
    insert into verify.failures values ('the student of B invited someone');
  end if;

  -- The platform admin invites any role to any school.
  perform set_config('test.uid', c_admin::text, false);
  if verify.refused_for_privilege(
       format('insert into school_invites (school_id, email, role) values (%L, %L, %L)',
              c_b, 'admin-of-b@example.com', 'admin')) then
    insert into verify.failures values ('the platform admin could not invite an admin to B');
  end if;
  -- A new invite can ask for less than fifteen days, never for more.
  insert into school_invites (school_id, email, role, expires_at)
    values (c_b, 'far-future@example.com', 'teacher', '2100-01-01');
  if (select expires_at from school_invites where email = 'far-future@example.com')
       > now() + interval '15 days' then
    insert into verify.failures values ('an invite was written open past fifteen days');
  end if;

  -- The email is stored the way auth.users stores it.
  perform verify.expect_refused(
    'an invite with an upper case email', 'school_invites_email_check',
    format('insert into school_invites (school_id, email, role) values (%L, %L, %L)',
           c_b, 'Someone.Else@example.com', 'student'));

  -- Since 0032 a student invite is written whatever the person studies
  -- elsewhere: refusing it here told the inviting school. One school per
  -- student is checked on acceptance (the 0032 block below).
  perform set_config('test.uid', c_admin::text, false);
  if verify.refused_by(
       format('insert into school_invites (school_id, email, role) values (%L, %L, %L)',
              c_b, 'student@example.com', 'student')) is not null then
    insert into verify.failures values ('a student invite for a Chelsea student was refused when written');
  end if;
  -- Teaching at a second school is fine: only studying is one school.
  if verify.refused_for_privilege(
       format('insert into school_invites (school_id, email, role) values (%L, %L, %L)',
              c_chelsea, 'someone-b@example.com', 'teacher')) then
    insert into verify.failures values ('a student of B could not be invited to teach at Chelsea');
  end if;

  reset role;

  -- A new account does not join on creation, only on confirmation.
  insert into auth.users (id, email) values (c_new, 'someone-b@example.com');
  if exists (select 1 from school_members where user_id = c_new) then
    insert into verify.failures values ('an unconfirmed account joined a school');
  end if;
  update auth.users set email_confirmed_at = now() where id = c_new;
  if not exists (select 1 from school_members where user_id = c_new and school_id = c_b and role = 'student') then
    insert into verify.failures values ('the first confirmation did not make the student membership');
  end if;
  if not exists (select 1 from students where id = c_new and school_id = c_b) then
    insert into verify.failures values ('the first confirmation did not make the students row');
  end if;
  if not exists (select 1 from school_members where user_id = c_new and school_id = c_chelsea and role = 'teacher') then
    insert into verify.failures values ('the first confirmation did not accept every invite of the email');
  end if;
  if exists (select 1 from school_invites where email = 'someone-b@example.com' and accepted_at is null) then
    insert into verify.failures values ('an invite was used and left open');
  end if;

  -- An expired invite never becomes a membership.
  insert into school_invites (school_id, email, role, invited_by, expires_at)
    values (c_b, 'late@example.com', 'student', c_teacher_b, now() - interval '1 day')
    returning id into v_expired;
  insert into auth.users (id, email) values (c_late, 'late@example.com');
  update auth.users set email_confirmed_at = now() where id = c_late;
  if exists (select 1 from school_members where user_id = c_late) then
    insert into verify.failures values ('an expired invite became a membership');
  end if;
  -- Renewed, it still waits for her yes (0032), though the email is confirmed.
  update school_invites set expires_at = now() + interval '15 days' where id = v_expired;
  if exists (select 1 from school_members where user_id = c_late) then
    insert into verify.failures values ('a renewed invite for a confirmed account became a membership without a yes');
  end if;

  -- An account created already confirmed joins on creation.
  insert into school_invites (school_id, email, role, invited_by)
    values (c_b, 'confirmed-at-birth@example.com', 'student', c_teacher_b);
  insert into auth.users (id, email, email_confirmed_at)
    values (c_created_confirmed, 'confirmed-at-birth@example.com', now());
  if not exists (select 1 from students where id = c_created_confirmed and school_id = c_b) then
    insert into verify.failures values ('an account created confirmed did not join');
  end if;

  -- An invite for a confirmed account is written and waits for her yes (0032).
  update auth.users set email_confirmed_at = now() where id = c_teacher_b;
  set local role authenticated;
  perform set_config('test.uid', c_admin::text, false);
  insert into school_invites (school_id, email, role) values (c_chelsea, 'teacher-b@example.com', 'teacher');
  reset role;
  if exists (select 1 from school_members where user_id = c_teacher_b and school_id = c_chelsea) then
    insert into verify.failures values ('an invite for a confirmed account became a membership without a yes');
  end if;

  -- An accepted invite is not cancelled: it is how someone joined.
  set local role authenticated;
  perform set_config('test.uid', c_teacher_b::text, false);
  delete from school_invites where email = 'someone-b@example.com';
  reset role;
  if not exists (select 1 from school_invites where email = 'someone-b@example.com') then
    insert into verify.failures values ('an accepted invite was cancelled');
  end if;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'invites: %', v_failures;
  end if;

  raise notice 'invites: a school''s admin invites any role, its teacher students only, a student no one';
  raise notice 'and an invite becomes a membership on the first confirmation, never once expired';
end;
$$;

-- An invite waits for a yes (0032) ---------------------------------------------------
--
-- Continues from the block above: Chelsea has an open teacher invite for the
-- teacher of B (confirmed), B an open student invite for late@ (confirmed) and
-- one for the Chelsea student. Each person accepts only her own, open invite,
-- signed in; a student of one school is refused another at acceptance.
do $$
declare
  c_chelsea constant uuid := (select id from schools where slug = 'chelsea-st');
  c_b constant uuid := (select id from schools where slug = 'escola-b');
  c_student constant uuid := '22222222-2222-2222-2222-222222222222';
  c_teacher_b constant uuid := '33333333-3333-3333-3333-333333333333';
  c_late constant uuid := '66666666-6666-6666-6666-666666666666';
  v_failures text;
  v_teacher_invite uuid := (select id from school_invites
                             where school_id = c_chelsea and email = 'teacher-b@example.com');
  v_late_invite uuid := (select id from school_invites
                          where school_id = c_b and email = 'late@example.com');
  v_student_invite uuid := (select id from school_invites
                             where school_id = c_b and email = 'student@example.com');
  v_expired uuid;
begin
  delete from verify.failures;

  if has_function_privilege('anon', 'accept_my_school_invite(uuid)', 'execute')
     or has_function_privilege('anon', 'my_open_school_invites()', 'execute') then
    insert into verify.failures values ('anon may call the invite functions');
  end if;

  -- An expired invite for the teacher of B, written as the owner.
  insert into school_invites (school_id, email, role, expires_at)
    values (c_b, 'teacher-b@example.com', 'student', now() - interval '1 day')
    returning id into v_expired;

  set local role authenticated;

  -- She sees her open invite and nobody else's.
  perform set_config('test.uid', c_teacher_b::text, false);
  if not exists (select 1 from my_open_school_invites() where id = v_teacher_invite) then
    insert into verify.failures values ('the invited person does not see her open invite');
  end if;
  if exists (select 1 from my_open_school_invites() where id <> v_teacher_invite) then
    insert into verify.failures values ('my_open_school_invites returned an invite of another email or an expired one');
  end if;

  -- Someone else, signed in, cannot accept it.
  perform set_config('test.uid', c_late::text, false);
  perform verify.expect_refused(
    'another account accepting her invite', 'accept_my_school_invite_open',
    format('select accept_my_school_invite(%L)', v_teacher_invite));

  -- An expired invite is not accepted, even by its own person.
  perform set_config('test.uid', c_teacher_b::text, false);
  perform verify.expect_refused(
    'an expired invite accepted', 'accept_my_school_invite_open',
    format('select accept_my_school_invite(%L)', v_expired));

  -- Her yes makes the membership and closes the invite.
  if verify.refused_by(format('select accept_my_school_invite(%L)', v_teacher_invite)) is not null then
    insert into verify.failures values ('she could not accept her own open invite');
  end if;
  reset role;
  if not exists (select 1 from school_members
                  where user_id = c_teacher_b and school_id = c_chelsea and role = 'teacher') then
    insert into verify.failures values ('accepting did not make the membership');
  end if;
  if (select accepted_at from school_invites where id = v_teacher_invite) is null then
    insert into verify.failures values ('an accepted invite was left open');
  end if;
  if exists (select 1 from school_members where user_id = c_teacher_b and school_id = c_b and role = 'student') then
    insert into verify.failures values ('an expired invite became a membership');
  end if;

  -- A student invite accepted makes the students row too.
  set local role authenticated;
  perform set_config('test.uid', c_late::text, false);
  perform accept_my_school_invite(v_late_invite);
  reset role;
  if not exists (select 1 from students where id = c_late and school_id = c_b) then
    insert into verify.failures values ('accepting a student invite did not make the students row');
  end if;

  -- A Chelsea student is refused a student invite of B when she accepts it.
  update auth.users set email_confirmed_at = now() where id = c_student;
  set local role authenticated;
  perform set_config('test.uid', c_student::text, false);
  perform verify.expect_refused(
    'a Chelsea student accepting a student invite of B', 'accept_my_school_invite_one_school',
    format('select accept_my_school_invite(%L)', v_student_invite));
  reset role;
  if exists (select 1 from school_members where user_id = c_student and school_id = c_b) then
    insert into verify.failures values ('a student of one school joined another as a student');
  end if;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'invite acceptance: %', v_failures;
  end if;

  raise notice 'invite acceptance: an invite for an account waits for her yes, signed in, her own and open';
  raise notice 'and a student of one school is refused another one when she accepts, not when invited';
end;
$$;
