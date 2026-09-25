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
\i supabase/migrations/0022_contrast_is_between_pictures.sql
\i supabase/migrations/0025_an_upload_is_a_file_not_a_generation.sql
\i supabase/migrations/0026_the_instruction_belongs_to_the_word.sql

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
