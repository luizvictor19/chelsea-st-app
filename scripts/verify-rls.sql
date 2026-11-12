-- Criterion 10, as a test rather than a claim: a signed-in student reaches no
-- row of the teacher's content, while the published questions still reach her.
--
-- Runs against an empty Postgres with the migrations applied. The auth schema
-- is stubbed to the two things the migrations touch, so this needs no Supabase.
\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

-- Production's default ACL, measured through the MCP on 2026-11-04: the
-- postgres role grants Dxtm (truncate, references, trigger, maintain) in
-- schema public on every new table to anon, authenticated and service_role,
-- even with "expose new tables" off, and has since the first migration. A plain
-- Postgres grants none of it, so it is set here, before 0001, and every table
-- below is born with what it was born with in production. Without it the
-- privilege checks would be passing on tables production never had; the
-- snapshot right after 0036 holds this replay to what was measured.
alter default privileges for role postgres in schema public
  grant truncate, references, trigger, maintain on tables
  to anon, authenticated, service_role;

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
\i supabase/migrations/0030_a_question_can_show_a_scene.sql
\i supabase/migrations/0031_joining_a_school_by_invite.sql
\i supabase/migrations/0032_an_invite_waits_for_a_yes.sql
\i supabase/migrations/0033_a_scene_is_drawn_from_pictures.sql
\i supabase/migrations/0034_a_scene_set_aside_keeps_its_cost.sql
\i supabase/migrations/0035_a_lesson_marks_where_she_stopped.sql
\i supabase/migrations/0036_a_lead_waits_for_a_call.sql

-- The privileges of public as production held them after 0036 ---------------------------
--
-- Measured through the MCP on 2026-11-04, before 0037. Every privilege anon,
-- authenticated and service_role hold on a relation of public, or on one of
-- its columns, one row per relation, column and role, with the privileges
-- sorted: aclexplode and not the text of relacl, because the order of the
-- items in the array can differ between production and here without any
-- privilege differing. A relation more or less than the 23 measured fails too.
--
-- The replay of production's default ACL from 0001 is what this holds: moved
-- back to just before 0036, the 22 older tables lose their Dxtm and this fails.
-- The snapshot is kept in a temporary table for the check right after 0037.
create function pg_temp.public_privileges()
returns table (relname text, column_name text, grantee text, privileges text[])
language sql stable as $$
  with granted as (
    select c.relname::text, null::text as column_name, a.grantee, a.privilege_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) a
     where n.nspname = 'public'
    union all
    select c.relname::text, att.attname::text, a.grantee, a.privilege_type
      from pg_attribute att
      join pg_class c on c.oid = att.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(att.attacl) a
     where n.nspname = 'public' and att.attnum > 0 and not att.attisdropped
  )
  select g.relname, g.column_name, r.rolname::text,
         array_agg(distinct g.privilege_type order by g.privilege_type)
    from granted g
    join pg_roles r on r.oid = g.grantee
   where r.rolname in ('anon', 'authenticated', 'service_role')
   group by g.relname, g.column_name, r.rolname;
$$;

create temp table privileges_after_0036 as
  select * from pg_temp.public_privileges();

do $$
declare
  -- The 18 tables where authenticated holds all eight, and the 22 older
  -- tables where service_role holds Dxtm.
  c_full constant text[] := array[
    'assignment_items', 'assignments', 'blocks', 'books', 'contrast_set_items',
    'contrast_sets', 'image_attempts', 'lesson_schedules', 'lessons',
    'lessons_content', 'points', 'questions', 'review_schedule', 'scenes',
    'school_members', 'schools', 'students', 'vocabulary_items'];
  c_older constant text[] := c_full
    || array['attempts', 'platform_admins', 'profiles', 'school_invites'];
  v_drift text;
begin
  with expected (relname, column_name, grantee, privileges) as (
    select t, null::text, 'authenticated',
           'DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE'
      from unnest(c_full) t
    union all
    select t, null::text, 'service_role', 'MAINTAIN,REFERENCES,TRIGGER,TRUNCATE'
      from unnest(c_older) t
    union all values
      ('attempts', null::text, 'authenticated',
       'INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE'),
      ('platform_admins', null, 'authenticated', 'MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE'),
      ('profiles', null, 'authenticated', 'MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE'),
      ('school_invites', null, 'authenticated',
       'DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE'),
      ('school_invites', 'expires_at', 'authenticated', 'UPDATE'),
      ('leads', null, 'service_role', 'INSERT')
  ),
  actual as (
    select relname, column_name, grantee, array_to_string(privileges, ',') as privileges
      from privileges_after_0036
  ),
  drift as (
    (select 'expected but not held' as what, * from expected
     except select 'expected but not held', * from actual)
    union all
    (select 'held but not expected', * from actual
     except select 'held but not expected', * from expected)
  )
  select string_agg(format('%s: %s%s %s {%s}', what, relname,
                           coalesce('.' || column_name, ''), grantee, privileges),
                    '; ' order by relname, column_name, grantee, what)
    into v_drift from drift;

  -- The relations themselves: a table with no grant at all to the three roles
  -- would not show in the comparison above.
  with expected (relname) as (
    select unnest(c_older || array['leads'])
  ),
  actual as (
    select c.relname::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  ),
  drift as (
    (select 'a relation missing: ' || relname as what from expected
     except select 'a relation missing: ' || relname from actual)
    union all
    (select 'a relation not measured: ' || relname from actual
     except select 'a relation not measured: ' || relname from expected)
  )
  select nullif(concat_ws('; ', v_drift, string_agg(what, '; ' order by what)), '')
    into v_drift from drift;

  if v_drift is not null then
    raise exception 'privileges after 0036 differ from production on 2026-11-04: %', v_drift;
  end if;

  raise notice 'privileges after 0036: the 23 relations of public match production on 2026-11-04, role by role';
end;
$$;

\i supabase/migrations/0037_nobody_truncates_what_rls_guards.sql

-- What 0037 took, and only that ---------------------------------------------------------
--
-- Against the snapshot above: every relation, column and role lost exactly
-- truncate, references, trigger and maintain, and kept everything else. So
-- authenticated still selects, inserts, updates and deletes where it did, the
-- update on school_invites.expires_at stands, and service_role still inserts
-- into leads. A revoke all in 0037 fails here; whether anything of the four is
-- left anywhere is the last block of the script.
do $$
declare
  v_drift text;
begin
  with expected as (
    select relname, column_name, grantee,
           array(select p from unnest(privileges) p
                  where p not in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
                  order by p) as privileges
      from privileges_after_0036
  ),
  expected_held as (
    select relname, column_name, grantee, array_to_string(privileges, ',') as privileges
      from expected
     where cardinality(privileges) > 0
  ),
  actual as (
    select relname, column_name, grantee, array_to_string(privileges, ',') as privileges
      from pg_temp.public_privileges()
  ),
  drift as (
    (select 'expected but not held' as what, * from expected_held
     except select 'expected but not held', * from actual)
    union all
    (select 'held but not expected', * from actual
     except select 'held but not expected', * from expected_held)
  )
  select string_agg(format('%s: %s%s %s {%s}', what, relname,
                           coalesce('.' || column_name, ''), grantee, privileges),
                    '; ' order by relname, column_name, grantee, what)
    into v_drift from drift;

  if v_drift is not null then
    raise exception '0037 took more or less than truncate, references, trigger and maintain: %', v_drift;
  end if;

  raise notice '0037 took truncate, references, trigger and maintain from every relation of public, and nothing else';
end;
$$;

-- What 0038 changes is asserted where leads is: the block "A lead comes
-- through one door (0038)", after the one of 0036.
\i supabase/migrations/0038_a_lead_comes_through_one_door.sql
\i supabase/migrations/0039_a_point_she_stopped_at_is_named.sql

-- 0039 is applied here and its refusal asserted after the leads, in the block
-- "A narrowing names a point she stopped at (0039)". 0040 renames school to
-- organization; it is applied before the fixtures, so every assertion below
-- runs against the renamed database, and the block "Every row knows its
-- organization (0040)" holds that nothing of public still says school. The
-- blocks above keep the names of their time, like the migrations they follow.
\i supabase/migrations/0040_every_row_knows_its_organization.sql

-- 0041 gives every organization a brand and adds GrifoAI's organization. It
-- is applied before the fixtures, so the second organization below names its
-- brand like any new one must, and the block "An organization wears a brand
-- (0041)" holds the column after the 0040 one.
\i supabase/migrations/0041_an_organization_wears_a_brand.sql

-- Every policy of public and storage as it stands before 0042, which rewrites
-- 34 of them and one of storage in place. Kept in a temporary table for the
-- block "Without a teacher, the admin does not teach (0042)", which holds that
-- nothing changed beyond the one substitution 0042 makes. 0042 is applied
-- before the fixtures, as 0040 and 0041, so every assertion below runs against
-- the organizations that say whether they have a teacher; the fixtures name it
-- like any new organization must.
create temp table policies_before_0042 as
  select schemaname::text, tablename::text, policyname::text, permissive::text,
         roles::text, cmd::text, qual, with_check
    from pg_policies
   where schemaname in ('public', 'storage');

\i supabase/migrations/0042_without_a_teacher_the_admin_does_not_teach.sql

-- Every policy of public and storage as 0042 left it, for the same comparison
-- one migration later: 0043 rewrites the 10 content _write policies and the
-- one of storage. The block of 0042 compares its two snapshots, and the block
-- "All content is common (0043)" compares this one with the one right after
-- 0043, so a later migration that rewrites a policy breaks neither. 0043 is
-- applied before the fixtures too: no fixture below can hold content of an
-- organization.
create temp table policies_after_0042 as
  select schemaname::text, tablename::text, policyname::text, permissive::text,
         roles::text, cmd::text, qual, with_check
    from pg_policies
   where schemaname in ('public', 'storage');

\i supabase/migrations/0043_all_content_is_common.sql

create temp table policies_after_0043 as
  select schemaname::text, tablename::text, policyname::text, permissive::text,
         roles::text, cmd::text, qual, with_check
    from pg_policies
   where schemaname in ('public', 'storage');

-- 0044 creates a function and nothing else; its block, "The admin sees how
-- often, not what (0044)", runs after the fixtures.
\i supabase/migrations/0044_the_admin_sees_how_often_not_what.sql

-- 0045 adds three columns and two checks to questions and nothing else; its
-- block, "A suggested question keeps its draft (0045)", runs after the
-- fixtures.
\i supabase/migrations/0045_a_suggested_question_keeps_its_draft.sql

-- 0046 gives my_open_organization_invites one column more and changes
-- nothing else; its block, "An open invite says the kind of its organization
-- (0046)", runs after the fixtures.
\i supabase/migrations/0046_an_open_invite_says_the_kind.sql

-- Before 0047, two things production has and this Postgres does not, both
-- measured through the MCP on 2026-11-07. anon and authenticated hold select,
-- insert, update and delete on storage.objects (Supabase grants them), so
-- anon's reads of the bucket go through its policies, as on the project, and
-- the block of 0047 can read the bucket as anon at all.
-- And rls_auto_enable(), Supabase's function behind the event trigger
-- ensure_rls, which no migration creates: a stub here gives 0047's guarded
-- revoke something to revoke. The block of 0047 drops the stub, so it never
-- reaches the types.
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
create function public.rls_auto_enable() returns event_trigger
language plpgsql security definer as $$ begin end; $$;

-- 0047 takes execute away from PUBLIC on 18 functions of public, gives it back
-- to authenticated on 8, turns vocabulary_images_write to authenticated and
-- makes every function created after it born closed. Its block, "A function
-- runs only for who needs it (0047)", runs after the fixtures, which call
-- these functions as authenticated and fire every one of these triggers.
\i supabase/migrations/0047_a_function_runs_only_for_who_needs_it.sql

-- 0048 adds two functions and two triggers, profiles_timezone_known and
-- lesson_schedules_timezone_known, and changes no row. Its block, "A time zone
-- is one the screen reads (0048)", runs after the fixtures. The fixtures below
-- write profiles and schedules with the default zone, so they already pass
-- through both triggers.
\i supabase/migrations/0048_a_time_zone_is_one_the_screen_reads.sql

-- 0049 creates the billing tables and the functions only service_role
-- executes, and touches no older row. Its block, "A plan is paid through Asaas
-- (0049)", runs after the fixtures, which give it a Chelsea St student.
\i supabase/migrations/0049_a_plan_is_paid_through_asaas.sql

-- 0051 gives organizations open_signup, opens it on Chelsea St, and makes the
-- trigger of the first confirmation also call join_by_signup. No fixture below
-- signs up, so none joins by it; its block, "A signup opens one door (0051)",
-- runs after the fixtures.
\i supabase/migrations/0051_a_signup_opens_one_door.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'teacher@example.com', '{"full_name":"Teacher"}'),
  ('22222222-2222-2222-2222-222222222222', 'student@example.com', null);
-- Since 0029 the teacher is a platform admin and admin of Chelsea St, and the
-- student is a Chelsea St student: the roles live in organization_members.
insert into platform_admins (user_id) values ('11111111-1111-1111-1111-111111111111');
insert into organization_members (organization_id, user_id, role) values
  ((select id from organizations where slug = 'chelsea-st'), '11111111-1111-1111-1111-111111111111', 'admin'),
  ((select id from organizations where slug = 'chelsea-st'), '22222222-2222-2222-2222-222222222222', 'student');
insert into students (id, organization_id)
  values ('22222222-2222-2222-2222-222222222222', (select id from organizations where slug = 'chelsea-st'));

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
-- Since 0047 a function is born executable by its owner alone. The helpers
-- below run as anon, authenticated and service_role, so this schema, which
-- production does not have, gives them back to PUBLIC as before 0047.
alter default privileges for role postgres in schema verify
  grant execute on functions to public;

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

-- Two organizations (0029). Chelsea St holds the teacher and student above; a second
-- organization, B, gets a teacher and a student of its own. Nothing of one organization
-- may reach the people of the other, common content reaches both, and only a
-- platform admin writes what is common.
--
-- Seeded as the owner, so the rows go in past RLS; the reads and writes under
-- test happen as authenticated. Failures are collected and raised together,
-- so taking one clause out of 0029 shows every assertion that rests on it.
-- B wears GrifoAI, as every company does since 0041, and has a teacher
-- (0042): a company with live lessons is a possible product, and the
-- isolation below is between two organizations where both roles teach.
insert into organizations (slug, name, brand, has_teacher)
  values ('escola-b', 'Escola B', 'grifoai', true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333333', 'teacher-b@example.com', null),
  ('44444444-4444-4444-4444-444444444444', 'student-b@example.com', null);
insert into organization_members (organization_id, user_id, role) values
  ((select id from organizations where slug = 'escola-b'), '33333333-3333-3333-3333-333333333333', 'teacher'),
  ((select id from organizations where slug = 'escola-b'), '44444444-4444-4444-4444-444444444444', 'student');
insert into students (id, organization_id)
  values ('44444444-4444-4444-4444-444444444444', (select id from organizations where slug = 'escola-b'));

-- No content of either organization: since 0043 every row of content is
-- common, and the isolation below is of people and operation. A lesson for each organization's student, so the reads below have something to
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
  c_chelsea constant uuid := (select id from organizations where slug = 'chelsea-st');
  c_b constant uuid := (select id from organizations where slug = 'escola-b');
  c_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  c_student constant uuid := '22222222-2222-2222-2222-222222222222';
  c_teacher_b constant uuid := '33333333-3333-3333-3333-333333333333';
  c_student_b constant uuid := '44444444-4444-4444-4444-444444444444';
  c_common_point constant uuid := (select p.id from points p join books b on b.id = p.book_id
                                    where b.title = 'Book 2' and p.number = 53);
  v_n integer;
  v_failures text;
begin
  delete from verify.failures;

  -- Rows that name no organization take their parent's.
  if (select organization_id from lessons where student_id = c_student_b) is distinct from c_b then
    insert into verify.failures values ('a lesson did not take its student''s organization');
  end if;
  if exists (select 1 from points p join books b on b.id = p.book_id
              where b.organization_id is null and p.organization_id is not null) then
    insert into verify.failures values ('a point of a common book took an organization');
  end if;

  -- A row's organization never changes. The trigger speaks before the check
  -- of 0043, which refuses the same row on its own.
  perform verify.expect_refused('a common point given an organization', 'points_organization',
    format('update points set organization_id = %L where id = %L', c_b, c_common_point));
  perform verify.expect_refused('a common question given an organization', 'questions_organization',
    format('update questions set organization_id = %L
             where id = (select id from questions where organization_id is null limit 1)', c_b));

  -- A students row needs the student membership behind it.
  begin
    insert into students (id, organization_id) values (c_teacher_b, c_b);
    insert into verify.failures values ('a student row without a student membership');
  exception when foreign_key_violation then
    raise notice 'a student row without a student membership: refused by the foreign key';
  end;
  begin
    delete from organization_members where user_id = c_student_b and role = 'student';
    insert into verify.failures values ('a student membership removed under a students row');
  exception when foreign_key_violation then
    raise notice 'a student membership removed under a students row: refused by the foreign key';
  end;

  -- Two guards stand here, the trigger and the foreign key through the
  -- organization, and the trigger speaks first; either refusal is the right answer.
  begin
    insert into lessons (student_id, scheduled_at, organization_id)
      values (c_student, now() + interval '2 days', c_b);
    insert into verify.failures values ('a lesson of B named a Chelsea student');
  exception
    when check_violation then
      raise notice 'a lesson of B naming a Chelsea student: refused by the trigger';
    when foreign_key_violation then
      raise notice 'a lesson of B naming a Chelsea student: refused by the foreign key';
  end;

  -- People and operation always carry an organization.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and column_name = 'organization_id' and is_nullable = 'NO'
     and table_name in ('students', 'lessons', 'lesson_schedules', 'assignments',
                        'assignment_items', 'attempts', 'review_schedule');
  if v_n <> 7 then
    insert into verify.failures
      values (format('%s of 7 people and operation tables have organization_id not null', v_n));
  end if;

  -- The teacher of B.
  perform set_config('test.uid', c_teacher_b::text, false);
  set local role authenticated;

  if not exists (select 1 from books where organization_id is null) then
    insert into verify.failures values ('the teacher of B does not read common books');
  end if;
  if exists (select 1 from students where organization_id = c_chelsea) then
    insert into verify.failures values ('the teacher of B reads a Chelsea student');
  end if;
  if exists (select 1 from profiles where id in (c_student, c_admin)) then
    insert into verify.failures values ('the teacher of B reads a Chelsea profile');
  end if;
  if not exists (select 1 from profiles where id = c_student_b) then
    insert into verify.failures values ('the teacher of B does not read her student''s profile');
  end if;
  if exists (select 1 from lessons where organization_id = c_chelsea) then
    insert into verify.failures values ('the teacher of B reads a Chelsea lesson');
  end if;
  if exists (select 1 from organization_members where organization_id = c_chelsea) then
    insert into verify.failures values ('the teacher of B reads who belongs to Chelsea');
  end if;
  if exists (select 1 from platform_admins) then
    insert into verify.failures values ('the teacher of B reads the platform admins');
  end if;

  -- An update the policy filters matches nothing and does not raise; what the
  -- rows hold is read back as the owner at the end.
  update questions set prompt = 'taken' where organization_id is null;
  if not verify.refused_for_privilege(
       'insert into books (position, title) values (7, ''common, by B'')') then
    insert into verify.failures values ('the teacher of B wrote a common book');
  end if;
  if not verify.refused_for_privilege(
       format('insert into organization_members (organization_id, user_id, role) values (%L, %L, %L)',
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
    insert into verify.failures values ('the teacher of B wrote a file outside her organization''s folder');
  end if;

  -- The student of B reads common published questions, and no book.
  perform set_config('test.uid', c_student_b::text, false);
  if not exists (select 1 from questions where organization_id is null and is_published) then
    insert into verify.failures values ('the student of B does not read a common published question');
  end if;
  if exists (select 1 from books) then
    insert into verify.failures values ('the student of B reads a book');
  end if;

  -- The platform admin reads everything, B's people included.
  perform set_config('test.uid', c_admin::text, false);
  if (select count(*) from students) <> 2 then
    insert into verify.failures values ('the platform admin does not read every student');
  end if;

  reset role;
  if exists (select 1 from questions where prompt = 'taken') then
    insert into verify.failures values ('the teacher of B changed a common question');
  end if;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'two organizations: %', v_failures;
  end if;

  raise notice 'two organizations: nothing of one reaches the other, common content reaches both';
  raise notice 'and only a platform admin writes what is common';
end;
$$;

-- Joining an organization by invite (0031) ------------------------------------------------
--
-- Who may invite whom, and when an invite becomes a membership. The accounts
-- are written as the owner, the way Supabase Auth writes them; the invites as
-- authenticated, through the policies under test.
do $$
declare
  c_chelsea constant uuid := (select id from organizations where slug = 'chelsea-st');
  c_b constant uuid := (select id from organizations where slug = 'escola-b');
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

  -- An open invite of each organization, written as the owner.
  insert into organization_invites (organization_id, email, role, invited_by)
    values (c_chelsea, 'someone@example.com', 'teacher', c_admin);
  insert into organization_invites (organization_id, email, role, invited_by)
    values (c_b, 'someone-b@example.com', 'student', c_teacher_b);

  set local role authenticated;

  -- The teacher of B reads her organization's invites and not Chelsea's.
  perform set_config('test.uid', c_teacher_b::text, false);
  if exists (select 1 from organization_invites where organization_id = c_chelsea) then
    insert into verify.failures values ('the teacher of B reads a Chelsea invite');
  end if;
  if not exists (select 1 from organization_invites where organization_id = c_b) then
    insert into verify.failures values ('the teacher of B does not read her organization''s invite');
  end if;

  -- She invites students to her organization, and nothing else.
  if verify.refused_for_privilege(
       format('insert into organization_invites (organization_id, email, role) values (%L, %L, %L)',
              c_b, 'new-student@example.com', 'student')) then
    insert into verify.failures values ('the teacher of B could not invite a student to B');
  end if;
  if not verify.refused_for_privilege(
       format('insert into organization_invites (organization_id, email, role) values (%L, %L, %L)',
              c_b, 'new-teacher@example.com', 'teacher')) then
    insert into verify.failures values ('the teacher of B invited a teacher');
  end if;
  if not verify.refused_for_privilege(
       format('insert into organization_invites (organization_id, email, role) values (%L, %L, %L)',
              c_b, 'new-admin@example.com', 'admin')) then
    insert into verify.failures values ('the teacher of B invited an admin');
  end if;
  if not verify.refused_for_privilege(
       format('insert into organization_invites (organization_id, email, role) values (%L, %L, %L)',
              c_chelsea, 'other-student@example.com', 'student')) then
    insert into verify.failures values ('the teacher of B invited a student to Chelsea');
  end if;
  if not verify.refused_for_privilege(
       format('insert into organization_invites (organization_id, email, role, invited_by) values (%L, %L, %L, %L)',
              c_b, 'signed-by-another@example.com', 'student', c_admin)) then
    insert into verify.failures values ('the teacher of B wrote an invite in someone else''s name');
  end if;
  -- Renewing touches expires_at only: accepted_at is not hers to write.
  if not verify.refused_for_privilege(
       format('update organization_invites set accepted_at = now() where organization_id = %L', c_b)) then
    insert into verify.failures values ('the teacher of B marked an invite accepted');
  end if;
  -- She renews, for fifteen days at most, whatever she asks for.
  update organization_invites set expires_at = '2100-01-01'
   where organization_id = c_b and email = 'someone-b@example.com';
  if (select expires_at from organization_invites
       where organization_id = c_b and email = 'someone-b@example.com') > now() + interval '15 days' then
    insert into verify.failures values ('a renewal kept an invite open past fifteen days');
  end if;

  -- A student invites no one, not even to her own organization.
  perform set_config('test.uid', c_student_b::text, false);
  if not verify.refused_for_privilege(
       format('insert into organization_invites (organization_id, email, role) values (%L, %L, %L)',
              c_b, 'friend@example.com', 'student')) then
    insert into verify.failures values ('the student of B invited someone');
  end if;

  -- The platform admin invites any role to any organization.
  perform set_config('test.uid', c_admin::text, false);
  if verify.refused_for_privilege(
       format('insert into organization_invites (organization_id, email, role) values (%L, %L, %L)',
              c_b, 'admin-of-b@example.com', 'admin')) then
    insert into verify.failures values ('the platform admin could not invite an admin to B');
  end if;
  -- A new invite can ask for less than fifteen days, never for more.
  insert into organization_invites (organization_id, email, role, expires_at)
    values (c_b, 'far-future@example.com', 'teacher', '2100-01-01');
  if (select expires_at from organization_invites where email = 'far-future@example.com')
       > now() + interval '15 days' then
    insert into verify.failures values ('an invite was written open past fifteen days');
  end if;

  -- The email is stored the way auth.users stores it.
  perform verify.expect_refused(
    'an invite with an upper case email', 'organization_invites_email_check',
    format('insert into organization_invites (organization_id, email, role) values (%L, %L, %L)',
           c_b, 'Someone.Else@example.com', 'student'));

  -- Since 0032 a student invite is written whatever the person studies
  -- elsewhere: refusing it here told the inviting organization. One organization per
  -- student is checked on acceptance (the 0032 block below).
  perform set_config('test.uid', c_admin::text, false);
  if verify.refused_by(
       format('insert into organization_invites (organization_id, email, role) values (%L, %L, %L)',
              c_b, 'student@example.com', 'student')) is not null then
    insert into verify.failures values ('a student invite for a Chelsea student was refused when written');
  end if;
  -- Teaching at a second organization is fine: only studying is one organization.
  if verify.refused_for_privilege(
       format('insert into organization_invites (organization_id, email, role) values (%L, %L, %L)',
              c_chelsea, 'someone-b@example.com', 'teacher')) then
    insert into verify.failures values ('a student of B could not be invited to teach at Chelsea');
  end if;

  reset role;

  -- A new account does not join on creation, only on confirmation.
  insert into auth.users (id, email) values (c_new, 'someone-b@example.com');
  if exists (select 1 from organization_members where user_id = c_new) then
    insert into verify.failures values ('an unconfirmed account joined an organization');
  end if;
  update auth.users set email_confirmed_at = now() where id = c_new;
  if not exists (select 1 from organization_members where user_id = c_new and organization_id = c_b and role = 'student') then
    insert into verify.failures values ('the first confirmation did not make the student membership');
  end if;
  if not exists (select 1 from students where id = c_new and organization_id = c_b) then
    insert into verify.failures values ('the first confirmation did not make the students row');
  end if;
  if not exists (select 1 from organization_members where user_id = c_new and organization_id = c_chelsea and role = 'teacher') then
    insert into verify.failures values ('the first confirmation did not accept every invite of the email');
  end if;
  if exists (select 1 from organization_invites where email = 'someone-b@example.com' and accepted_at is null) then
    insert into verify.failures values ('an invite was used and left open');
  end if;

  -- An expired invite never becomes a membership.
  insert into organization_invites (organization_id, email, role, invited_by, expires_at)
    values (c_b, 'late@example.com', 'student', c_teacher_b, now() - interval '1 day')
    returning id into v_expired;
  insert into auth.users (id, email) values (c_late, 'late@example.com');
  update auth.users set email_confirmed_at = now() where id = c_late;
  if exists (select 1 from organization_members where user_id = c_late) then
    insert into verify.failures values ('an expired invite became a membership');
  end if;
  -- Renewed, it still waits for her yes (0032), though the email is confirmed.
  update organization_invites set expires_at = now() + interval '15 days' where id = v_expired;
  if exists (select 1 from organization_members where user_id = c_late) then
    insert into verify.failures values ('a renewed invite for a confirmed account became a membership without a yes');
  end if;

  -- An account created already confirmed joins on creation.
  insert into organization_invites (organization_id, email, role, invited_by)
    values (c_b, 'confirmed-at-birth@example.com', 'student', c_teacher_b);
  insert into auth.users (id, email, email_confirmed_at)
    values (c_created_confirmed, 'confirmed-at-birth@example.com', now());
  if not exists (select 1 from students where id = c_created_confirmed and organization_id = c_b) then
    insert into verify.failures values ('an account created confirmed did not join');
  end if;

  -- An invite for a confirmed account is written and waits for her yes (0032).
  update auth.users set email_confirmed_at = now() where id = c_teacher_b;
  set local role authenticated;
  perform set_config('test.uid', c_admin::text, false);
  insert into organization_invites (organization_id, email, role) values (c_chelsea, 'teacher-b@example.com', 'teacher');
  reset role;
  if exists (select 1 from organization_members where user_id = c_teacher_b and organization_id = c_chelsea) then
    insert into verify.failures values ('an invite for a confirmed account became a membership without a yes');
  end if;

  -- An accepted invite is not cancelled: it is how someone joined.
  set local role authenticated;
  perform set_config('test.uid', c_teacher_b::text, false);
  delete from organization_invites where email = 'someone-b@example.com';
  reset role;
  if not exists (select 1 from organization_invites where email = 'someone-b@example.com') then
    insert into verify.failures values ('an accepted invite was cancelled');
  end if;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'invites: %', v_failures;
  end if;

  raise notice 'invites: an organization''s admin invites any role, its teacher students only, a student no one';
  raise notice 'and an invite becomes a membership on the first confirmation, never once expired';
end;
$$;

-- An invite waits for a yes (0032) ---------------------------------------------------
--
-- Continues from the block above: Chelsea has an open teacher invite for the
-- teacher of B (confirmed), B an open student invite for late@ (confirmed) and
-- one for the Chelsea student. Each person accepts only her own, open invite,
-- signed in; a student of one organization is refused another at acceptance.
do $$
declare
  c_chelsea constant uuid := (select id from organizations where slug = 'chelsea-st');
  c_b constant uuid := (select id from organizations where slug = 'escola-b');
  c_student constant uuid := '22222222-2222-2222-2222-222222222222';
  c_teacher_b constant uuid := '33333333-3333-3333-3333-333333333333';
  c_late constant uuid := '66666666-6666-6666-6666-666666666666';
  v_failures text;
  v_teacher_invite uuid := (select id from organization_invites
                             where organization_id = c_chelsea and email = 'teacher-b@example.com');
  v_late_invite uuid := (select id from organization_invites
                          where organization_id = c_b and email = 'late@example.com');
  v_student_invite uuid := (select id from organization_invites
                             where organization_id = c_b and email = 'student@example.com');
  v_expired uuid;
begin
  delete from verify.failures;

  if has_function_privilege('anon', 'accept_my_organization_invite(uuid)', 'execute')
     or has_function_privilege('anon', 'my_open_organization_invites()', 'execute') then
    insert into verify.failures values ('anon may call the invite functions');
  end if;

  -- An expired invite for the teacher of B, written as the owner.
  insert into organization_invites (organization_id, email, role, expires_at)
    values (c_b, 'teacher-b@example.com', 'student', now() - interval '1 day')
    returning id into v_expired;

  set local role authenticated;

  -- She sees her open invite and nobody else's.
  perform set_config('test.uid', c_teacher_b::text, false);
  if not exists (select 1 from my_open_organization_invites() where id = v_teacher_invite) then
    insert into verify.failures values ('the invited person does not see her open invite');
  end if;
  if exists (select 1 from my_open_organization_invites() where id <> v_teacher_invite) then
    insert into verify.failures values ('my_open_organization_invites returned an invite of another email or an expired one');
  end if;

  -- Someone else, signed in, cannot accept it.
  perform set_config('test.uid', c_late::text, false);
  perform verify.expect_refused(
    'another account accepting her invite', 'accept_my_organization_invite_open',
    format('select accept_my_organization_invite(%L)', v_teacher_invite));

  -- An expired invite is not accepted, even by its own person.
  perform set_config('test.uid', c_teacher_b::text, false);
  perform verify.expect_refused(
    'an expired invite accepted', 'accept_my_organization_invite_open',
    format('select accept_my_organization_invite(%L)', v_expired));

  -- Her yes makes the membership and closes the invite.
  if verify.refused_by(format('select accept_my_organization_invite(%L)', v_teacher_invite)) is not null then
    insert into verify.failures values ('she could not accept her own open invite');
  end if;
  reset role;
  if not exists (select 1 from organization_members
                  where user_id = c_teacher_b and organization_id = c_chelsea and role = 'teacher') then
    insert into verify.failures values ('accepting did not make the membership');
  end if;
  if (select accepted_at from organization_invites where id = v_teacher_invite) is null then
    insert into verify.failures values ('an accepted invite was left open');
  end if;
  if exists (select 1 from organization_members where user_id = c_teacher_b and organization_id = c_b and role = 'student') then
    insert into verify.failures values ('an expired invite became a membership');
  end if;

  -- A student invite accepted makes the students row too.
  set local role authenticated;
  perform set_config('test.uid', c_late::text, false);
  perform accept_my_organization_invite(v_late_invite);
  reset role;
  if not exists (select 1 from students where id = c_late and organization_id = c_b) then
    insert into verify.failures values ('accepting a student invite did not make the students row');
  end if;

  -- A Chelsea student is refused a student invite of B when she accepts it.
  update auth.users set email_confirmed_at = now() where id = c_student;
  set local role authenticated;
  perform set_config('test.uid', c_student::text, false);
  perform verify.expect_refused(
    'a Chelsea student accepting a student invite of B', 'accept_my_organization_invite_one_organization',
    format('select accept_my_organization_invite(%L)', v_student_invite));
  reset role;
  if exists (select 1 from organization_members where user_id = c_student and organization_id = c_b) then
    insert into verify.failures values ('a student of one organization joined another as a student');
  end if;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'invite acceptance: %', v_failures;
  end if;

  raise notice 'invite acceptance: an invite for an account waits for her yes, signed in, her own and open';
  raise notice 'and a student of one organization is refused another one when she accepts, not when invited';
end;
$$;

-- A question can show a scene (0030) ------------------------------------------------
--
-- Scenes, their attempts, approving, the one-of-three rule on questions, and
-- who reads a scene. Written as the owner unless a role is set. Every scene is
-- common since 0043: no scene of an organization is seeded.
do $$
declare
  c_b constant uuid := (select id from organizations where slug = 'escola-b');
  c_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  c_student constant uuid := '22222222-2222-2222-2222-222222222222';
  -- Only of B: the teacher of B of the blocks above also teaches at Chelsea
  -- since she accepted its invite (0032).
  c_teacher_b constant uuid := '88888888-8888-8888-8888-888888888888';
  c_common_point constant uuid := (select p.id from points p join books b on b.id = p.book_id
                                    where b.title = 'Book 2' and p.number = 53);
  c_word constant uuid := (select id from vocabulary_items where term = 'a word');
  v_failures text;
  v_common uuid;
  v_unpublished uuid;
  v_first uuid;
  v_second uuid;
  v_word_image text;
begin
  delete from verify.failures;

  insert into auth.users (id, email) values (c_teacher_b, 'only-b@example.com');
  insert into organization_members (organization_id, user_id, role) values (c_b, c_teacher_b, 'teacher');

  -- Scenes ------------------------------------------------------------------------
  perform verify.expect_refused(
    'a scene with a blank description', 'scenes_description_not_blank',
    'insert into scenes (description) values (''   '')');
  perform verify.expect_refused(
    'a scene with a path and no approved attempt', 'scenes_approved_pair',
    'insert into scenes (description, image_path) values (''a lone path'', ''x/y.png'')');

  perform verify.expect_refused(
    'a scene described only by tabs and line breaks', 'scenes_description_not_blank',
    format('insert into scenes (description) values (%L)', E'\t\n '));

  insert into scenes (description) values ('Big box') returning id into v_common;
  begin
    insert into scenes (description) values ('  big   BOX ');
    insert into verify.failures values ('the same common description was written twice');
  exception when unique_violation then
    raise notice 'the same common description, cased and spaced apart: refused by scenes_description_key';
  end;
  begin
    insert into scenes (description) values (E'\tBig box\n');
    insert into verify.failures values ('the same common description with a tab and a line break was written');
  exception when unique_violation then
    raise notice 'the same common description between a tab and a line break: refused by scenes_description_key';
  end;
  insert into scenes (description) values ('Only in a draft') returning id into v_unpublished;

  -- Attempts belong to a word or to a scene --------------------------------------------
  perform verify.expect_refused(
    'an attempt of nothing', 'image_attempts_one_owner',
    'insert into image_attempts (provider, status) values (''freepik'', ''pending'')');
  perform verify.expect_refused(
    'an attempt of a word and a scene', 'image_attempts_one_owner',
    format('insert into image_attempts (vocabulary_item_id, scene_id, provider, status) values (%L, %L, %L, %L)',
           c_word, v_common, 'freepik', 'pending'));

  -- Approving a scene's attempt ----------------------------------------------------------
  v_word_image := (select image_path from vocabulary_items where id = c_word);
  insert into image_attempts (scene_id, provider, status, storage_path, credits_spent, completed_at)
    values (v_common, 'upload', 'generated', 'scene/first.png', 0, now()) returning id into v_first;
  insert into image_attempts (scene_id, provider, status, storage_path, credits_spent, completed_at)
    values (v_common, 'upload', 'generated', 'scene/second.png', 0, now()) returning id into v_second;
  perform approve_image_attempt(v_first);
  perform approve_image_attempt(v_second);
  if (select image_path from scenes where id = v_common) is distinct from 'scene/second.png'
     or (select approved_attempt_id from scenes where id = v_common) is distinct from v_second then
    insert into verify.failures values ('approving a scene''s attempt did not give the scene its picture');
  end if;
  if (select status from image_attempts where id = v_first) <> 'generated' then
    insert into verify.failures values ('the scene''s picture approved before did not go back to a candidate');
  end if;
  if (select image_path from vocabulary_items where id = c_word) is distinct from v_word_image then
    insert into verify.failures values ('approving a scene''s attempt changed a word');
  end if;
  -- One approved picture per scene, whatever writes it.
  begin
    insert into image_attempts (scene_id, provider, status, storage_path, credits_spent, completed_at)
      values (v_common, 'upload', 'approved', 'scene/third.png', 0, now());
    insert into verify.failures values ('a scene got a second approved picture');
  exception when unique_violation then
    raise notice 'a second approved picture of a scene: refused by image_attempts_one_approved_per_scene';
  end;

  -- What a question shows: at most one of the three -----------------------------------
  perform verify.expect_refused(
    'a question showing a word and a scene', 'questions_one_image',
    format('insert into questions (point_id, position, prompt, expected_answer, shown_vocabulary_item_id, scene_id) values (%L, 101, %L, %L, %L, %L)',
           c_common_point, 'q', 'a', c_word, v_common));
  perform verify.expect_refused(
    'a question showing a word and acted out', 'questions_one_image',
    format('insert into questions (point_id, position, prompt, expected_answer, shown_vocabulary_item_id, is_acted_out) values (%L, 102, %L, %L, %L, true)',
           c_common_point, 'q', 'a', c_word));
  perform verify.expect_refused(
    'a question showing a scene and acted out', 'questions_one_image',
    format('insert into questions (point_id, position, prompt, expected_answer, scene_id, is_acted_out) values (%L, 103, %L, %L, %L, true)',
           c_common_point, 'q', 'a', v_common));
  if verify.refused_by(
       format('insert into questions (point_id, position, prompt, expected_answer, is_acted_out) values (%L, 104, %L, %L, true)',
              c_common_point, 'q', 'a')) is not null then
    insert into verify.failures values ('a question acted out alone was refused');
  end if;
  insert into questions (point_id, position, prompt, expected_answer, scene_id, is_published)
    values (c_common_point, 105, 'Is the box small?', 'No, it''s big.', v_common, true);
  insert into questions (point_id, position, prompt, expected_answer, scene_id, is_published)
    values (c_common_point, 106, 'Draft', 'a', v_unpublished, false);

  -- A scene a question shows is not deleted from under it.
  begin
    delete from scenes where id = v_common;
    insert into verify.failures values ('a scene shown by a question was deleted');
  exception when foreign_key_violation then
    raise notice 'deleting a scene a question shows: refused by questions_scene_id_fkey';
  end;

  -- Who reads and writes a scene ---------------------------------------------------------
  set local role authenticated;

  perform set_config('test.uid', c_student::text, false);
  if not exists (select 1 from scenes where id = v_common) then
    insert into verify.failures values ('a student does not read the scene of a published question');
  end if;
  if exists (select 1 from scenes where id = v_unpublished) then
    insert into verify.failures values ('a student reads the scene of an unpublished question');
  end if;

  perform set_config('test.uid', c_teacher_b::text, false);
  if not exists (select 1 from scenes where id = v_common) then
    insert into verify.failures values ('the teacher of B does not read a common scene');
  end if;
  if not verify.refused_for_privilege('insert into scenes (description) values (''B writes common'')') then
    insert into verify.failures values ('the teacher of B wrote a common scene');
  end if;

  perform set_config('test.uid', c_admin::text, false);
  if verify.refused_for_privilege('insert into scenes (description) values (''admin writes common'')') then
    insert into verify.failures values ('the platform admin could not write a common scene');
  end if;

  reset role;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'scenes: %', v_failures;
  end if;

  raise notice 'scenes: a question shows a word, a scene or is acted out, at most one';
  raise notice 'and a scene''s picture is approved as a word''s, its reader follows the question';
end;
$$;

-- A scene is drawn from approved pictures (0033) ---------------------------------------
--
-- A list of 1 to 5 paths under references/, on a scene or on a generated
-- attempt of one, and never next to a single reference_path.
do $$
declare
  c_word constant uuid := (select id from vocabulary_items where term = 'a word');
  c_two constant text := '{references/scenes/s/pen.jpg,references/scenes/s/book.jpg}';
  v_failures text;
  v_scene uuid;
begin
  delete from verify.failures;

  insert into scenes (description) values ('The pen on the book') returning id into v_scene;

  -- The list, on a scene ----------------------------------------------------------------
  if verify.refused_by(format('update scenes set composed_from = %L where id = %L', c_two, v_scene)) is not null then
    insert into verify.failures values ('a scene could not be drawn from two pictures');
  end if;
  perform verify.expect_refused('a scene drawn from no picture', 'scenes_composed_from_shape',
    format('update scenes set composed_from = ''{}'' where id = %L', v_scene));
  perform verify.expect_refused('a scene drawn from six pictures', 'scenes_composed_from_shape',
    format('update scenes set composed_from = ''{references/1,references/2,references/3,references/4,references/5,references/6}'' where id = %L', v_scene));
  perform verify.expect_refused('a scene drawn from a word''s own picture', 'scenes_composed_from_shape',
    format('update scenes set composed_from = ''{references/scenes/s/pen.jpg,w/book.jpg}'' where id = %L', v_scene));
  perform verify.expect_refused('a scene drawn from a null picture', 'scenes_composed_from_shape',
    format('update scenes set composed_from = ''{references/scenes/s/pen.jpg,NULL}'' where id = %L', v_scene));
  perform verify.expect_refused('a scene drawn from a grid of pictures', 'scenes_composed_from_shape',
    format('update scenes set composed_from = ''{{references/a,references/b},{references/c,references/d}}'' where id = %L', v_scene));
  perform verify.expect_refused('a scene with a reference and a list', 'scenes_one_kind_of_reference',
    format('update scenes set reference_path = ''references/scenes/s/r.jpg'' where id = %L', v_scene));

  -- The list, on an attempt -------------------------------------------------------------
  if verify.refused_by(
       format('insert into image_attempts (scene_id, provider, model, status, composed_from) values (%L, ''freepik'', ''seedream-v4-5-edit'', ''pending'', %L)',
              v_scene, c_two)) is not null then
    insert into verify.failures values ('a scene''s generation could not be drawn from two pictures');
  end if;
  perform verify.expect_refused('a generation drawn from no picture', 'image_attempts_composed_from_shape',
    format('insert into image_attempts (scene_id, provider, status, composed_from) values (%L, ''freepik'', ''pending'', ''{}'')', v_scene));
  perform verify.expect_refused('a generation drawn from a word''s own picture', 'image_attempts_composed_from_shape',
    format('insert into image_attempts (scene_id, provider, status, composed_from) values (%L, ''freepik'', ''pending'', ''{w/book.jpg}'')', v_scene));
  perform verify.expect_refused('a generation with a reference and a list', 'image_attempts_one_kind_of_reference',
    format('insert into image_attempts (scene_id, provider, status, reference_path, composed_from) values (%L, ''freepik'', ''pending'', ''references/scenes/s/r.jpg'', %L)',
           v_scene, c_two));
  perform verify.expect_refused('a word''s generation drawn from a list', 'image_attempts_composed_only_for_a_generated_scene',
    format('insert into image_attempts (vocabulary_item_id, provider, status, composed_from) values (%L, ''freepik'', ''pending'', %L)',
           c_word, c_two));
  perform verify.expect_refused('an upload drawn from a list', 'image_attempts_composed_only_for_a_generated_scene',
    format('insert into image_attempts (scene_id, provider, status, storage_path, credits_spent, completed_at, composed_from) values (%L, ''upload'', ''generated'', ''scenes/s/a.png'', 0, now(), %L)',
           v_scene, c_two));

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'composed_from: %', v_failures;
  end if;

  raise notice 'composed_from: 1 to 5 pictures under references/, on a scene or its generated attempt, never with reference_path';
end;
$$;

-- A scene set aside keeps its cost (0034) ----------------------------------------------
--
-- Archiving keeps the row and its attempts; a question and an archived scene
-- never meet, from either side; a description is unique among the scenes in
-- use only.
do $$
declare
  c_point constant uuid := (select p.id from points p join books b on b.id = p.book_id
                             where b.title = 'Book 2' and p.number = 53);
  v_failures text;
  v_shown uuid;
  v_loose uuid;
  v_other uuid;
  v_question uuid;
  v_credits bigint;
begin
  delete from verify.failures;

  insert into scenes (description) values ('A shown box') returning id into v_shown;
  insert into scenes (description) values ('A loose box') returning id into v_loose;
  insert into scenes (description) values ('Another box') returning id into v_other;
  insert into questions (point_id, position, prompt, expected_answer, scene_id)
    values (c_point, 201, 'q', 'a', v_shown) returning id into v_question;
  insert into image_attempts (scene_id, provider, model, status, credits_spent)
    values (v_loose, 'freepik', 'seedream-v4', 'pending', 50);

  -- A scene a question shows is not archived.
  perform verify.expect_refused('archiving a scene a question shows', 'scenes_in_use_stays',
    format('update scenes set archived_at = now() where id = %L', v_shown));

  -- One that no question shows is, and its attempts and their cost stay.
  v_credits := (select sum(credits_spent) from image_attempts);
  if verify.refusal(format('update scenes set archived_at = now() where id = %L', v_loose)) is not null then
    insert into verify.failures values ('a scene no question shows could not be archived');
  end if;
  if (select sum(credits_spent) from image_attempts) is distinct from v_credits
     or not exists (select 1 from image_attempts where scene_id = v_loose) then
    insert into verify.failures values ('archiving a scene took its attempts or their cost');
  end if;

  -- An archived scene is shown by no question, written new or moved to it.
  perform verify.expect_refused('a new question showing an archived scene', 'questions_scene_in_use',
    format('insert into questions (point_id, position, prompt, expected_answer, scene_id) values (%L, 202, %L, %L, %L)',
           c_point, 'q', 'a', v_loose));
  perform verify.expect_refused('a question moved to an archived scene', 'questions_scene_in_use',
    format('update questions set scene_id = %L where id = %L', v_loose, v_question));
  -- Moving it to a scene in use still works.
  if verify.refusal(format('update questions set scene_id = %L where id = %L', v_other, v_question)) is not null then
    insert into verify.failures values ('a question could not move to a scene in use');
  end if;

  -- A description is taken only among the scenes in use.
  begin
    insert into scenes (description) values ('another   BOX');
    insert into verify.failures values ('a description in use was written twice');
  exception when unique_violation then
    raise notice 'a description in use, written again: refused by scenes_description_key';
  end;
  if verify.refusal('insert into scenes (description) values (''a loose box'')') is not null then
    insert into verify.failures values ('the description of an archived scene could not be used again');
  end if;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'archived scenes: %', v_failures;
  end if;

  raise notice 'archived scenes: kept with their cost, shown by no question, their description free again';
end;
$$;

-- A lesson marks where she stopped (0035) -------------------------------------------
--
-- A mark names a common point, and a point someone stopped at is not deleted.
-- Seeded as the owner: the rules under test are a trigger and a foreign key,
-- which no policy decides. Since 0043 there is no point of an organization, so
-- lessons_stop_in_organization has nothing left to refuse here.
do $$
declare
  c_lesson constant uuid := (select id from lessons
                              where student_id = '22222222-2222-2222-2222-222222222222'
                              order by scheduled_at limit 1);
  c_common constant uuid := (select p.id from points p join books b on b.id = p.book_id
                              where b.title = 'Book 2' and p.number = 53);
  -- A common point that no word, block or question holds: a word's point is
  -- restricted already, and the refusal would come from vocabulary_items
  -- instead. Point 127 of Book 2 carries nothing.
  c_bare constant uuid := (select p.id from points p join books b on b.id = p.book_id
                            where b.title = 'Book 2' and p.number = 127);
  v_failures text;
begin
  delete from verify.failures;

  -- A common point is accepted.
  if verify.refusal(format('update lessons set stopped_at_point_id = %L where id = %L', c_common, c_lesson)) is not null then
    insert into verify.failures values ('a lesson could not mark a common point');
  end if;

  -- The point a lesson stopped at is not deleted.
  if verify.refusal(format('update lessons set stopped_at_point_id = %L where id = %L', c_bare, c_lesson)) is not null then
    insert into verify.failures values ('a lesson could not mark a bare common point');
  end if;
  perform verify.expect_refusal('deleting a point a lesson stopped at',
    '23503 update or delete on table "points" violates foreign key constraint "lessons_stopped_at_point_fkey" on table "lessons"',
    format('delete from points where id = %L', c_bare));

  update lessons set stopped_at_point_id = null where id = c_lesson;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'where she stopped: %', v_failures;
  end if;

  raise notice 'where she stopped: a common point is marked, and a marked point stays';
end;
$$;

-- A lead waits for a call (0036) --------------------------------------------------------
--
-- The checks refuse what the site's form must never write, each by its own
-- name, and accept the limits themselves. This block runs after 0037 and
-- 0038: the revoke all of 0036 is held by the snapshot right after 0036 above,
-- and the number, the privileges and the policies of leads as they stand now
-- by the block of 0038 below. Rows are written as the superuser running this
-- script, since checks hold for everyone and nobody of the API selects.
--
-- One well formed lead, with any column replaced by a named argument. The
-- number has the 55 that leads_whatsapp_br (0038) asks for.
create function verify.lead_insert(
  p_nome text default 'Ana Souza',
  p_whatsapp text default '5511987654321',
  p_objetivo text default 'trabalho',
  p_nivel text default 'basico',
  p_interesse text default 'trial',
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_codigo_origem text default null,
  p_user_agent text default null
) returns text
language sql as $$
  select format(
    'insert into public.leads (nome, whatsapp, objetivo, nivel, interesse, utm_source, utm_medium, utm_campaign, codigo_origem, user_agent) values (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
    p_nome, p_whatsapp, p_objetivo, p_nivel, p_interesse,
    p_utm_source, p_utm_medium, p_utm_campaign, p_codigo_origem, p_user_agent);
$$;

-- A statement that has to go in; a refusal is recorded with what refused it.
create function verify.expect_accepted(p_what text, p_sql text)
returns void
language plpgsql as $$
declare
  v_by text := verify.refusal(p_sql);
begin
  if v_by is not null then
    insert into verify.failures values (format('%s: refused with %s', p_what, v_by));
  else
    raise notice '%: accepted', p_what;
  end if;
end;
$$;

do $$
declare
  v_failures text;
begin
  delete from verify.failures;

  -- The name: at most 80 characters as stored, and at least 2 once spaces,
  -- tabs and line breaks at either end are left out.
  perform verify.expect_refused('a lead named with 1 character', 'leads_nome_length',
    verify.lead_insert(p_nome => 'A'));
  perform verify.expect_refused('a lead named with 81 characters', 'leads_nome_length',
    verify.lead_insert(p_nome => repeat('a', 81)));
  perform verify.expect_refused('a lead named with 2 letters and 79 trailing spaces',
    'leads_nome_length', verify.lead_insert(p_nome => 'Al' || repeat(' ', 79)));
  perform verify.expect_refused('a lead named with spaces only', 'leads_nome_length',
    verify.lead_insert(p_nome => '     '));
  perform verify.expect_refused('a lead named with a tab and line breaks only',
    'leads_nome_length', verify.lead_insert(p_nome => E'\t\n\r'));
  perform verify.expect_accepted('a lead named with 2 characters',
    verify.lead_insert(p_nome => 'Al'));
  perform verify.expect_accepted('a lead named with 80 characters',
    verify.lead_insert(p_nome => repeat('a', 80)));
  perform verify.expect_accepted('a lead named with 2 letters inside a tab, spaces and a line break',
    verify.lead_insert(p_nome => E'\t Al \n'));

  -- The answers: only the listed values; objetivo and nivel may be left out,
  -- interesse may not.
  perform verify.expect_refused('an objetivo off the list', 'leads_objetivo_known',
    verify.lead_insert(p_objetivo => 'estudo'));
  perform verify.expect_refused('a nivel off the list', 'leads_nivel_known',
    verify.lead_insert(p_nivel => 'avancado'));
  perform verify.expect_refused('an interesse off the list', 'leads_interesse_known',
    verify.lead_insert(p_interesse => 'curso'));
  perform verify.expect_refusal('a lead with no interesse', '23502 interesse',
    verify.lead_insert(p_interesse => null));
  perform verify.expect_accepted('a lead with no objetivo and no nivel',
    verify.lead_insert(p_objetivo => null, p_nivel => null));

  -- The tracking: 200 characters at most, 512 for the User-Agent.
  perform verify.expect_refused('a utm_source of 201 characters', 'leads_utm_source_length',
    verify.lead_insert(p_utm_source => repeat('s', 201)));
  perform verify.expect_refused('a utm_medium of 201 characters', 'leads_utm_medium_length',
    verify.lead_insert(p_utm_medium => repeat('m', 201)));
  perform verify.expect_refused('a utm_campaign of 201 characters', 'leads_utm_campaign_length',
    verify.lead_insert(p_utm_campaign => repeat('c', 201)));
  perform verify.expect_refused('a codigo_origem of 201 characters', 'leads_codigo_origem_length',
    verify.lead_insert(p_codigo_origem => repeat('o', 201)));
  perform verify.expect_refused('a user_agent of 513 characters', 'leads_user_agent_length',
    verify.lead_insert(p_user_agent => repeat('u', 513)));
  perform verify.expect_accepted('a lead with every tracking column at its limit',
    verify.lead_insert(p_utm_source => repeat('s', 200), p_utm_medium => repeat('m', 200),
                       p_utm_campaign => repeat('c', 200), p_codigo_origem => repeat('o', 200),
                       p_user_agent => repeat('u', 512)));

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'leads: %', v_failures;
  end if;

  raise notice 'leads: every check refuses by name and accepts its limits';
end;
$$;

-- A lead comes through one door (0038) -------------------------------------------------
--
-- The site writes a lead only by calling submit_lead, as anon, with the
-- publishable key. Nobody of the API reads leads or leads_latest, and the
-- service role, which inserted straight into the table until 0038, no longer
-- can. The door does not open around the checks: a number without the 55 is
-- refused through submit_lead by the same check as straight into the table.
-- A number sent twice is kept twice, and leads_latest shows the latest send of
-- each number.
--
-- The calls are made as the roles themselves, and the helpers of verify run
-- under them, so anon and service_role get usage on that schema here, as
-- authenticated did above. The schema is this script's own; production has no
-- verify. Whatever is found is recorded after reset role, as the superuser.
grant usage on schema verify to anon, service_role;

-- One call of submit_lead the way PostgREST makes it for the site: every
-- parameter named, the ones the form left empty as null.
create function verify.submit_lead_call(p_whatsapp text, p_interesse text default 'trial')
returns text
language sql as $$
  select format(
    'select public.submit_lead(nome => %L, whatsapp => %L, objetivo => %L, nivel => %L, interesse => %L, utm_source => %L, utm_medium => %L, utm_campaign => %L, codigo_origem => %L, user_agent => %L)',
    'Bruna Lima', p_whatsapp, 'viagem', null, p_interesse,
    'instagram', null, null, '[verify]', 'verify-rls');
$$;

do $$
declare
  c_roles constant text[] := array['anon', 'authenticated', 'service_role'];
  c_privileges constant text[] := array['select', 'insert', 'update', 'delete',
                                        'truncate', 'references', 'trigger', 'maintain'];
  -- Sent twice, first for the waitlist and then for a trial; and sent once.
  c_twice constant text := '5521999990001';
  c_once constant text := '5521999990002';
  v_mark bigint := 0;
  v_rows bigint;
  v_refused boolean;
  v_by text;
  v_state text;
  v_constraint text;
  v_role text;
  v_relation text;
  v_privilege text;
  v_reached text[] := '{}';
  v_definer boolean;
  v_config text[];
  v_options text[];
  v_failures text;
begin
  delete from verify.failures;

  -- anon calls submit_lead, and the row is there.
  select count(*) into v_rows from public.leads;
  set local role anon;
  v_refused := verify.refused_for_privilege(verify.submit_lead_call('5511912345678'));
  reset role;
  if v_refused then
    insert into verify.failures values ('anon is refused submit_lead');
  elsif (select count(*) from public.leads) <> v_rows + 1 then
    insert into verify.failures values (format('anon called submit_lead and leads went from %s to %s rows',
                                               v_rows, (select count(*) from public.leads)));
  else
    raise notice 'anon calls submit_lead, and the lead is written';
  end if;
  v_mark := (select count(*) from verify.failures);

  -- Nobody else calls it: not authenticated, which PUBLIC would let in, and
  -- not the service role, which the site no longer holds.
  foreach v_role in array array['authenticated', 'service_role'] loop
    execute format('set local role %I', v_role);
    v_refused := verify.refused_for_privilege(verify.submit_lead_call('5511912345679'));
    reset role;
    if not v_refused then
      insert into verify.failures values (format('%s calls submit_lead', v_role));
    end if;
  end loop;
  if (select count(*) from verify.failures) = v_mark then
    raise notice 'authenticated and service_role are refused submit_lead';
  end if;
  v_mark := (select count(*) from verify.failures);

  -- anon has the function and nothing else: no insert of its own, no read.
  set local role anon;
  if not verify.refused_for_privilege(verify.lead_insert()) then
    v_reached := v_reached || 'inserts into leads'::text;
  end if;
  if not verify.refused_for_privilege('select 1 from public.leads') then
    v_reached := v_reached || 'selects from leads'::text;
  end if;
  if not verify.refused_for_privilege('select 1 from public.leads_latest') then
    v_reached := v_reached || 'selects from leads_latest'::text;
  end if;
  reset role;
  insert into verify.failures select 'anon ' || r from unnest(v_reached) r;
  if (select count(*) from verify.failures) = v_mark then
    raise notice 'anon inserts into leads and selects from leads and leads_latest only to be refused';
  end if;
  v_mark := (select count(*) from verify.failures);

  -- None of the eight a table can carry, for any of the three roles, on the
  -- table or the view; and no policy on the table. has_table_privilege also
  -- sees what reaches a role through PUBLIC.
  foreach v_relation in array array['public.leads', 'public.leads_latest'] loop
    foreach v_role in array c_roles loop
      foreach v_privilege in array c_privileges loop
        if has_table_privilege(v_role, v_relation, v_privilege) then
          insert into verify.failures
            values (format('%s has %s on %s', v_role, v_privilege, v_relation));
        end if;
      end loop;
    end loop;
  end loop;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'leads') <> 0 then
    insert into verify.failures values ('leads has a policy');
  end if;
  if (select count(*) from verify.failures) = v_mark then
    raise notice 'anon, authenticated and service_role hold no privilege on leads or leads_latest, and leads has no policy';
  end if;
  v_mark := (select count(*) from verify.failures);

  -- The function writes as its owner and resolves no name through the
  -- caller's search_path; the view reads as whoever queries it, so it opens
  -- nothing the table keeps closed.
  select p.prosecdef, p.proconfig into v_definer, v_config
    from pg_proc p
   where p.oid = to_regprocedure(
           'public.submit_lead(text, text, text, text, text, text, text, text, text, text)');
  if v_definer is distinct from true then
    insert into verify.failures values ('submit_lead is not security definer');
  end if;
  if v_config is distinct from array['search_path=""'] then
    insert into verify.failures values (format('submit_lead runs with %s, expected {search_path=""}',
                                               coalesce(v_config::text, 'no setting')));
  end if;
  select c.reloptions into v_options from pg_class c where c.oid = to_regclass('public.leads_latest');
  if not coalesce('security_invoker=true' = any (v_options), false) then
    insert into verify.failures values (format('leads_latest has options %s, expected security_invoker=true',
                                               coalesce(v_options::text, 'none')));
  end if;
  if (select count(*) from verify.failures) = v_mark then
    raise notice 'submit_lead is security definer with an empty search_path, and leads_latest is security invoker';
  end if;
  v_mark := (select count(*) from verify.failures);

  -- The number: 55, then 10 or 11 digits, and nothing else.
  perform verify.expect_refused('a whatsapp without 55, 11 digits', 'leads_whatsapp_br',
    verify.lead_insert(p_whatsapp => '11987654321'));
  perform verify.expect_refused('a whatsapp without 55, 10 digits', 'leads_whatsapp_br',
    verify.lead_insert(p_whatsapp => '1133334444'));
  perform verify.expect_refused('a whatsapp of another country', 'leads_whatsapp_br',
    verify.lead_insert(p_whatsapp => '5611987654321'));
  perform verify.expect_refused('a whatsapp of 11 digits with 55', 'leads_whatsapp_br',
    verify.lead_insert(p_whatsapp => '55119876543'));
  perform verify.expect_refused('a whatsapp of 14 digits', 'leads_whatsapp_br',
    verify.lead_insert(p_whatsapp => '55119876543210'));
  perform verify.expect_refused('a whatsapp with a plus sign', 'leads_whatsapp_br',
    verify.lead_insert(p_whatsapp => '+5511987654321'));
  perform verify.expect_refused('a whatsapp with a mask', 'leads_whatsapp_br',
    verify.lead_insert(p_whatsapp => '+55 (11) 98765-4321'));
  perform verify.expect_accepted('a whatsapp of 12 digits with 55',
    verify.lead_insert(p_whatsapp => '551133334444'));
  perform verify.expect_accepted('a whatsapp of 13 digits with 55',
    verify.lead_insert(p_whatsapp => '5511987654321'));

  -- And through the door, as anon: the same check, by name. Any refusal is
  -- caught, so a door that refuses anon for privilege is reported here too
  -- rather than stopping the script; leaving the block undoes the set role.
  begin
    set local role anon;
    execute verify.submit_lead_call('11987654321');
    reset role;
    v_by := 'accepted';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
    v_by := v_state || coalesce(' ' || nullif(v_constraint, ''), '');
  end;
  if v_by <> '23514 leads_whatsapp_br' then
    insert into verify.failures values (format(
      'a whatsapp without 55 through submit_lead: %s, expected 23514 leads_whatsapp_br', v_by));
  else
    raise notice 'a whatsapp without 55 through submit_lead: refused with %', v_by;
  end if;
  v_mark := (select count(*) from verify.failures);

  -- The history. Three sends as anon, in one transaction, as close together as
  -- this script can make them: the same number twice, then another number.
  -- Each send is a row; the latest of each number is in leads_latest. The two
  -- sends of the same number get two different instants, in the order they
  -- were made: with now() they would share the instant of the transaction,
  -- and the view would choose between them by a random id.
  begin
    set local role anon;
    execute verify.submit_lead_call(c_twice, 'waitlist');
    execute verify.submit_lead_call(c_twice, 'trial');
    execute verify.submit_lead_call(c_once, 'waitlist');
    reset role;
  exception when insufficient_privilege then
    insert into verify.failures values ('anon could not send the history: ' || sqlerrm);
  end;
  v_rows := (select count(*) from public.leads where whatsapp = c_twice);
  if v_rows <> 2 then
    insert into verify.failures values (format('a number sent twice has %s rows in leads, expected 2', v_rows));
  end if;
  if (select count(distinct created_at) from public.leads where whatsapp = c_twice) <> 2
     or (select created_at from public.leads where whatsapp = c_twice and interesse = 'trial')
        <= (select created_at from public.leads where whatsapp = c_twice and interesse = 'waitlist') then
    insert into verify.failures values ('the second send of a number is not later than the first');
  end if;
  if (select array_agg(interesse) from public.leads_latest where whatsapp = c_twice)
     is distinct from array['trial'] then
    insert into verify.failures values (format('leads_latest shows %s for the number sent twice, expected {trial}',
      coalesce((select array_agg(interesse) from public.leads_latest where whatsapp = c_twice)::text, 'no row')));
  end if;
  if (select array_agg(interesse) from public.leads_latest where whatsapp = c_once)
     is distinct from array['waitlist'] then
    insert into verify.failures values (format('leads_latest shows %s for the number sent once, expected {waitlist}',
      coalesce((select array_agg(interesse) from public.leads_latest where whatsapp = c_once)::text, 'no row')));
  end if;
  if (select count(*) from public.leads_latest)
     <> (select count(distinct whatsapp) from public.leads) then
    insert into verify.failures values ('leads_latest does not have exactly one row per number');
  end if;
  if (select count(*) from verify.failures) = v_mark then
    raise notice 'a number sent twice is two rows in leads and one in leads_latest, the later one; another number keeps its own';
  end if;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'a lead comes through one door: %', v_failures;
  end if;
end;
$$;

-- A narrowing names a point she stopped at (0039) ---------------------------------------
--
-- materialize_points counts, before it deletes anything, the points outside the
-- new range that a lesson stopped at, and refuses by naming them. Until 0039 it
-- did not, and the delete ran into lessons_stopped_at_point_fkey (23503), a
-- refusal the teacher could not read. Point 128 of Book 2 carries no content
-- and no lesson of content reaches it, so the mark is the only reason left.
-- Written as the owner, with test.uid on the platform admin, who alone may
-- configure a common book.
--
-- The English sentence is the one src/app/teacher/content/range-refusal.test.ts
-- translates: a change to it is made in both places.
do $$
declare
  c_book constant uuid := (select id from books where title = 'Book 2');
  c_lesson constant uuid := (select id from lessons
                              where student_id = '22222222-2222-2222-2222-222222222222'
                              order by scheduled_at limit 1);
  c_point constant uuid := (select id from points where book_id = c_book and number = 128);
  v_failures text;
begin
  delete from verify.failures;
  perform set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);

  update lessons set stopped_at_point_id = c_point where id = c_lesson;

  perform verify.expect_refusal('narrowing a book past the point a lesson stopped at',
    format('P0001 cannot narrow book %s to 1..127: 0 point(s) outside carry content, '
           '0 lesson(s) reach outside, 1 point(s) outside are where a lesson stopped', c_book),
    format('select materialize_points(%L, 1, 127)', c_book));

  -- The refusal wrote nothing: the book keeps its range and the lesson its mark.
  if (select last_point from books where id = c_book) <> 128 then
    insert into verify.failures values ('the refused narrowing changed the range of the book');
  end if;
  if not exists (select 1 from lessons where id = c_lesson and stopped_at_point_id = c_point) then
    insert into verify.failures values ('the refused narrowing took the point the lesson stopped at');
  end if;

  update lessons set stopped_at_point_id = null where id = c_lesson;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'a narrowing names a point she stopped at: %', v_failures;
  end if;

  raise notice 'a narrowing names a point she stopped at, and the refusal writes nothing';
end;
$$;

-- Every row knows its organization (0040) -----------------------------------------------
--
-- Every assertion above this block, from the fixtures on, already ran against
-- the renamed database: that is the proof the behaviour stayed. This block
-- holds what a rename can lose without any behaviour failing first.
--
-- 1. Nothing of public still says school: no relation, column, type, enum
--    label, function (name, arguments, result, body), trigger, constraint,
--    index or policy (name and expressions), and no policy of storage. A body
--    is text, so a rename of a table or column never reaches it: only this
--    finds a body left behind.
-- 2. Execute on the six functions the app and the policies call, for anon,
--    authenticated and service_role, as measured on the project on
--    2026-11-06 before 0040 (has_function_privilege, so PUBLIC counts). Three
--    of them are new functions and one was dropped and created again: a lost
--    grant shows here. This block runs after 0047 (#148), which took execute
--    on the first three away from PUBLIC and gave it to authenticated alone.
-- 3. The 16 functions 0040 rewrites keep security definer or invoker and
--    their search_path as on the project: create or replace resets both to
--    whatever it is given.
--
-- That row level security stays on for the three renamed tables is held by
-- the block "every table in public has row level security enabled", which
-- runs after 0040 since the move of its \i line.
do $$
declare
  v_failures text;
  v_before bigint := 0;
begin
  delete from verify.failures;

  insert into verify.failures
  select 'still says school: ' || what
    from (
      select format('relation %s', c.relname) as what, c.relname::text as text
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
      union all
      -- The columns of an index too: an index keeps, as its own attribute
      -- name, the name its column had when the index was built, and a rename
      -- of the table's column does not reach it.
      select format('column %s.%s', c.relname, a.attname), a.attname::text
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
      union all
      select format('type %s', t.typname), t.typname::text
        from pg_type t join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public'
      union all
      select format('enum label %s.%s', t.typname, e.enumlabel), e.enumlabel::text
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public'
      union all
      select format('function %s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
             concat_ws(' ', p.proname, pg_get_function_arguments(p.oid),
                       pg_get_function_result(p.oid), p.prosrc)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
      union all
      select format('trigger %s on %s', t.tgname, t.tgrelid::regclass), pg_get_triggerdef(t.oid)
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_proc p on p.oid = t.tgfoid
        join pg_namespace pn on pn.oid = p.pronamespace
       where not t.tgisinternal and (n.nspname = 'public' or pn.nspname = 'public')
      union all
      select format('constraint %s on %s', co.conname, co.conrelid::regclass),
             co.conname || ' ' || pg_get_constraintdef(co.oid)
        from pg_constraint co join pg_namespace n on n.oid = co.connamespace
       where n.nspname = 'public'
      union all
      select format('index %s', i.indexrelid::regclass), pg_get_indexdef(i.indexrelid)
        from pg_index i
        join pg_class c on c.oid = i.indrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
      union all
      select format('policy %s on %s.%s', pol.polname, n.nspname, c.relname),
             concat_ws(' ', pol.polname, pg_get_expr(pol.polqual, pol.polrelid),
                       pg_get_expr(pol.polwithcheck, pol.polrelid))
        from pg_policy pol
        join pg_class c on c.oid = pol.polrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'storage')
    ) found
   where found.text ilike '%school%'
   order by what;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'nothing of public, nor a policy of storage, says school: names, bodies and expressions';
  end if;
  v_before := (select count(*) from verify.failures);

  with expected (fn, anon, authenticated, service_role) as (values
    ('is_organization_member(uuid,organization_role[])', false, true, false),
    ('can_invite(uuid,organization_role)', false, true, false),
    ('can_write_content(uuid)', false, true, false),
    ('my_open_organization_invites()', false, true, false),
    ('accept_my_organization_invite(uuid)', false, true, false),
    ('accept_organization_invites(uuid,text)', false, false, false)
  )
  insert into verify.failures
  select format('execute on %s: anon %s, authenticated %s, service_role %s; expected %s, %s, %s',
                e.fn,
                has_function_privilege('anon', e.fn, 'execute'),
                has_function_privilege('authenticated', e.fn, 'execute'),
                has_function_privilege('service_role', e.fn, 'execute'),
                e.anon, e.authenticated, e.service_role)
    from expected e
   where has_function_privilege('anon', e.fn, 'execute') <> e.anon
      or has_function_privilege('authenticated', e.fn, 'execute') <> e.authenticated
      or has_function_privilege('service_role', e.fn, 'execute') <> e.service_role;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'execute on the six invite and membership functions is held by anon, authenticated and service_role as on the project before 0040, and as 0047 left it';
  end if;
  v_before := (select count(*) from verify.failures);

  with expected (fn, secdef, config) as (values
    ('accept_my_organization_invite', true, 'search_path=public'),
    ('accept_organization_invites', true, 'search_path=public'),
    ('accept_organization_invites_on_confirmation', true, 'search_path=public'),
    ('belongs_anywhere', true, 'search_path=public'),
    ('can_invite', true, 'search_path=public'),
    ('can_write_content', true, 'search_path=public'),
    ('is_organization_member', true, 'search_path=public'),
    ('lesson_stop_in_organization', true, 'search_path=public'),
    ('my_open_organization_invites', true, 'search_path=public'),
    ('organization_follows_parents', true, 'search_path=public'),
    ('teaches_anywhere', true, 'search_path=public'),
    ('delete_question', false, 'search_path=public'),
    ('reorder_questions', false, 'search_path=public'),
    ('materialize_lessons', false, null),
    ('materialize_points', false, null),
    ('organization_invites_fifteen_days', false, null)
  ),
  actual as (
    select p.proname::text as fn, p.prosecdef as secdef,
           array_to_string(p.proconfig, ',') as config
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  )
  insert into verify.failures
  select format('function %s: security definer %s and config %s, expected %s and %s',
                e.fn, a.secdef, coalesce(a.config, 'none'), e.secdef, coalesce(e.config, 'none'))
    from expected e
    left join actual a on a.fn = e.fn
   where a.fn is null
      or a.secdef is distinct from e.secdef
      or a.config is distinct from e.config;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'the 16 functions 0040 rewrites keep security definer or invoker, and their search_path';
  end if;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'every row knows its organization: %', v_failures;
  end if;
end;
$$;

-- An organization wears a brand (0041) ---------------------------------------------------
--
-- Every organization names one of the two brands, and nobody but the platform
-- admin changes it. Each assertion stands on one clause of 0041 or on the
-- policy it relies on:
--
-- 1. The rows already there wear Chelsea St (the default that filled them),
--    and GrifoAI's organization exists wearing GrifoAI (the insert).
-- 2. A brand outside the two is refused by organizations_brand_known.
-- 3. An organization written without a brand is refused (23502 on brand):
--    the default is gone.
-- 4. An organization's admin, not a platform admin, changes her own
--    organization's brand in no row; the platform admin does, which shows the
--    statement could have changed it (organizations_write).
-- 5. A member reads her own organization's brand and not another's
--    (organizations_read).
--
-- The admin of B is made here, as the owner, and removed at the end: the
-- fixtures above give B a teacher and a student only.
do $$
declare
  c_chelsea constant uuid := (select id from organizations where slug = 'chelsea-st');
  c_b constant uuid := (select id from organizations where slug = 'escola-b');
  c_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  c_student constant uuid := '22222222-2222-2222-2222-222222222222';
  c_admin_b constant uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_n integer;
  v_brand text;
  v_state text;
  v_column text;
  v_failures text;
begin
  delete from verify.failures;

  -- 1. The rows 0041 found and the one it adds.
  if (select brand from organizations where id = c_chelsea) is distinct from 'chelsea-st' then
    insert into verify.failures values ('Chelsea St does not wear chelsea-st');
  end if;
  if (select brand from organizations where slug = 'grifoai') is distinct from 'grifoai' then
    insert into verify.failures values ('there is no grifoai organization wearing grifoai');
  end if;

  -- 2. Only the two brands.
  perform verify.expect_refused(
    'an organization wearing an unknown brand', 'organizations_brand_known',
    $q$insert into organizations (slug, name, brand, has_teacher) values ('outra', 'Outra', 'outra', true)$q$);

  -- 3. No default: a new organization names its brand.
  begin
    insert into organizations (slug, name, has_teacher) values ('sem-marca', 'Sem marca', true);
    insert into verify.failures values ('an organization without a brand was accepted');
    delete from organizations where slug = 'sem-marca';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_column = column_name;
    if v_state <> '23502' or v_column is distinct from 'brand' then
      insert into verify.failures values (format(
        'an organization without a brand was refused with %s on %s, expected 23502 on brand',
        v_state, coalesce(v_column, 'no column')));
    else
      raise notice 'an organization without a brand: refused, 23502 on brand';
    end if;
  end;

  insert into auth.users (id, email, raw_user_meta_data)
    values (c_admin_b, 'admin-b@example.com', null);
  insert into organization_members (organization_id, user_id, role)
    values (c_b, c_admin_b, 'admin');

  set local role authenticated;

  -- 4. Her own organization's admin changes nothing.
  perform set_config('test.uid', c_admin_b::text, false);
  update organizations set brand = 'chelsea-st' where id = c_b;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    insert into verify.failures values (format('the admin of B changed B''s brand in %s rows', v_n));
  end if;

  -- The platform admin does, and puts it back.
  perform set_config('test.uid', c_admin::text, false);
  update organizations set brand = 'chelsea-st' where id = c_b;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    insert into verify.failures values (format('the platform admin changed B''s brand in %s rows', v_n));
  end if;
  update organizations set brand = 'grifoai' where id = c_b;

  -- 5. Each member reads her own organization's brand and no other. The admin
  -- of B, made above, belongs to B alone (the teacher of B joined Chelsea in
  -- the block of 0032).
  perform set_config('test.uid', c_admin_b::text, false);
  select count(*) into v_n from organizations;
  select brand into v_brand from organizations where id = c_b;
  if v_n <> 1 or v_brand is distinct from 'grifoai' then
    insert into verify.failures values (format(
      'the admin of B reads %s organizations, B wearing %s', v_n, coalesce(v_brand, 'nothing')));
  end if;
  perform set_config('test.uid', c_student::text, false);
  select count(*) into v_n from organizations;
  select brand into v_brand from organizations where id = c_chelsea;
  if v_n <> 1 or v_brand is distinct from 'chelsea-st' then
    insert into verify.failures values (format(
      'the Chelsea student reads %s organizations, her own wearing %s', v_n, coalesce(v_brand, 'nothing')));
  end if;

  reset role;
  if (select brand from organizations where id = c_b) is distinct from 'grifoai' then
    insert into verify.failures values ('B no longer wears grifoai');
  end if;
  delete from organization_members where user_id = c_admin_b;
  delete from auth.users where id = c_admin_b;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'an organization wears a brand: %', v_failures;
  end if;

  raise notice 'every organization wears chelsea-st or grifoai, named on insert; only the platform admin changes it';
  raise notice 'a member reads her own organization''s brand and no other';
end;
$$;

-- Without a teacher, the admin does not teach (0042) --------------------------------------
--
-- An organization says whether it has a teacher. Where it has none, its admin
-- invites people and reads them, and holds no power of a teacher: no content,
-- common or its own, no lesson, schedule, assignment, attempt or review, no
-- image in Storage. Nobody is a teacher there. Where it has one, nothing
-- changed. Each assertion stands on one clause of 0042:
--
-- 1. Only the substitution: every policy of public and storage right after
--    0042 (policies_after_0042) equals its text before 0042
--    (policies_before_0042), except the 34 of the 17 tables, whose text is the
--    old one with the admin-or-teacher check replaced by
--    teaches_in(organization_id), and vocabulary_images_write, which then
--    asked teaches_in and named no role. Between two snapshots and not
--    against pg_policies: 0043 rewrites 11 of them again, and its own block
--    holds that.
-- 2. has_teacher: true on Chelsea St, false on GrifoAI's organization (the
--    update), and named on insert (no default, 23502).
-- 3. teaches_in, teaches_anywhere and can_write_content: false for the admin
--    of a company without a teacher; teaches_in and teaches_anywhere true for
--    a Chelsea admin who is not a platform admin, teaches_in for B's teacher.
--    That can_write_content is false for both since 0043 is held by its block.
-- 4. The company's admin reads no row of the 10 content tables and of the 7
--    operation tables that only a teacher reads (verify.teachers_only), though
--    rows of her organization and common rows exist;
--    writes no lesson, no schedule, no student; and materialize_lessons
--    refuses her. Content of her own cannot exist since 0043.
-- 5. Storage: she writes no file under her organization's folder. Since 0043
--    nobody but the platform admin writes there, held by its block.
-- 6. She still invites an employee and an admin, reads her organization's
--    invites, members and their names; an invite as teacher there is refused
--    by teacher_needs_a_teaching_organization, also from the platform admin,
--    and so is a teacher member written by the owner.
-- 7. An organization with a teacher member, or an open teacher invite, does
--    not turn into one without a teacher (organization_without_teacher_has_none);
--    the company's admin changes has_teacher in no row; and the check of a
--    teacher member or invite locks the organization's row, so the two
--    checks cannot pass each other.
-- 8. The employee still reads the common published questions, which is what
--    Robin will use, and her own lesson row (her own rows stay hers).
-- 9. A Chelsea admin who is not a platform admin still writes a Chelsea
--    student's lesson and materializes her lessons.
--
-- Seeded as the owner; read and written as authenticated. Failures are
-- collected and raised together.

-- The rows of a table only a teacher reads. Every member reads the published
-- questions (questions_read_published) and the scenes they show
-- (scenes_read_published): the employee needs them, and the admin of a company
-- is a member too. Everything else of the 17 tables is a teacher's.
create function verify.teachers_only(p_table text) returns text
language sql immutable as $$
  select case p_table
    when 'questions' then 'not is_published'
    when 'scenes' then 'not exists (select 1 from questions q where q.scene_id = scenes.id)'
    else 'true' end;
$$;

do $$
declare
  c_from constant text :=
    'is_organization_member(organization_id, ''{admin,teacher}''::organization_role[])';
  c_to constant text := 'teaches_in(organization_id)';
  c_tables constant text[] := array[
    'books', 'lessons_content', 'points', 'blocks', 'vocabulary_items',
    'image_attempts', 'contrast_sets', 'contrast_set_items', 'questions', 'scenes',
    'students', 'lessons', 'lesson_schedules', 'assignments', 'assignment_items',
    'attempts', 'review_schedule'];
  c_content constant text[] := array[
    'books', 'lessons_content', 'points', 'blocks', 'vocabulary_items',
    'image_attempts', 'contrast_sets', 'contrast_set_items', 'questions', 'scenes'];
  c_operation constant text[] := array[
    'students', 'lessons', 'lesson_schedules', 'assignments', 'assignment_items',
    'attempts', 'review_schedule'];
  c_chelsea constant uuid := (select id from organizations where slug = 'chelsea-st');
  c_b constant uuid := (select id from organizations where slug = 'escola-b');
  c_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  c_student constant uuid := '22222222-2222-2222-2222-222222222222';
  c_teacher_b constant uuid := '33333333-3333-3333-3333-333333333333';
  c_admin_c constant uuid := 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';
  c_employee constant uuid := 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1';
  c_admin_chelsea constant uuid := 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
  v_c uuid;
  v_d uuid;
  v_e uuid;
  v_question uuid;
  v_assignment uuid;
  v_table text;
  v_n integer;
  v_owner_n integer;
  v_moved integer;
  v_drift text;
  v_state text;
  v_column text;
  v_message text;
  v_failures text;
begin
  delete from verify.failures;

  -- 1. Only the substitution.
  with expected as (
    select schemaname, tablename, policyname, permissive, roles, cmd,
           case when schemaname = 'public' and tablename = any (c_tables)
                then replace(qual, c_from, c_to) else qual end as qual,
           case when schemaname = 'public' and tablename = any (c_tables)
                then replace(with_check, c_from, c_to) else with_check end as with_check
      from policies_before_0042
     where not (schemaname = 'storage' and policyname = 'vocabulary_images_write')
  ),
  actual as (
    select * from policies_after_0042
     where not (schemaname = 'storage' and policyname = 'vocabulary_images_write')
  ),
  drift as (
    (select 'expected but not held' as what, * from expected
     except select 'expected but not held', * from actual)
    union all
    (select 'held but not expected', * from actual
     except select 'held but not expected', * from expected)
  )
  select string_agg(format('%s: %s.%s', what, tablename, policyname), '; '
                    order by tablename, policyname, what)
    into v_drift from drift;
  if v_drift is not null then
    insert into verify.failures values ('policies beyond the substitution: ' || v_drift);
  end if;

  select count(*) into v_moved
    from policies_before_0042 b
    join policies_after_0042 p using (policyname)
   where b.schemaname = 'public' and p.schemaname = 'public'
     and b.tablename = p.tablename
     and (b.qual is distinct from p.qual or b.with_check is distinct from p.with_check);
  if v_moved <> 34 then
    insert into verify.failures values (format('%s policies of public changed, expected 34', v_moved));
  end if;
  if (select count(*) from policies_after_0042)
     <> (select count(*) from policies_before_0042) then
    insert into verify.failures values ('the number of policies changed');
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = any (c_tables)
                and (strpos(coalesce(qual, ''), c_from) > 0
                     or strpos(coalesce(with_check, ''), c_from) > 0)) then
    insert into verify.failures values ('a policy of the 17 tables still asks admin or teacher');
  end if;
  if not exists (select 1 from policies_after_0042
                  where schemaname = 'storage' and policyname = 'vocabulary_images_write'
                    and strpos(qual, 'teaches_in') > 0 and strpos(with_check, 'teaches_in') > 0
                    and strpos(qual, '''admin''') = 0 and strpos(with_check, '''admin''') = 0) then
    insert into verify.failures values ('vocabulary_images_write does not ask teaches_in, or still names a role');
  end if;

  -- 2. has_teacher.
  if (select has_teacher from organizations where id = c_chelsea) is distinct from true then
    insert into verify.failures values ('Chelsea St has no teacher');
  end if;
  if (select has_teacher from organizations where slug = 'grifoai') is distinct from false then
    insert into verify.failures values ('GrifoAI''s organization has a teacher');
  end if;
  begin
    insert into organizations (slug, name, brand) values ('sem-professor', 'Sem', 'grifoai');
    insert into verify.failures values ('an organization without has_teacher was accepted');
    delete from organizations where slug = 'sem-professor';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_column = column_name;
    if v_state <> '23502' or v_column is distinct from 'has_teacher' then
      insert into verify.failures values (format(
        'an organization without has_teacher was refused with %s on %s, expected 23502 on has_teacher',
        v_state, coalesce(v_column, 'no column')));
    else
      raise notice 'an organization without has_teacher: refused, 23502 on has_teacher';
    end if;
  end;

  -- The company without a teacher, its admin and one employee, and a Chelsea
  -- admin who is not a platform admin.
  insert into organizations (slug, name, brand, has_teacher)
    values ('empresa-c', 'Empresa C', 'grifoai', false) returning id into v_c;
  insert into auth.users (id, email, raw_user_meta_data) values
    (c_admin_c, 'admin-c@example.com', '{"full_name":"Admin C"}'),
    (c_employee, 'employee-c@example.com', '{"full_name":"Employee C"}'),
    (c_admin_chelsea, 'admin-chelsea@example.com', null);
  insert into organization_members (organization_id, user_id, role) values
    (v_c, c_admin_c, 'admin'),
    (v_c, c_employee, 'student'),
    (c_chelsea, c_admin_chelsea, 'admin');
  insert into students (id, organization_id) values (c_employee, v_c);

  -- One row of every operation table, so the reads below have something to
  -- miss, on a common published question: since 0043 there is no content of
  -- C to hang them on.
  v_question := (select id from questions
                  where organization_id is null and is_published
                  order by created_at, id limit 1);
  insert into lessons (student_id, scheduled_at) values (c_employee, now() + interval '2 days');
  insert into lesson_schedules (student_id, weekday, start_time) values (c_employee, 1, '09:00');
  insert into assignments (student_id, due_on) values (c_employee, current_date)
    returning id into v_assignment;
  insert into assignment_items (assignment_id, question_id, position)
    values (v_assignment, v_question, 0);
  insert into attempts (student_id, question_id, audio_path)
    values (c_employee, v_question, 'c/one.webm');
  insert into review_schedule (student_id, question_id) values (c_employee, v_question);

  foreach v_table in array c_content loop
    execute format('select count(*) from %I where (organization_id is null or organization_id = %L) and %s',
                   v_table, v_c, verify.teachers_only(v_table)) into v_owner_n;
    if v_owner_n = 0 then
      insert into verify.failures values (format(
        'no common or C row in %s: the read below would prove nothing', v_table));
    end if;
  end loop;
  foreach v_table in array c_operation loop
    execute format('select count(*) from %I where organization_id = %L', v_table, v_c)
      into v_owner_n;
    if v_owner_n = 0 then
      insert into verify.failures values (format(
        'no row of C in %s: the read below would prove nothing', v_table));
    end if;
  end loop;

  set local role authenticated;

  -- 3. Who teaches.
  perform set_config('test.uid', c_admin_c::text, false);
  if teaches_in(v_c) then
    insert into verify.failures values ('the admin of C teaches in C');
  end if;
  if teaches_anywhere() then
    insert into verify.failures values ('the admin of C teaches somewhere');
  end if;
  if can_write_content(v_c) then
    insert into verify.failures values ('the admin of C writes C''s content');
  end if;
  perform set_config('test.uid', c_admin_chelsea::text, false);
  if not teaches_in(c_chelsea) or not teaches_anywhere() then
    insert into verify.failures values ('a Chelsea admin no longer teaches in Chelsea');
  end if;
  perform set_config('test.uid', c_teacher_b::text, false);
  if not teaches_in(c_b) then
    insert into verify.failures values ('B''s teacher no longer teaches in B');
  end if;

  -- 4. Nothing of a teacher's for the admin of C.
  perform set_config('test.uid', c_admin_c::text, false);
  foreach v_table in array c_content || c_operation loop
    execute format('select count(*) from %I where %s', v_table, verify.teachers_only(v_table))
      into v_n;
    if v_n <> 0 then
      insert into verify.failures values (format('the admin of C reads %s rows of %s', v_n, v_table));
    end if;
  end loop;
  if not verify.refused_for_privilege(
       format('insert into lessons (student_id, scheduled_at) values (%L, now() + interval ''5 days'')',
              c_employee)) then
    insert into verify.failures values ('the admin of C wrote a lesson for her employee');
  end if;
  if not verify.refused_for_privilege(
       format('insert into lesson_schedules (student_id, weekday, start_time) values (%L, 2, ''10:00'')',
              c_employee)) then
    insert into verify.failures values ('the admin of C wrote a schedule for her employee');
  end if;
  update students set meet_url = 'https://meet.example/c' where id = c_employee;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    insert into verify.failures values ('the admin of C changed her employee''s student row');
  end if;
  -- materialize_lessons runs as its caller, and the admin of C no longer reads
  -- the student row its check looks up, so the refusal below holds with the
  -- old check too. Its body is held to asking teaches_in: a caller who reads
  -- the row (a future policy) must still meet the new rule.
  if strpos(pg_get_functiondef('materialize_lessons(uuid, integer)'::regprocedure),
            'teaches_in((select organization_id from students where id = p_student_id))') = 0
     or strpos(pg_get_functiondef('materialize_lessons(uuid, integer)'::regprocedure),
               '{admin,teacher}') > 0 then
    insert into verify.failures values ('materialize_lessons does not ask teaches_in');
  end if;
  begin
    perform materialize_lessons(c_employee);
    insert into verify.failures values ('materialize_lessons ran for the admin of C');
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like 'only a teacher%' then
      insert into verify.failures values ('materialize_lessons refused the admin of C with: ' || v_message);
    end if;
  end;

  -- 5. Storage.
  if not verify.refused_for_privilege(
       format('insert into storage.objects (bucket_id, name) values (%L, %L)',
              'vocabulary-images', v_c || '/c.png')) then
    insert into verify.failures values ('the admin of C wrote a file under C''s folder');
  end if;

  -- 6. Running the organization.
  perform set_config('test.uid', c_admin_c::text, false);
  perform verify.expect_accepted('the admin of C invites an employee', format(
    'insert into organization_invites (organization_id, email, role, invited_by) values (%L, %L, %L, %L)',
    v_c, 'new-employee@example.com', 'student', c_admin_c));
  perform verify.expect_accepted('the admin of C invites an admin', format(
    'insert into organization_invites (organization_id, email, role, invited_by) values (%L, %L, %L, %L)',
    v_c, 'new-admin@example.com', 'admin', c_admin_c));
  select count(*) into v_n from organization_invites where organization_id = v_c;
  if v_n <> 2 then
    insert into verify.failures values (format('the admin of C reads %s of C''s 2 invites', v_n));
  end if;
  select count(*) into v_n from organization_members where organization_id = v_c;
  if v_n <> 2 then
    insert into verify.failures values (format('the admin of C reads %s of C''s 2 members', v_n));
  end if;
  if not exists (select 1 from profiles where id = c_employee) then
    insert into verify.failures values ('the admin of C does not read her employee''s name');
  end if;
  perform verify.expect_refused('an invite as teacher from the admin of C',
    'teacher_needs_a_teaching_organization', format(
    'insert into organization_invites (organization_id, email, role, invited_by) values (%L, %L, %L, %L)',
    v_c, 'teacher-c@example.com', 'teacher', c_admin_c));
  perform set_config('test.uid', c_admin::text, false);
  perform verify.expect_refused('an invite as teacher of C from the platform admin',
    'teacher_needs_a_teaching_organization', format(
    'insert into organization_invites (organization_id, email, role, invited_by) values (%L, %L, %L, %L)',
    v_c, 'teacher-c-by-platform@example.com', 'teacher', c_admin));

  -- 8. The employee.
  perform set_config('test.uid', c_employee::text, false);
  if not exists (select 1 from questions where organization_id is null and is_published) then
    insert into verify.failures values ('the employee of C does not read a common published question');
  end if;
  if not exists (select 1 from lessons where student_id = c_employee) then
    insert into verify.failures values ('the employee of C does not read her own lesson');
  end if;

  -- 9. Chelsea's admin keeps a teacher's power.
  perform set_config('test.uid', c_admin_chelsea::text, false);
  if verify.refused_for_privilege(
       format('insert into lessons (student_id, scheduled_at) values (%L, now() + interval ''9 days'')',
              c_student)) then
    insert into verify.failures values ('a Chelsea admin no longer writes a Chelsea student''s lesson');
  end if;
  if (select count(*) from books where organization_id is null) = 0 then
    insert into verify.failures values ('a Chelsea admin no longer reads common content');
  end if;
  begin
    perform materialize_lessons(c_student);
  exception when others then
    get stacked diagnostics v_message = message_text;
    insert into verify.failures values ('materialize_lessons refused a Chelsea admin: ' || v_message);
  end;

  -- 7. Turning an organization into one without a teacher.
  perform set_config('test.uid', c_admin_c::text, false);
  update organizations set has_teacher = true where id = v_c;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    insert into verify.failures values ('the admin of C changed has_teacher');
  end if;

  reset role;

  perform verify.expect_refused('an invite of C turned into a teacher''s by the owner',
    'teacher_needs_a_teaching_organization', format(
    'update organization_invites set role = %L where organization_id = %L and role = %L',
    'teacher', v_c, 'student'));
  perform verify.expect_refused('a teacher member of C written by the owner',
    'teacher_needs_a_teaching_organization', format(
    'insert into organization_members (organization_id, user_id, role) values (%L, %L, %L)',
    v_c, c_teacher_b, 'teacher'));
  perform verify.expect_refused('C''s admin made a teacher by the owner',
    'teacher_needs_a_teaching_organization', format(
    'update organization_members set role = %L where organization_id = %L and user_id = %L',
    'teacher', v_c, c_admin_c));
  perform verify.expect_refused('B, which has a teacher, turned into an organization without one',
    'organization_without_teacher_has_none',
    format('update organizations set has_teacher = false where id = %L', c_b));

  -- The member and invite branch locks the organization's row (for share),
  -- which a single session cannot watch happen: held to its text, so a
  -- rewrite that drops it fails here.
  if strpos(pg_get_functiondef('a_teacher_needs_a_teaching_organization()'::regprocedure),
            'where id = new.organization_id for share') = 0 then
    insert into verify.failures values (
      'a_teacher_needs_a_teaching_organization reads has_teacher without locking the organization');
  end if;

  -- An organization whose only teacher is a member, with no invite: B above
  -- may also hold an open teacher invite from the blocks of 0031 and 0032.
  insert into organizations (slug, name, brand, has_teacher)
    values ('empresa-e', 'Empresa E', 'grifoai', true) returning id into v_e;
  insert into organization_members (organization_id, user_id, role)
    values (v_e, c_teacher_b, 'teacher');
  perform verify.expect_refused('E, with a teacher member and no invite, turned into one without a teacher',
    'organization_without_teacher_has_none',
    format('update organizations set has_teacher = false where id = %L', v_e));

  -- An organization whose only teacher is an open invite.
  insert into organizations (slug, name, brand, has_teacher)
    values ('empresa-d', 'Empresa D', 'grifoai', true) returning id into v_d;
  insert into organization_invites (organization_id, email, role)
    values (v_d, 'teacher-d@example.com', 'teacher');
  perform verify.expect_refused('D, with an open teacher invite, turned into one without a teacher',
    'organization_without_teacher_has_none',
    format('update organizations set has_teacher = false where id = %L', v_d));
  update organization_invites set accepted_at = now() where organization_id = v_d;
  perform verify.expect_accepted('D, its teacher invite accepted and no teacher member, without a teacher',
    format('update organizations set has_teacher = false where id = %L', v_d));

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'without a teacher, the admin does not teach: %', v_failures;
  end if;

  raise notice '0042 changed 34 policies of public by the one substitution, and vocabulary_images_write; nothing else';
  raise notice 'the admin of an organization without a teacher reads and writes no content and no lesson, and writes no image';
  raise notice 'she still invites, reads her invites, members and their names; nobody is a teacher there';
  raise notice 'a Chelsea admin still teaches in Chelsea, B''s teacher in B';
end;
$$;

-- All content is common (0043) -----------------------------------------------------------
--
-- Every row of content is common and only the platform admin writes it; who
-- teaches still reads it. Each assertion stands on one clause of 0043:
--
-- 1. Only the change: every policy of public and storage right after 0043
--    (policies_after_0043) equals its text after 0042 (policies_after_0042),
--    except the 10 content _write policies, now ( SELECT is_platform_admin())
--    in using and with check, and vocabulary_images_write, now the bucket and
--    is_platform_admin() alone, with no teaches_in.
-- 2. can_write_content is false for B's teacher, for a Chelsea admin who is
--    not a platform admin and for the admin of C, with their organization and
--    with null; true for the platform admin.
-- 3. One check per table: as the owner, past RLS, a row of each of the 10
--    tables written with an organization, on common parents, is refused by
--    <table>_is_common; and the 10 constraints exist, validated.
-- 4. Nobody but the platform admin writes: B's teacher and the Chelsea admin
--    insert into none of the 10 tables (42501), update and delete no common
--    row of them (read back as the owner), and materialize_points,
--    reorder_questions and delete_question refuse them. This held for common
--    rows before 0043 too: it guards what a teacher may not do, and the proof
--    of the change is 1.
-- 5. Who teaches still reads: B's teacher and the Chelsea admin read common
--    rows of the 10 tables; the Chelsea student and the employee of C read a
--    common published question.
-- 6. The platform admin still writes: a common book, a common word, the
--    points of a book, and a file in the bucket.
-- 7. Storage: B's teacher writes no file under B's folder nor at the root;
--    the Chelsea admin writes none under Chelsea's.
--
-- The people are the ones seeded above. Failures are collected and raised
-- together.
do $$
declare
  c_content constant text[] := array[
    'books', 'lessons_content', 'points', 'blocks', 'vocabulary_items',
    'image_attempts', 'contrast_sets', 'contrast_set_items', 'questions', 'scenes'];
  c_platform_admin constant text := '( SELECT is_platform_admin() AS is_platform_admin)';
  c_bucket constant text :=
    '((bucket_id = ''vocabulary-images''::text) AND ( SELECT is_platform_admin() AS is_platform_admin))';
  c_chelsea constant uuid := (select id from organizations where slug = 'chelsea-st');
  c_b constant uuid := (select id from organizations where slug = 'escola-b');
  c_c constant uuid := (select id from organizations where slug = 'empresa-c');
  c_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  c_student constant uuid := '22222222-2222-2222-2222-222222222222';
  c_teacher_b constant uuid := '33333333-3333-3333-3333-333333333333';
  c_admin_c constant uuid := 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';
  c_employee constant uuid := 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1';
  c_admin_chelsea constant uuid := 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
  c_book constant uuid := (select id from books where title = 'Book 2' and organization_id is null);
  c_point constant uuid := (select id from points where book_id = c_book and number = 53);
  c_word constant uuid := (select id from vocabulary_items where term = 'a word' and organization_id is null);
  c_question constant uuid := (select id from questions
                                where point_id = c_point and organization_id is null
                                order by position limit 1);
  v_set uuid := (select id from contrast_sets where organization_id is null order by id limit 1);
  v_set_word uuid;
  v_inserts text[];
  v_writer uuid;
  v_table text;
  v_drift text;
  v_refusal text;
  v_n integer;
  v_owner_n integer;
  v_counts jsonb := '{}';
  v_book uuid;
  v_failures text;
begin
  delete from verify.failures;

  -- 1. Only the change.
  with expected as (
    select schemaname, tablename, policyname, permissive, roles, cmd,
           case when schemaname = 'public' and policyname = any (
                       array(select t || '_write' from unnest(c_content) t))
                  then c_platform_admin
                when schemaname = 'storage' and policyname = 'vocabulary_images_write'
                  then c_bucket
                else qual end as qual,
           case when schemaname = 'public' and policyname = any (
                       array(select t || '_write' from unnest(c_content) t))
                  then c_platform_admin
                when schemaname = 'storage' and policyname = 'vocabulary_images_write'
                  then c_bucket
                else with_check end as with_check
      from policies_after_0042
  ),
  drift as (
    (select 'expected but not held' as what, * from expected
     except select 'expected but not held', * from policies_after_0043)
    union all
    (select 'held but not expected', * from policies_after_0043
     except select 'held but not expected', * from expected)
  )
  select string_agg(format('%s: %s.%s', what, tablename, policyname), '; '
                    order by tablename, policyname, what)
    into v_drift from drift;
  if v_drift is not null then
    insert into verify.failures values ('policies beyond the change of 0043: ' || v_drift);
  end if;
  select count(*) into v_n
    from policies_after_0042 b
    join policies_after_0043 p using (schemaname, tablename, policyname)
   where b.qual is distinct from p.qual or b.with_check is distinct from p.with_check;
  if v_n <> 11 then
    insert into verify.failures values (format('0043 changed %s policies, expected 11', v_n));
  end if;
  if (select count(*) from policies_after_0043) <> (select count(*) from policies_after_0042) then
    insert into verify.failures values ('0043 changed the number of policies');
  end if;

  -- 2. can_write_content.
  set local role authenticated;
  perform set_config('test.uid', c_teacher_b::text, false);
  if can_write_content(c_b) or can_write_content(null) then
    insert into verify.failures values ('can_write_content is true for B''s teacher');
  end if;
  perform set_config('test.uid', c_admin_chelsea::text, false);
  if can_write_content(c_chelsea) or can_write_content(null) then
    insert into verify.failures values ('can_write_content is true for a Chelsea admin who is not a platform admin');
  end if;
  perform set_config('test.uid', c_admin_c::text, false);
  if can_write_content(c_c) or can_write_content(null) then
    insert into verify.failures values ('can_write_content is true for the admin of C');
  end if;
  perform set_config('test.uid', c_admin::text, false);
  if not can_write_content(null) then
    insert into verify.failures values ('can_write_content is false for the platform admin');
  end if;
  reset role;

  -- 3. One check per table, as the owner. The common contrast set and the
  -- word that no set holds are the parents of the two contrast rows.
  if v_set is null then
    insert into verify.failures values ('no common contrast set: the check of contrast_set_items would prove nothing');
  end if;
  insert into vocabulary_items (term, first_point_id) values ('not in a set, 0043', c_point)
    returning id into v_set_word;
  v_inserts := array[
    format('insert into books (position, title, organization_id) values (11, %L, %L)', 'of Chelsea', c_chelsea),
    format('insert into lessons_content (book_id, number, first_point, last_point, organization_id) values (%L, 99, 1, 2, %L)',
           c_book, c_chelsea),
    format('insert into points (book_id, number, organization_id) values (%L, 999, %L)', c_book, c_chelsea),
    format('insert into blocks (point_id, position, kind, content, organization_id) values (%L, 99, %L, %L, %L)',
           c_point, 'vocabulary', 'of Chelsea', c_chelsea),
    format('insert into vocabulary_items (term, first_point_id, organization_id) values (%L, %L, %L)',
           'of Chelsea', c_point, c_chelsea),
    format('insert into image_attempts (vocabulary_item_id, provider, status, organization_id) values (%L, %L, %L, %L)',
           c_word, 'freepik', 'pending', c_chelsea),
    format('insert into contrast_sets (organization_id) values (%L)', c_chelsea),
    format('insert into contrast_set_items (vocabulary_item_id, set_id, position, organization_id) values (%L, %L, 99, %L)',
           v_set_word, v_set, c_chelsea),
    format('insert into questions (point_id, position, prompt, expected_answer, organization_id) values (%L, 99, %L, %L, %L)',
           c_point, 'of Chelsea', 'a', c_chelsea),
    format('insert into scenes (description, organization_id) values (%L, %L)', 'of Chelsea', c_chelsea)];
  for v_n in 1 .. array_length(c_content, 1) loop
    perform verify.expect_refused(format('a row of %s with an organization', c_content[v_n]),
      c_content[v_n] || '_is_common', v_inserts[v_n]);
  end loop;
  insert into verify.failures
  select format('%s has no validated %s_is_common', t, t)
    from unnest(c_content) t
   where not exists (
     select 1 from pg_constraint co
      where co.conrelid = t::regclass and co.conname = t || '_is_common'
        and co.contype = 'c' and co.convalidated
        and pg_get_constraintdef(co.oid) = 'CHECK ((organization_id IS NULL))');

  -- 4. Nobody but the platform admin writes. The rows of each table are
  -- counted as the owner before and after.
  foreach v_table in array c_content loop
    execute format('select count(*) from %I', v_table) into v_owner_n;
    if v_owner_n = 0 then
      insert into verify.failures values (format(
        'no common row in %s: the writes below would prove nothing', v_table));
    end if;
    v_counts := v_counts || jsonb_build_object(v_table, v_owner_n);
  end loop;
  -- Each insert is the owner's of 3 with the organization taken out: the same
  -- row, common.
  v_inserts := array[
    'insert into books (position, title) values (11, ''common, by a teacher'')',
    format('insert into lessons_content (book_id, number, first_point, last_point) values (%L, 99, 1, 2)', c_book),
    format('insert into points (book_id, number) values (%L, 999)', c_book),
    format('insert into blocks (point_id, position, kind, content) values (%L, 99, %L, %L)',
           c_point, 'vocabulary', 'by a teacher'),
    format('insert into vocabulary_items (term, first_point_id) values (%L, %L)', 'by a teacher', c_point),
    format('insert into image_attempts (vocabulary_item_id, provider, status) values (%L, %L, %L)',
           c_word, 'freepik', 'pending'),
    'insert into contrast_sets default values',
    format('insert into contrast_set_items (vocabulary_item_id, set_id, position) values (%L, %L, 99)',
           v_set_word, v_set),
    format('insert into questions (point_id, position, prompt, expected_answer) values (%L, 99, %L, %L)',
           c_point, 'by a teacher', 'a'),
    'insert into scenes (description) values (''by a teacher'')'];

  set local role authenticated;
  foreach v_writer in array array[c_teacher_b, c_admin_chelsea] loop
    perform set_config('test.uid', v_writer::text, false);
    for v_n in 1 .. array_length(c_content, 1) loop
      v_refusal := verify.refusal(v_inserts[v_n]);
      if v_refusal is null or v_refusal not like '42501 %' then
        insert into verify.failures values (format('%s wrote a common row of %s: %s',
          v_writer, c_content[v_n], coalesce(v_refusal, 'accepted')));
      end if;
    end loop;
    -- A policy that lets the statement reach a row matches it; one that does
    -- not matches nothing and raises nothing. Any error means a row was
    -- reached (a foreign key, a trigger), and is a failure too.
    foreach v_table in array c_content loop
      begin
        execute format('update %I set organization_id = organization_id', v_table);
        get diagnostics v_n = row_count;
        if v_n <> 0 then
          insert into verify.failures values (format('%s updated %s common rows of %s', v_writer, v_n, v_table));
        end if;
      exception when others then
        insert into verify.failures values (format('%s reached common rows of %s on update: %s', v_writer, v_table, sqlerrm));
      end;
      begin
        execute format('delete from %I', v_table);
        get diagnostics v_n = row_count;
        if v_n <> 0 then
          insert into verify.failures values (format('%s deleted %s common rows of %s', v_writer, v_n, v_table));
        end if;
      exception when others then
        insert into verify.failures values (format('%s reached common rows of %s on delete: %s', v_writer, v_table, sqlerrm));
      end;
    end loop;
    perform verify.expect_refusal(format('materialize_points from %s', v_writer),
      'P0001 only a teacher of the book''s organization may configure it',
      format('select materialize_points(%L, 1, 128)', c_book));
    perform verify.expect_refusal(format('reorder_questions from %s', v_writer),
      '42501 only a teacher of the point''s organization may order its questions',
      format('select reorder_questions(%L, array[%L]::uuid[])', c_point, c_question));
    perform verify.expect_refusal(format('delete_question from %s', v_writer),
      '42501 only a teacher of the question''s organization may delete it',
      format('select delete_question(%L)', c_question));

    -- 5. And still reads.
    foreach v_table in array c_content loop
      execute format('select count(*) from %I where organization_id is null', v_table) into v_n;
      if v_n = 0 then
        insert into verify.failures values (format('%s reads no common row of %s', v_writer, v_table));
      end if;
    end loop;

    -- 7. Storage, under the writer's own organization and at the root.
    if not verify.refused_for_privilege(
         format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'vocabulary-images',
                case when v_writer = c_teacher_b then c_b else c_chelsea end || '/x-0043.png')) then
      insert into verify.failures values (format('%s wrote a file under her organization''s folder', v_writer));
    end if;
    if not verify.refused_for_privilege(
         'insert into storage.objects (bucket_id, name) values (''vocabulary-images'', ''x-0043.png'')') then
      insert into verify.failures values (format('%s wrote a file at the root of the bucket', v_writer));
    end if;
  end loop;

  foreach v_writer in array array[c_student, c_employee] loop
    perform set_config('test.uid', v_writer::text, false);
    if not exists (select 1 from questions where organization_id is null and is_published) then
      insert into verify.failures values (format('%s reads no common published question', v_writer));
    end if;
  end loop;

  -- 6. The platform admin still writes.
  perform set_config('test.uid', c_admin::text, false);
  if verify.refused_for_privilege(
       'insert into books (position, title) values (12, ''by the platform admin, 0043'')') then
    insert into verify.failures values ('the platform admin could not write a common book');
  end if;
  update vocabulary_items set image_subject = 'a word, 0043' where id = c_word;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    insert into verify.failures values (format('the platform admin updated %s common words, expected 1', v_n));
  end if;
  v_book := (select id from books where title = 'by the platform admin, 0043');
  perform verify.expect_accepted('materialize_points from the platform admin',
    format('select materialize_points(%L, 1, 2)', v_book));
  if verify.refused_for_privilege(
       'insert into storage.objects (bucket_id, name) values (''vocabulary-images'', ''admin-0043.png'')') then
    insert into verify.failures values ('the platform admin could not write a file in the bucket');
  end if;
  reset role;

  -- The writes of 4 changed nothing, read back as the owner.
  foreach v_table in array c_content loop
    execute format('select count(*) from %I', v_table) into v_n;
    v_owner_n := (v_counts ->> v_table)::integer
                 + case v_table when 'books' then 1 when 'points' then 2 else 0 end;
    if v_n <> v_owner_n then
      insert into verify.failures values (format('%s holds %s rows, expected %s', v_table, v_n, v_owner_n));
    end if;
  end loop;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'all content is common: %', v_failures;
  end if;

  raise notice '0043 changed the 10 content _write policies and vocabulary_images_write to the platform admin alone; nothing else';
  raise notice 'no row of the 10 content tables holds an organization, each refused by its own check';
  raise notice 'only the platform admin writes content and the bucket; who teaches still reads it';
end;
$$;

-- The admin sees how often, not what (0044) ----------------------------------------------
--
-- team_practice is the only view of practice the admin of an organization
-- without a teacher has. Two such companies, F and G, each with an admin and
-- employees; attempts on days chosen around now(). Each assertion stands on
-- one clause of 0044:
--
-- 1. The check of the caller: the admin of F reads F; the admin of F asking
--    for G, the admin of G asking for F, an employee of F, and B's teacher are
--    refused with 42501. The platform admin reads both.
-- 2. Only the admin role: an employee of F, a member of F, is refused.
-- 3. Only F's people: exactly F's five employees, never G's, though G's
--    employee practised today.
-- 4. Days, not attempts: two attempts on one day count 1 (distinct).
-- 5. The window: an attempt five weeks back counts in no week, but the last
--    day still comes from every attempt.
-- 6. The person's own day: one instant, a Monday at 01:30 UTC, is Monday in
--    London and Sunday in São Paulo, so it is a different last day and a
--    different week for each. A zone Postgres does not know counts as São
--    Paulo, the column's default, and does not refuse the team.
-- 7. Weeks between 1 and 12: 0, 13 and null are refused with 22023.
-- 8. What comes out: exactly person_id, last_practised_on, days_by_week and
--    minutes_this_month, the minutes 0 until #71.
-- 9. Execute: authenticated has it, anon does not.
-- 10. Security definer: it reads attempts the admin of F reads no row of.
--
-- The lower bound on created_at in practised only spares reading older
-- attempts: no result depends on it, so no assertion here can see it go.
--
-- Seeded as the owner; called as authenticated. Failures are collected and
-- raised together. A refusal is named by its SQLSTATE and the start of the
-- function's own message (verify.refusal), so a plain "permission denied for
-- function" does not pass for the check of the caller.

-- One person's row of team_practice for an organization, as text, so a
-- missing row reads as null.
create function verify.practice_of(p_organization uuid, p_person uuid, p_weeks integer default 4)
returns table (last_practised_on date, days_by_week integer[], minutes_this_month integer)
language sql as $$
  select t.last_practised_on, t.days_by_week, t.minutes_this_month
    from team_practice(p_organization, p_weeks) t
   where t.person_id = p_person;
$$;

-- The four weeks of team_practice for one attempt on p_day, in a person's
-- zone: 1 in the week the day falls in, counted back from her own Monday.
-- Written apart from the function, by subtraction of weeks.
create function verify.one_day_in(p_day date, p_zone text) returns integer[]
language sql stable as $$
  select array(
    select case when (date_trunc('week', now() at time zone p_zone)::date
                      - date_trunc('week', p_day::timestamp)::date) / 7 = w then 1 else 0 end
      from generate_series(3, 0, -1) as w);
$$;

do $$
declare
  v_zone_check boolean;
  c_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  c_teacher_b constant uuid := '33333333-3333-3333-3333-333333333333';
  c_admin_f constant uuid := 'f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0';
  c_f1 constant uuid := 'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1';
  c_f2 constant uuid := 'f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2';
  c_f3 constant uuid := 'f3f3f3f3-f3f3-f3f3-f3f3-f3f3f3f3f3f3';
  c_f4 constant uuid := 'f4f4f4f4-f4f4-f4f4-f4f4-f4f4f4f4f4f4';
  c_f5 constant uuid := 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5';
  c_refused constant text := '42501 only an admin of organization %';
  c_admin_g constant uuid := 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0';
  c_g1 constant uuid := 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1';
  c_sp constant text := 'America/Sao_Paulo';
  c_london constant text := 'Europe/London';
  -- Her Monday, and today, in São Paulo.
  c_sp_week constant date := date_trunc('week', now() at time zone 'America/Sao_Paulo')::date;
  c_sp_today constant date := (now() at time zone 'America/Sao_Paulo')::date;
  -- A Monday two weeks back, in UTC, and its 01:30: Sunday 22:30 in São
  -- Paulo, Monday in London in any season. Two weeks back, so it is past and
  -- inside the four weeks for both, whatever hour this runs.
  c_monday constant date := date_trunc('week', now() at time zone 'UTC')::date - 14;
  c_instant constant timestamptz := (c_monday + time '01:30') at time zone 'UTC';
  v_f uuid;
  v_g uuid;
  v_question uuid;
  v_row record;
  v_ids uuid[];
  v_state text;
  v_failures text;
begin
  delete from verify.failures;

  insert into organizations (slug, name, brand, has_teacher)
    values ('empresa-f', 'Empresa F', 'grifoai', false) returning id into v_f;
  insert into organizations (slug, name, brand, has_teacher)
    values ('empresa-g', 'Empresa G', 'grifoai', false) returning id into v_g;
  insert into auth.users (id, email, raw_user_meta_data) values
    (c_admin_f, 'admin-f@example.com', '{"full_name":"Admin F"}'),
    (c_f1, 'f1@example.com', '{"full_name":"F1"}'),
    (c_f2, 'f2@example.com', '{"full_name":"F2"}'),
    (c_f3, 'f3@example.com', '{"full_name":"F3"}'),
    (c_f4, 'f4@example.com', '{"full_name":"F4"}'),
    (c_f5, 'f5@example.com', '{"full_name":"F5"}'),
    (c_admin_g, 'admin-g@example.com', '{"full_name":"Admin G"}'),
    (c_g1, 'g1@example.com', '{"full_name":"G1"}');
  update profiles set timezone = c_london where id = c_f2;
  -- Before 0048 any text went in through profiles_update_self. Since 0048
  -- (#219) no write puts an unknown zone in, but a row can still hold one:
  -- written before, or a name the server's tzdata dropped later. The trigger
  -- is set aside for this one write, as a restore sets it aside. Only where
  -- it exists: with it cut, for the reversion of 0048, the assertions of
  -- 0048's own block are the ones that must fail.
  v_zone_check := exists (select 1 from pg_trigger
                           where tgname = 'profiles_timezone_known');
  if v_zone_check then
    alter table profiles disable trigger profiles_timezone_known;
  end if;
  update profiles set timezone = 'Not/A_Zone' where id = c_f5;
  if v_zone_check then
    alter table profiles enable trigger profiles_timezone_known;
  end if;
  insert into organization_members (organization_id, user_id, role) values
    (v_f, c_admin_f, 'admin'),
    (v_f, c_f1, 'student'), (v_f, c_f2, 'student'),
    (v_f, c_f3, 'student'), (v_f, c_f4, 'student'), (v_f, c_f5, 'student'),
    (v_g, c_admin_g, 'admin'),
    (v_g, c_g1, 'student');
  insert into students (id, organization_id) values
    (c_f1, v_f), (c_f2, v_f), (c_f3, v_f), (c_f4, v_f), (c_f5, v_f), (c_g1, v_g);

  -- A common question: every organization's attempt may name one.
  select id into v_question from questions where organization_id is null order by id limit 1;
  if v_question is null then
    raise exception 'the fixtures hold no common question to practise';
  end if;

  -- F1, in São Paulo: today; twice on Wednesday of last week; Monday two
  -- weeks back; and five weeks back, outside the four.
  insert into attempts (student_id, question_id, audio_path, created_at) values
    (c_f1, v_question, 'f1/today.webm', now()),
    (c_f1, v_question, 'f1/wed-a.webm', (c_sp_week - 5 + time '10:00') at time zone c_sp),
    (c_f1, v_question, 'f1/wed-b.webm', (c_sp_week - 5 + time '15:00') at time zone c_sp),
    (c_f1, v_question, 'f1/two-back.webm', (c_sp_week - 14 + time '12:00') at time zone c_sp),
    (c_f1, v_question, 'f1/five-back.webm', (c_sp_week - 35 + time '12:00') at time zone c_sp);
  -- F2 in London, F3 in São Paulo and F5 in a zone nobody knows, the same
  -- instant. F4 never practised.
  insert into attempts (student_id, question_id, audio_path, created_at) values
    (c_f2, v_question, 'f2/instant.webm', c_instant),
    (c_f3, v_question, 'f3/instant.webm', c_instant),
    (c_f5, v_question, 'f5/instant.webm', c_instant);
  -- G1 practised today, and has a review row; F1 too.
  insert into attempts (student_id, question_id, audio_path, created_at)
    values (c_g1, v_question, 'g1/today.webm', now());
  insert into review_schedule (student_id, question_id) values (c_f1, v_question);

  set local role authenticated;

  -- 1, 3. The admin of F reads exactly F's five.
  perform set_config('test.uid', c_admin_f::text, false);
  select array_agg(person_id order by person_id) into v_ids from team_practice(v_f, 4);
  if v_ids is distinct from array[c_f1, c_f2, c_f3, c_f4, c_f5] then
    insert into verify.failures values (format('the admin of F read the people %s, expected F''s five', v_ids));
  end if;

  -- 4, 5. F1: one day in each of the last three weeks; the two attempts of
  -- Wednesday are one day; five weeks back is in no week.
  select * into v_row from verify.practice_of(v_f, c_f1);
  if v_row.days_by_week is distinct from array[0, 1, 1, 1] then
    insert into verify.failures values (format('F1 practised %s days by week, expected {0,1,1,1}', v_row.days_by_week));
  end if;
  if v_row.last_practised_on is distinct from c_sp_today then
    insert into verify.failures values (format('F1 last practised on %s, expected %s', v_row.last_practised_on, c_sp_today));
  end if;

  -- 6. One instant, two days.
  select * into v_row from verify.practice_of(v_f, c_f2);
  if v_row.last_practised_on is distinct from c_monday
     or v_row.days_by_week is distinct from verify.one_day_in(c_monday, c_london) then
    insert into verify.failures values (format('F2, in London, practised on %s, %s, expected %s, %s',
      v_row.last_practised_on, v_row.days_by_week, c_monday, verify.one_day_in(c_monday, c_london)));
  end if;
  select * into v_row from verify.practice_of(v_f, c_f3);
  if v_row.last_practised_on is distinct from c_monday - 1
     or v_row.days_by_week is distinct from verify.one_day_in(c_monday - 1, c_sp) then
    insert into verify.failures values (format('F3, in São Paulo, practised on %s, %s, expected %s, %s',
      v_row.last_practised_on, v_row.days_by_week, c_monday - 1, verify.one_day_in(c_monday - 1, c_sp)));
  end if;
  -- While São Paulo is still on Sunday and London already on Monday, each
  -- counts from her own Monday and the two shifts cancel: the weeks agree
  -- then, rightly. Any other hour they must differ.
  if date_trunc('week', now() at time zone c_sp) = date_trunc('week', now() at time zone c_london)
     and verify.one_day_in(c_monday, c_london) = verify.one_day_in(c_monday - 1, c_sp) then
    insert into verify.failures values ('the instant falls in the same week in London and São Paulo: the fixture proves nothing');
  end if;
  select * into v_row from verify.practice_of(v_f, c_f5);
  if v_row.last_practised_on is distinct from c_monday - 1 then
    insert into verify.failures values (format('F5, in an unknown zone, practised on %s, expected %s as in São Paulo',
      v_row.last_practised_on, c_monday - 1));
  end if;

  -- F4 never practised.
  select * into v_row from verify.practice_of(v_f, c_f4);
  if v_row.last_practised_on is not null or v_row.days_by_week is distinct from array[0, 0, 0, 0] then
    insert into verify.failures values (format('F4 never practised, but reads %s, %s',
      v_row.last_practised_on, v_row.days_by_week));
  end if;

  -- 8. The minutes are 0 for everyone, and a week count is the length asked.
  if exists (select 1 from team_practice(v_f, 4) where minutes_this_month <> 0) then
    insert into verify.failures values ('minutes other than 0 before #71 records sessions');
  end if;
  if exists (select 1 from team_practice(v_f, 12) where cardinality(days_by_week) <> 12) then
    insert into verify.failures values ('twelve weeks asked, another number given');
  end if;

  -- 10. The rows behind it stay closed to her.
  if (select count(*) from attempts) <> 0 or (select count(*) from review_schedule) <> 0 then
    insert into verify.failures values ('the admin of F reads rows of attempts or review_schedule');
  end if;

  -- 1, 2. Refused: another organization, an employee, a teacher elsewhere.
  v_state := verify.refusal(format('select * from team_practice(%L, 4)', v_g));
  if v_state is null or v_state not like c_refused then
    insert into verify.failures values (format('the admin of F asking for G: %s', coalesce(v_state, 'answered')));
  end if;
  perform set_config('test.uid', c_admin_g::text, false);
  v_state := verify.refusal(format('select * from team_practice(%L, 4)', v_f));
  if v_state is null or v_state not like c_refused then
    insert into verify.failures values (format('the admin of G asking for F: %s', coalesce(v_state, 'answered')));
  end if;
  select array_agg(person_id) into v_ids from team_practice(v_g, 4);
  if v_ids is distinct from array[c_g1] then
    insert into verify.failures values (format('the admin of G read the people %s, expected G1', v_ids));
  end if;
  perform set_config('test.uid', c_f1::text, false);
  v_state := verify.refusal(format('select * from team_practice(%L, 4)', v_f));
  if v_state is null or v_state not like c_refused then
    insert into verify.failures values (format('an employee of F asking for F: %s', coalesce(v_state, 'answered')));
  end if;
  perform set_config('test.uid', c_teacher_b::text, false);
  v_state := verify.refusal(format('select * from team_practice(%L, 4)', v_f));
  if v_state is null or v_state not like c_refused then
    insert into verify.failures values (format('B''s teacher asking for F: %s', coalesce(v_state, 'answered')));
  end if;

  -- 7. The weeks.
  perform set_config('test.uid', c_admin_f::text, false);
  foreach v_state in array array['0', '13', 'null'] loop
    if coalesce(verify.refusal(format('select * from team_practice(%L, %s)', v_f, v_state)), 'answered')
       not like '22023 weeks must be between 1 and 12%' then
      insert into verify.failures values (format('%s weeks were not refused with 22023', v_state));
    end if;
  end loop;

  -- 1. The platform admin reads both.
  perform set_config('test.uid', c_admin::text, false);
  if (select count(*) from team_practice(v_f, 4)) <> 5 or (select count(*) from team_practice(v_g, 4)) <> 1 then
    insert into verify.failures values ('the platform admin does not read F and G');
  end if;

  reset role;
  -- F5 back in a known zone.
  update profiles set timezone = 'America/Sao_Paulo' where id = c_f5;
  perform set_config('test.uid', '', false);

  -- 8. What comes out, and nothing of what was said.
  if pg_get_function_result('team_practice(uuid, integer)'::regprocedure)
     <> 'TABLE(person_id uuid, last_practised_on date, days_by_week integer[], minutes_this_month integer)' then
    insert into verify.failures values ('team_practice returns ' ||
      pg_get_function_result('team_practice(uuid, integer)'::regprocedure));
  end if;

  -- 9. Execute.
  if has_function_privilege('anon', 'team_practice(uuid, integer)', 'execute') then
    insert into verify.failures values ('anon executes team_practice');
  end if;
  if not has_function_privilege('authenticated', 'team_practice(uuid, integer)', 'execute') then
    insert into verify.failures values ('authenticated does not execute team_practice');
  end if;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'the admin sees how often, not what: %', v_failures;
  end if;

  raise notice 'the admin of F reads the practice of F''s people only: days by week, the last day, 0 minutes';
  raise notice 'another organization''s admin, an employee, a teacher elsewhere and anon are refused';
  raise notice 'a day is the person''s own, two attempts on it are one day, the window is the weeks asked';
  raise notice 'a zone nobody knows counts as São Paulo, and does not refuse the team';
end;
$$;

-- Creating a company organization (#205) ------------------------------------------------
--
-- The platform admin creates a company's organization and invites its first
-- admin on /teacher/organizations, with her own client: two writes under the
-- policies already applied, no migration. Each assertion stands on one of
-- them:
--
-- 1. Only the platform admin creates: an insert into organizations of a
--    company (grifoai, no teacher) is refused for B's teacher, the Chelsea
--    student, the company's own admin made in 3, and anon
--    (organizations_write, and no insert granted to anon).
-- 2. The platform admin creates, as authenticated, and reads it back
--    (returning, as the screen asks): one row, grifoai, no teacher.
-- 3. The invite accepted makes the admin: the platform admin writes the admin
--    invite of the new organization; the account is created and its email
--    confirmed, as the owner, the way Supabase Auth writes it (0031). Then she
--    is its admin, the invite is accepted, she has no students row, and
--    teaches_in is false for her there (0042).
-- 4. The first admin works: she reads her organization, and only it, and
--    invites an employee to it.
--
-- Appended after the block of 0037, which it does not touch: nothing here
-- creates a relation. Failures are collected and raised together.
do $$
declare
  c_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  c_student constant uuid := '22222222-2222-2222-2222-222222222222';
  c_teacher_b constant uuid := '33333333-3333-3333-3333-333333333333';
  c_first_admin constant uuid := 'e2050000-0000-0000-0000-000000000205';
  c_company constant text :=
    $q$insert into organizations (slug, name, brand, has_teacher) values ('%s', 'Empresa', 'grifoai', false)$q$;
  v_org uuid;
  v_n integer;
  v_brand text;
  v_has_teacher boolean;
  v_teaches boolean;
  v_anon_refused boolean;
  v_failures text;
begin
  delete from verify.failures;

  set local role authenticated;

  -- 2. The platform admin creates the company and reads it back.
  perform set_config('test.uid', c_admin::text, false);
  insert into organizations (slug, name, brand, has_teacher)
    values ('empresa-teste', 'Empresa Teste', 'grifoai', false)
    returning id into v_org;
  select count(*), min(brand), bool_or(has_teacher)
    into v_n, v_brand, v_has_teacher
    from organizations where id = v_org;
  if v_n <> 1 or v_brand is distinct from 'grifoai' or v_has_teacher is distinct from false then
    insert into verify.failures values (format(
      'the platform admin created %s rows, wearing %s, has_teacher %s',
      v_n, coalesce(v_brand, 'nothing'), coalesce(v_has_teacher::text, 'nothing')));
  end if;

  -- 3. Her invite of the first admin, then the account, as the owner.
  insert into organization_invites (organization_id, email, role)
    values (v_org, 'first-admin@example.com', 'admin');
  reset role;
  insert into auth.users (id, email) values (c_first_admin, 'first-admin@example.com');
  update auth.users set email_confirmed_at = now() where id = c_first_admin;
  if not exists (select 1 from organization_members
                  where user_id = c_first_admin and organization_id = v_org and role = 'admin') then
    insert into verify.failures values ('the accepted invite did not make the company''s admin');
  end if;
  if (select accepted_at from organization_invites
       where organization_id = v_org and email = 'first-admin@example.com' and role = 'admin') is null then
    insert into verify.failures values ('the first admin''s invite was left open');
  end if;
  if exists (select 1 from students where id = c_first_admin) then
    insert into verify.failures values ('the company''s first admin got a students row');
  end if;

  set local role authenticated;
  perform set_config('test.uid', c_first_admin::text, false);
  v_teaches := teaches_in(v_org);
  if v_teaches is distinct from false then
    insert into verify.failures values ('the company''s first admin teaches in it');
  end if;

  -- 4. She reads her organization, only it, and invites an employee.
  select count(*) into v_n from organizations;
  if v_n <> 1 or not exists (select 1 from organizations where id = v_org) then
    insert into verify.failures values (format(
      'the company''s first admin reads %s organizations', v_n));
  end if;
  if verify.refused_for_privilege(
       format('insert into organization_invites (organization_id, email, role) values (%L, %L, %L)',
              v_org, 'employee@example.com', 'student')) then
    insert into verify.failures values ('the company''s first admin could not invite an employee');
  end if;

  -- 1. Nobody else creates an organization.
  if not verify.refused_for_privilege(format(c_company, 'empresa-da-admin')) then
    insert into verify.failures values ('the company''s admin created an organization');
  end if;
  perform set_config('test.uid', c_teacher_b::text, false);
  if not verify.refused_for_privilege(format(c_company, 'empresa-do-professor')) then
    insert into verify.failures values ('B''s teacher created an organization');
  end if;
  perform set_config('test.uid', c_student::text, false);
  if not verify.refused_for_privilege(format(c_company, 'empresa-da-aluna')) then
    insert into verify.failures values ('the Chelsea student created an organization');
  end if;
  reset role;
  -- anon writes nothing in verify.failures: the answer is kept and recorded
  -- after reset role.
  set local role anon;
  perform set_config('test.uid', '', false);
  v_anon_refused := verify.refused_for_privilege(format(c_company, 'empresa-anonima'));
  reset role;
  if not v_anon_refused then
    insert into verify.failures values ('anon created an organization');
  end if;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'creating a company organization: %', v_failures;
  end if;

  raise notice 'only the platform admin creates an organization; a company is grifoai with no teacher';
  raise notice 'its admin invite, once confirmed, makes an admin who teaches nothing, reads her organization and invites an employee';
end;
$$;

-- A suggested question keeps its draft (0045) ---------------------------------------------
--
-- Each clause refuses on its own, by its own name, and the two shapes 0045
-- allows are written: a question by hand, with none of the three, and one
-- from a suggestion, with all three. Once written, the draft is kept: an
-- update that changes or clears it is refused, and the teacher's own edit of
-- the prompt goes through. Run as the owner: a check and a trigger bind every
-- role alike, and who may write a question is the content policies' (0043),
-- checked above.

do $$
declare
  v_point uuid := (select id from points where number = 54);
  v_hand uuid;
  v_suggested uuid;
  v_failures text;
  c_insert constant text :=
    'insert into questions (point_id, position, prompt, expected_answer, suggested_model, suggested_prompt, suggested_answer) values (%L, %s, ''Where''''s the pen?'', ''The pen''''s on the table.'', %s, %s, %s)';
  c_model constant text := '''claude-haiku-5-5''';
  c_prompt constant text := '''Where is the pen?''';
  c_answer constant text := '''The pen is on the table.''';
begin
  delete from verify.failures;

  -- questions_suggestion_whole, one missing column at a time.
  perform verify.expect_refused('a model with neither prompt nor answer', 'questions_suggestion_whole',
    format(c_insert, v_point, 9001, c_model, 'null', 'null'));
  perform verify.expect_refused('a draft with no model', 'questions_suggestion_whole',
    format(c_insert, v_point, 9002, 'null', c_prompt, c_answer));
  perform verify.expect_refused('a model and a prompt with no answer', 'questions_suggestion_whole',
    format(c_insert, v_point, 9003, c_model, c_prompt, 'null'));
  perform verify.expect_refused('a model and an answer with no prompt', 'questions_suggestion_whole',
    format(c_insert, v_point, 9004, c_model, 'null', c_answer));

  -- questions_suggestion_not_blank, one blank column at a time.
  perform verify.expect_refused('a blank model', 'questions_suggestion_not_blank',
    format(c_insert, v_point, 9005, '''  ''', c_prompt, c_answer));
  perform verify.expect_refused('a blank prompt', 'questions_suggestion_not_blank',
    format(c_insert, v_point, 9006, c_model, '''''', c_answer));
  perform verify.expect_refused('a blank answer', 'questions_suggestion_not_blank',
    format(c_insert, v_point, 9007, c_model, c_prompt, ''' '''));

  -- The two shapes that go in.
  if verify.refused_by(format(c_insert, v_point, 9008, 'null', 'null', 'null')) is not null then
    insert into verify.failures values ('a question written by hand: refused');
  end if;
  if verify.refused_by(format(c_insert, v_point, 9009, c_model, c_prompt, c_answer)) is not null then
    insert into verify.failures values ('a question saved from a suggestion: refused');
  end if;
  select id into v_hand from questions where point_id = v_point and position = 9008;
  select id into v_suggested from questions where point_id = v_point and position = 9009;

  -- questions_suggestion_kept: the draft never changes once written.
  perform verify.expect_refused('a draft rewritten', 'questions_suggestion_kept',
    format('update questions set suggested_prompt = ''Where''''s the pen?'' where id = %L', v_suggested));
  perform verify.expect_refused('a draft cleared', 'questions_suggestion_kept',
    format('update questions set suggested_model = null, suggested_prompt = null, suggested_answer = null where id = %L', v_suggested));
  perform verify.expect_refused('a draft added to a question by hand', 'questions_suggestion_kept',
    format('update questions set suggested_model = %s, suggested_prompt = %s, suggested_answer = %s where id = %L',
      c_model, c_prompt, c_answer, v_hand));
  if verify.refused_by(format(
       'update questions set prompt = ''Where''''s the pencil?'', is_published = true, is_acted_out = true where id = %L',
       v_suggested)) is not null then
    insert into verify.failures values ('the teacher editing a suggested question: refused');
  end if;

  delete from questions where point_id = v_point and position between 9001 and 9009;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'a suggested question keeps its draft: %', v_failures;
  end if;
  raise notice 'a question by hand has none of the three, one from a suggestion has all three, none blank, and the draft is kept';
end;
$$;

-- An open invite says the kind of its organization (0046) -------------------------------
--
-- Someone who already has an account reads her open invites through
-- my_open_organization_invites, and cannot read organizations before she is
-- a member (organizations_read). The function gives has_teacher, so the
-- screen names the role as the organization does (roleLabel, #213): one
-- invite to Chelsea St (with a teacher) and one to GrifoAI's organization
-- (without), for the same account, each read with its own organization's
-- value. The rows are removed at the end.

do $$
declare
  c_chelsea constant uuid := (select id from organizations where slug = 'chelsea-st');
  c_grifoai constant uuid := (select id from organizations where slug = 'grifoai');
  c_kind constant uuid := 'a2130000-0000-4000-8000-000000000213';
  v_school uuid;
  v_company uuid;
  v_uid text := current_setting('test.uid', true);
  v_failures text;
begin
  delete from verify.failures;

  insert into auth.users (id, email, email_confirmed_at)
    values (c_kind, 'kind@example.com', now());
  insert into organization_invites (organization_id, email, role)
    values (c_chelsea, 'kind@example.com', 'student')
    returning id into v_school;
  insert into organization_invites (organization_id, email, role)
    values (c_grifoai, 'kind@example.com', 'student')
    returning id into v_company;
  -- Two she must not see, so the recreated function is checked for its
  -- filters on its own: someone else's open invite, and one of hers expired.
  insert into organization_invites (organization_id, email, role)
    values (c_grifoai, 'not-kind@example.com', 'student');
  insert into organization_invites (organization_id, email, role, expires_at)
    values (c_chelsea, 'kind@example.com', 'teacher', now() - interval '1 day');

  set local role authenticated;
  perform set_config('test.uid', c_kind::text, false);
  if (select has_teacher from my_open_organization_invites() where id = v_school) is distinct from true then
    insert into verify.failures values ('an invite to an organization with a teacher did not say has_teacher true');
  end if;
  if (select has_teacher from my_open_organization_invites() where id = v_company) is distinct from false then
    insert into verify.failures values ('an invite to an organization without a teacher did not say has_teacher false');
  end if;
  if (select count(*) from my_open_organization_invites()) <> 2 then
    insert into verify.failures values ('my_open_organization_invites did not give exactly her own two open invites');
  end if;
  reset role;

  delete from organization_invites where email in ('kind@example.com', 'not-kind@example.com');
  delete from auth.users where id = c_kind;
  -- The uid of the blocks before, not of an account that is gone.
  perform set_config('test.uid', coalesce(v_uid, ''), false);

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'an open invite says the kind of its organization: %', v_failures;
  end if;
  raise notice 'an open invite says has_teacher as its organization does, true for a school and false for a company';
end;
$$;


-- A function runs only for who needs it (0047) ------------------------------------------
--
-- authenticated executes the 8 functions that policies, checks and the app
-- call, and anon and service_role none of them. Every trigger function of
-- public, and rls_auto_enable behind the event trigger, read from the catalog
-- so a later one is held too, is executable by none of the three. Then every
-- function of public: none executable by PUBLIC, and no security definer
-- executable by anon but submit_lead (0038, the site's form), named by its
-- whole signature. The functions of an extension are left out: pgcrypto sits
-- in public only here (0001 creates it without a schema) and in extensions on
-- the project, with its own grants. A function created now is born closed.
-- The bucket, as production grants it: anon still reads it, and its write is
-- refused by row level security, not by a function it may not execute; the
-- platform admin still writes. And a signup made by a role that is neither the
-- superuser nor the owner, as supabase_auth_admin is on the project, fires
-- both triggers of auth.users: execute on a trigger function is checked when
-- the trigger is created, never when it fires. has_function_privilege also
-- sees what reaches a role through PUBLIC.

do $$
declare
  c_authenticated constant regprocedure[] := array[
    'public.belongs_anywhere()',
    'public.can_invite(uuid, public.organization_role)',
    'public.can_write_content(uuid)',
    'public.is_organization_member(uuid, public.organization_role[])',
    'public.is_platform_admin()',
    'public.is_reference_list(text[])',
    'public.teaches_anywhere()',
    'public.teaches_in(uuid)']::regprocedure[];
  c_submit_lead constant regprocedure :=
    'public.submit_lead(text, text, text, text, text, text, text, text, text, text)';
  c_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  c_signup constant uuid := 'a1480000-0000-4000-8000-000000000148';
  v_fn regprocedure;
  v_role text;
  v_before integer;
  v_n integer;
  v_anon_error text;
  v_anon_write_error text;
  v_admin_refused boolean;
  v_signup_error text;
  v_uid text := current_setting('test.uid', true);
  v_failures text;
begin
  delete from verify.failures;

  v_before := (select count(*) from verify.failures);
  foreach v_fn in array c_authenticated loop
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      insert into verify.failures values (format('authenticated does not execute %s', v_fn));
    end if;
    foreach v_role in array array['anon', 'service_role'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        insert into verify.failures values (format('%s executes %s', v_role, v_fn));
      end if;
    end loop;
  end loop;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'authenticated executes the 8 that policies, checks and the app call; anon and service_role none';
  end if;

  v_before := (select count(*) from verify.failures);
  insert into verify.failures
  select format('%s executes the trigger function %s', r.role, p.oid::regprocedure)
    from pg_proc p
   cross join unnest(array['anon', 'authenticated', 'service_role']) r (role)
   where p.pronamespace = 'public'::regnamespace
     and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
     and has_function_privilege(r.role, p.oid, 'execute')
   order by 1;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype);
  if v_n < 10 then
    insert into verify.failures
      values (format('%s trigger functions in public, expected at least the 9 and rls_auto_enable', v_n));
  end if;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'nobody executes a trigger function of public (% of them, rls_auto_enable included)', v_n;
  end if;

  v_before := (select count(*) from verify.failures);
  insert into verify.failures
  select format('PUBLIC executes %s', p.oid::regprocedure)
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid
                        and d.deptype = 'e')
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
   order by 1;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'no function of public, outside an extension, is executable by PUBLIC';
  end if;

  v_before := (select count(*) from verify.failures);
  insert into verify.failures
  select format('anon executes the security definer %s', p.oid::regprocedure)
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid
                        and d.deptype = 'e')
     and p.prosecdef
     and p.oid <> c_submit_lead
     and has_function_privilege('anon', p.oid, 'execute')
   order by 1;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'no security definer of public is executable by anon but submit_lead';
  end if;

  v_before := (select count(*) from verify.failures);
  create function public.verify_born_closed() returns integer language sql as 'select 1';
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(v_role, 'public.verify_born_closed()', 'execute') then
      insert into verify.failures values (format('a new function is born executable by %s', v_role));
    end if;
  end loop;
  drop function public.verify_born_closed();
  if (select count(*) from verify.failures) = v_before then
    raise notice 'a function created after 0047 is born executable by its owner alone';
  end if;

  v_before := (select count(*) from verify.failures);
  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and policyname = 'vocabulary_images_write'
                    and roles = '{authenticated}'::name[]) then
    insert into verify.failures values ('vocabulary_images_write is not to authenticated alone');
  end if;

  insert into storage.objects (bucket_id, name) values ('vocabulary-images', 'kept-0047.png');
  -- anon writes nothing in verify.failures: the answers are kept and
  -- recorded after reset role.
  set local role anon;
  begin
    select count(*) into v_n from storage.objects
     where bucket_id = 'vocabulary-images' and name = 'kept-0047.png';
  exception when others then
    v_anon_error := sqlerrm;
  end;
  -- Refused either way, so the reason is what tells the two policies apart:
  -- row level security now, "permission denied for function" while the write
  -- policy still applied to anon.
  begin
    insert into storage.objects (bucket_id, name) values ('vocabulary-images', 'anon-0047.png');
  exception when others then
    v_anon_write_error := sqlerrm;
  end;
  reset role;
  if v_anon_error is not null then
    insert into verify.failures values (format('anon reading the bucket: %s', v_anon_error));
  elsif v_n <> 1 then
    insert into verify.failures values (format('anon read %s files of the bucket, expected 1', v_n));
  end if;
  if v_anon_write_error is null then
    insert into verify.failures values ('anon wrote a file in the bucket');
  elsif v_anon_write_error not like 'new row violates row-level security policy%' then
    insert into verify.failures
      values (format('anon writing the bucket was refused by something else than row level security: %s',
                     v_anon_write_error));
  end if;

  perform set_config('test.uid', c_admin::text, false);
  set local role authenticated;
  v_admin_refused := verify.refused_for_privilege(
    'insert into storage.objects (bucket_id, name) values (''vocabulary-images'', ''admin-0047.png'')');
  reset role;
  if v_admin_refused then
    insert into verify.failures values ('the platform admin could not write a file in the bucket');
  end if;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'vocabulary_images_write is to authenticated; anon reads the bucket, row level security refuses its write; the platform admin writes';
  end if;

  -- A signup by a role that is neither the superuser nor the owner of the
  -- trigger functions, the way supabase_auth_admin inserts on the project.
  v_before := (select count(*) from verify.failures);
  create role verify_auth_admin nologin;
  grant usage on schema auth to verify_auth_admin;
  grant insert on auth.users to verify_auth_admin;
  set local role verify_auth_admin;
  begin
    insert into auth.users (id, email, email_confirmed_at)
      values (c_signup, 'signup-0047@example.com', now());
  exception when others then
    v_signup_error := sqlerrm;
  end;
  reset role;
  if v_signup_error is not null then
    insert into verify.failures values (format('a signup by a role without execute failed: %s', v_signup_error));
  elsif not exists (select 1 from profiles where id = c_signup) then
    insert into verify.failures values ('a signup by a role without execute made no profile');
  end if;
  delete from profiles where id = c_signup;
  delete from auth.users where id = c_signup;
  revoke all on auth.users from verify_auth_admin;
  revoke all on schema auth from verify_auth_admin;
  drop role verify_auth_admin;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'a signup by a role without execute fires both triggers of auth.users';
  end if;

  delete from storage.objects where name like '%-0047.png';
  -- The stub, so it never reaches the types.
  drop function public.rls_auto_enable();
  -- The uid of the blocks before.
  perform set_config('test.uid', coalesce(v_uid, ''), false);

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'a function runs only for who needs it: %', v_failures;
  end if;
end;
$$;


-- A time zone is one the screen reads (0048) ---------------------------------------------
--
-- profiles.timezone and lesson_schedules.timezone take only a zone in
-- pg_timezone_names that is not posix/ and not Factory, the zones Node's Intl
-- reads too. A trigger on each, before insert or update of timezone, refuses
-- with check_violation under the rule's name, and each refusal is asserted by
-- that name, as the person who writes the row does through the API: the
-- student her own profile (profiles_update_self), the teacher a schedule
-- (lesson_schedules_write). A row holding a name the tzdata dropped keeps it,
-- and a write to another of its columns passes. Nothing written here is kept.
--
-- The postgres:17 image this runs on (CI and local) lists 487 zones and no
-- posix/ name, so here a posix/ name is refused by the list itself and the
-- posix/ clause cannot be seen failing. The project lists 598 posix/ names:
-- that clause was shown on it, through the MCP, before the push (#219).

do $$
declare
  c_teacher constant uuid := '11111111-1111-1111-1111-111111111111';
  c_student constant uuid := '22222222-2222-2222-2222-222222222222';
  v_uid text := current_setting('test.uid', true);
  v_rows bigint;
  v_zone text;
  v_minute integer;
  v_name text := (select full_name from profiles where id = '22222222-2222-2222-2222-222222222222');
  v_failures text;
begin
  delete from verify.failures;
  set local role authenticated;

  perform set_config('test.uid', c_student::text, false);
  foreach v_zone in array array['x', 'posix/America/Sao_Paulo', 'Factory', '+03', ''] loop
    perform verify.expect_refused(format('a profile with the zone %L', v_zone),
      'profiles_timezone_known',
      format('update profiles set timezone = %L where id = %L', v_zone, c_student));
  end loop;
  update profiles set timezone = 'Europe/London' where id = c_student;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    insert into verify.failures values ('the student could not set her own zone to Europe/London');
  end if;
  update profiles set timezone = 'America/Sao_Paulo' where id = c_student;

  -- A name the tzdata dropped after it was written, put there as a restore
  -- would. Her name still changes; writing the zone again is refused.
  reset role;
  if exists (select 1 from pg_trigger where tgname = 'profiles_timezone_known') then
    alter table profiles disable trigger profiles_timezone_known;
    update profiles set timezone = 'Not/A_Zone' where id = c_student;
    alter table profiles enable trigger profiles_timezone_known;
  else
    update profiles set timezone = 'Not/A_Zone' where id = c_student;
  end if;
  set local role authenticated;
  begin
    update profiles set full_name = 'Student, renamed' where id = c_student;
  exception when others then
    insert into verify.failures values (format(
      'a profile whose zone left the list could not change its name: %s', sqlerrm));
  end;
  perform verify.expect_refused('a profile writing again a zone that left the list',
    'profiles_timezone_known',
    format('update profiles set timezone = %L where id = %L', 'Not/A_Zone', c_student));
  update profiles set timezone = 'America/Sao_Paulo', full_name = v_name where id = c_student;

  perform set_config('test.uid', c_teacher::text, false);
  -- A start time each, so a zone wrongly accepted leaves a row that does not
  -- collide with the next one, and every case is reported.
  v_minute := 0;
  foreach v_zone in array array['x', 'posix/America/Sao_Paulo', 'Factory'] loop
    v_minute := v_minute + 5;
    perform verify.expect_refused(format('a schedule with the zone %L', v_zone),
      'lesson_schedules_timezone_known',
      format('insert into lesson_schedules (student_id, weekday, start_time, timezone) values (%L, 3, %L, %L)',
             c_student, time '11:00' + make_interval(mins => v_minute), v_zone));
  end loop;
  insert into lesson_schedules (student_id, weekday, start_time, timezone)
    values (c_student, 3, '11:00', 'Europe/London');
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    insert into verify.failures values ('the teacher could not write a schedule in Europe/London');
  end if;
  delete from lesson_schedules where student_id = c_student and weekday = 3;
  reset role;

  if not has_function_privilege('authenticated', 'public.is_known_time_zone(text)', 'execute') then
    insert into verify.failures values ('authenticated cannot execute is_known_time_zone, so it cannot write a profile');
  end if;
  if has_function_privilege('anon', 'public.is_known_time_zone(text)', 'execute') then
    insert into verify.failures values ('anon executes is_known_time_zone');
  end if;
  if has_function_privilege('service_role', 'public.is_known_time_zone(text)', 'execute') then
    insert into verify.failures values ('service_role executes is_known_time_zone');
  end if;
  if has_function_privilege('anon', 'public.a_time_zone_is_known()', 'execute')
     or has_function_privilege('authenticated', 'public.a_time_zone_is_known()', 'execute')
     or has_function_privilege('service_role', 'public.a_time_zone_is_known()', 'execute') then
    insert into verify.failures values ('someone executes the trigger function a_time_zone_is_known');
  end if;

  -- This image lists no posix/ name (see above), so the clause is held by its
  -- text: removing it would pass every case here and fail on the project.
  if position($clause$name not like 'posix/%'$clause$
               in pg_get_functiondef('public.is_known_time_zone(text)'::regprocedure)) = 0 then
    insert into verify.failures values ('is_known_time_zone no longer leaves out the posix/ names');
  end if;

  -- The uid of the blocks before.
  perform set_config('test.uid', coalesce(v_uid, ''), false);

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'a time zone is one the screen reads: %', v_failures;
  end if;
  raise notice 'a zone outside the list, posix/ or Factory is refused by profiles_timezone_known and lesson_schedules_timezone_known; Europe/London passes; a row whose zone left the list still changes its other columns; only authenticated executes is_known_time_zone, nobody the trigger function';
end;
$$;

-- A plan is paid through Asaas (0049) -------------------------------------------------
--
-- The billing tables are read by their owner and the platform admin, written
-- by nobody but the ten billing functions, and those are executed by
-- service_role alone. Billing reaches a Chelsea St student only, never a
-- company's. One person per CPF, one CPF per person, one trial per person,
-- one subscription alive per person; a pending one is replaced, a canceled
-- one stays canceled; an event and an overdue step are taken once; a charge
-- never moves to another subscription. Every refusal is named: the SQLSTATE
-- and the constraint, by verify.named_refusal, which unlike verify.refused_by also
-- names a unique or privilege refusal.

-- The block records its failures as anon and service_role too.
grant insert, select on verify.failures to anon, service_role;

create function verify.named_refusal(p_sql text) returns text
language plpgsql as $$
declare
  v_name text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_name = constraint_name;
  return sqlstate || coalesce(' ' || nullif(v_name, ''), '');
end;
$$;

create function verify.expect_named_refusal(p_what text, p_expected text, p_sql text)
returns void
language plpgsql as $$
declare
  v_by text := verify.named_refusal(p_sql);
begin
  if v_by is null then
    insert into verify.failures values (format('%s: accepted', p_what));
  elsif v_by <> p_expected then
    insert into verify.failures
      values (format('%s: refused by %s, expected %s', p_what, v_by, p_expected));
  else
    raise notice '%: refused by %', p_what, v_by;
  end if;
end;
$$;

do $$
declare
  c_teacher constant uuid := '11111111-1111-1111-1111-111111111111';
  c_student constant uuid := '22222222-2222-2222-2222-222222222222';
  c_other constant uuid := 'b0490000-0000-4000-8000-000000000001';
  c_employee constant uuid := 'b0490000-0000-4000-8000-000000000002';
  c_hmac_a constant text := repeat('a', 64);
  c_hmac_b constant text := repeat('b', 64);
  c_hmac_c constant text := repeat('c', 64);
  c_tables constant text[] := array['plans', 'billing_customers', 'subscriptions',
                                    'payments', 'billing_events', 'overdue_steps'];
  c_functions constant regprocedure[] := array[
    'public.billing_customer(uuid, text)',
    'public.billing_open_subscription(uuid, uuid, text, text, integer, boolean, date, text, text, text)',
    'public.billing_apply_subscription(uuid, text, text, text, date, date, text)',
    'public.billing_find_subscription(text, text)',
    'public.billing_save_payment(text, uuid, text, integer, text, boolean, date, timestamptz, integer, text)',
    'public.billing_record_event(text, text, jsonb)',
    'public.billing_finish_event(text, text)',
    'public.billing_overdue_payments()',
    'public.billing_take_overdue_step(text, smallint)',
    'public.billing_finish_overdue_step(text, smallint, text, boolean)']::regprocedure[];
  v_uid text := current_setting('test.uid', true);
  v_plan uuid;
  v_inactive uuid;
  v_grifo uuid;
  v_sub uuid;
  v_other_sub uuid;
  v_awaiting uuid;
  v_pending uuid;
  v_fn regprocedure;
  v_table text;
  v_privilege text;
  v_role text;
  v_rows bigint;
  v_trial timestamptz;
  v_bool boolean;
  v_status text;
  v_failures text;
  c_plan_cols constant text :=
    'brand, key, name, monthly_price_cents, annual_price_cents, monthly_credits, '
    'trail_minutes_per_day, opens_voice_question, opens_free_conversation, opens_video, '
    'trial_days, trial_credits';
begin
  delete from verify.failures;

  -- Another Chelsea St student, and a company's employee.
  insert into auth.users (id, email, raw_user_meta_data) values
    (c_other, 'other-0049@example.com', '{"full_name":"Other"}'),
    (c_employee, 'employee-0049@example.com', '{"full_name":"Employee"}');
  insert into organization_members (organization_id, user_id, role) values
    ((select id from organizations where slug = 'chelsea-st'), c_other, 'student'),
    ((select id from organizations where slug = 'grifoai'), c_employee, 'student');

  -- The catalog, as the platform admin writes it. Made-up numbers.
  perform set_config('test.uid', c_teacher::text, false);
  set local role authenticated;
  execute format('insert into plans (%s) values (%s) returning id', c_plan_cols,
    $v$'chelsea-st', 'one', 'One', 1000, 10000, 10, 15, true, false, false, 14, 5$v$)
    into v_plan;
  execute format('insert into plans (%s, is_active) values (%s, false) returning id', c_plan_cols,
    $v$'chelsea-st', 'old', 'Old', 1000, 10000, 10, 15, true, false, false, 14, 5$v$)
    into v_inactive;
  execute format('insert into plans (%s) values (%s) returning id', c_plan_cols,
    $v$'grifoai', 'seat', 'Seat', 1000, 10000, 10, 15, true, false, false, 0, 0$v$)
    into v_grifo;
  update plans set name = 'One plan' where id = v_plan;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    insert into verify.failures values ('the platform admin could not change a plan');
  end if;
  perform verify.expect_named_refusal('a plan of an organization', '23514 plans_is_common',
    format('insert into plans (%s, organization_id) values (%s, %L)', c_plan_cols,
      $v$'chelsea-st', 'org', 'Org', 1000, 10000, 10, 15, true, false, false, 14, 5$v$,
      (select id from organizations where slug = 'chelsea-st')));

  -- A student reads the active plans and writes none.
  perform set_config('test.uid', c_student::text, false);
  if (select count(*) from plans) <> 2 then
    insert into verify.failures values (format(
      'a student reads %s plans, expected the 2 active', (select count(*) from plans)));
  end if;
  insert into verify.failures select 'a student wrote a plan'
   where verify.named_refusal(format('insert into plans (%s) values (%s)', c_plan_cols,
     $v$'chelsea-st', 'mine', 'Mine', 1, 1, 1, 15, true, true, true, 60, 999$v$)) is null;
  update plans set monthly_price_cents = 1 where id = v_plan;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    insert into verify.failures values ('a student changed the price of a plan');
  end if;
  reset role;

  -- anon reads the active plans, and nothing else of billing.
  set local role anon;
  if (select count(*) from plans) <> 2 then
    insert into verify.failures values ('anon does not read exactly the 2 active plans');
  end if;
  reset role;

  -- Who holds what. service_role holds no privilege on any of the six: the
  -- functions are its only door.
  foreach v_table in array c_tables loop
    foreach v_privilege in array array['select', 'insert', 'update', 'delete'] loop
      if has_table_privilege('service_role', 'public.' || v_table, v_privilege) then
        insert into verify.failures values (format('service_role has %s on %s', v_privilege, v_table));
      end if;
      if v_table <> 'plans'
         and has_table_privilege('anon', 'public.' || v_table, v_privilege) then
        insert into verify.failures values (format('anon has %s on %s', v_privilege, v_table));
      end if;
      if v_table <> 'plans' and v_privilege <> 'select'
         and has_table_privilege('authenticated', 'public.' || v_table, v_privilege) then
        insert into verify.failures values (format('authenticated has %s on %s', v_privilege, v_table));
      end if;
    end loop;
  end loop;
  foreach v_table in array array['billing_events', 'overdue_steps'] loop
    if has_table_privilege('authenticated', 'public.' || v_table, 'select') then
      insert into verify.failures values (format('authenticated reads %s', v_table));
    end if;
  end loop;
  if has_table_privilege('anon', 'public.plans', 'insert')
     or has_table_privilege('anon', 'public.plans', 'update') then
    insert into verify.failures values ('anon writes plans');
  end if;
  foreach v_fn in array c_functions loop
    if not has_function_privilege('service_role', v_fn, 'execute') then
      insert into verify.failures values (format('service_role does not execute %s', v_fn));
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        insert into verify.failures values (format('%s executes %s', v_role, v_fn));
      end if;
    end loop;
  end loop;

  -- The functions, as service_role calls them.
  set local role service_role;
  perform verify.expect_named_refusal('billing for a company''s employee', '42501',
    format('select billing_customer(%L, %L)', c_employee, c_hmac_c));
  v_trial := billing_customer(c_student, c_hmac_a);
  if v_trial is not null then
    insert into verify.failures values ('a new billing row says her trial was used');
  end if;
  perform billing_customer(c_student, c_hmac_a);
  perform verify.expect_named_refusal('a second CPF for the same person',
    '23514 billing_customers_one_cpf_per_person',
    format('select billing_customer(%L, %L)', c_student, c_hmac_b));
  perform verify.expect_named_refusal('the same CPF for another person',
    '23505 billing_customers_one_person_per_cpf',
    format('select billing_customer(%L, %L)', c_other, c_hmac_a));
  perform verify.expect_named_refusal('a CPF HMAC that is not one',
    '23514 billing_customers_cpf_hmac_shape',
    format('select billing_customer(%L, %L)', c_other, 'not-a-hmac'));
  if verify.named_refusal(format('select billing_customer(%L, %L)', c_other, c_hmac_b)) is not null then
    insert into verify.failures values ('the other student could not start billing with her own CPF');
  end if;

  v_sub := billing_open_subscription(c_student, v_plan, 'monthly', 'pix', 1000, true,
    current_date + 14, null, 'cus_1', 'sub_1');
  reset role;
  select status into v_status from subscriptions where id = v_sub;
  if v_status is distinct from 'trialing'
     or (select trial_used_at from billing_customers where person_id = c_student) is null then
    insert into verify.failures values ('a Pix subscription with a trial did not start trialing and mark the trial');
  end if;
  set local role service_role;
  perform verify.expect_named_refusal('a second subscription alive',
    '23505 subscriptions_one_alive_per_person',
    format('select billing_open_subscription(%L, %L, %L, %L, 1000, false, current_date, null, %L, %L)',
      c_student, v_plan, 'monthly', 'pix', 'cus_1', 'sub_2'));
  perform verify.expect_named_refusal('a second trial',
    '23514 billing_one_trial_per_person',
    format('select billing_open_subscription(%L, %L, %L, %L, 1000, true, current_date + 14, null, %L, %L)',
      c_student, v_plan, 'monthly', 'pix', 'cus_1', 'sub_3'));
  perform verify.expect_named_refusal('an inactive plan', '23514 billing_plan_active',
    format('select billing_open_subscription(%L, %L, %L, %L, 1000, false, current_date, null, %L, %L)',
      c_other, v_inactive, 'monthly', 'pix', 'cus_2', 'sub_4'));
  perform verify.expect_named_refusal('a GrifoAI plan', '23514 billing_plan_active',
    format('select billing_open_subscription(%L, %L, %L, %L, 1000, false, current_date, null, %L, %L)',
      c_other, v_grifo, 'monthly', 'pix', 'cus_2', 'sub_5'));
  -- A plan wrongly accepted above leaves a subscription; none is left for
  -- the cases below either way.
  reset role;
  delete from subscriptions where person_id = c_other;
  set local role service_role;
  perform verify.expect_named_refusal('a person with no billing row', '23503',
    format('select billing_open_subscription(%L, %L, %L, %L, 1000, false, current_date, null, %L, %L)',
      c_teacher, v_plan, 'monthly', 'pix', 'cus_3', 'sub_6'));
  perform verify.expect_named_refusal('a Pix subscription at a checkout',
    '23514 subscriptions_checkout_is_card',
    format('select billing_open_subscription(%L, %L, %L, %L, 1000, true, current_date + 14, %L, null, null)',
      c_other, v_plan, 'monthly', 'pix', 'chk_x'));

  -- A pending checkout left behind is replaced by the next one, and does not
  -- use the trial.
  v_pending := billing_open_subscription(c_other, v_plan, 'monthly', 'card', 1000, true,
    current_date + 14, 'chk_1', null, null);
  begin
    v_other_sub := billing_open_subscription(c_other, v_plan, 'annual', 'card', 10000, true,
      current_date + 14, 'chk_2', null, null);
  exception when unique_violation then
    reset role;
    select string_agg(what, '; ') into v_failures from verify.failures;
    raise exception 'a plan is paid through asaas: a pending checkout was not replaced by the next one (%)',
      coalesce(v_failures, 'nothing else failed');
  end;
  reset role;
  if (select status || '/' || cancel_reason from subscriptions where id = v_pending)
     is distinct from 'canceled/replaced' then
    insert into verify.failures values ('a pending subscription was not replaced by the next checkout');
  end if;
  if (select trial_used_at from billing_customers where person_id = c_other) is not null then
    insert into verify.failures values ('a checkout that did not finish used the trial');
  end if;
  set local role service_role;
  if (select count(*) from billing_find_subscription(null, 'chk_2')) <> 1
     or (select id from billing_find_subscription('sub_1', null)) <> v_sub then
    insert into verify.failures values ('billing_find_subscription does not find by checkout or by subscription');
  end if;
  -- Its first reading comes late, already paid: the trial still counts as used.
  perform billing_apply_subscription(v_other_sub, 'sub_7', 'cus_4', 'active', current_date + 30, null, null);
  reset role;
  if (select trial_used_at from billing_customers where person_id = c_other) is null then
    insert into verify.failures values ('a checkout read first as already paid did not use the trial');
  end if;
  -- A reading replaces paid_through: a refund takes its days back.
  set local role service_role;
  perform billing_apply_subscription(v_other_sub, null, null, 'active', null, null, null);
  reset role;
  if (select paid_through from subscriptions where id = v_other_sub) is not null then
    insert into verify.failures values ('a reading with nothing paid left paid_through in place');
  end if;
  set local role service_role;
  perform billing_apply_subscription(v_other_sub, null, null, 'active', current_date + 30, null, null);
  reset role;
  set local role service_role;
  perform verify.expect_named_refusal('past due without since',
    '23514 subscriptions_past_due_says_since',
    format('select billing_apply_subscription(%L, null, null, %L, null, null, null)', v_other_sub, 'past_due'));
  perform verify.expect_named_refusal('canceled without a reason',
    '23514 subscriptions_canceled_says_when',
    format('select billing_apply_subscription(%L, null, null, %L, null, null, null)', v_other_sub, 'canceled'));
  perform billing_apply_subscription(v_other_sub, null, null, 'canceled', null, null, 'person');
  perform billing_apply_subscription(v_other_sub, null, null, 'active', current_date, null, null);
  reset role;
  if (select status from subscriptions where id = v_other_sub) <> 'canceled' then
    insert into verify.failures values ('a canceled subscription came back alive');
  end if;
  if (select paid_through from subscriptions where id = v_other_sub) is distinct from current_date + 30 then
    insert into verify.failures values ('her cancel took away the days she had paid for');
  end if;

  -- With no trial, nothing opens before the first charge is paid.
  set local role service_role;
  v_awaiting := billing_open_subscription(c_other, v_plan, 'monthly', 'pix', 1000, false,
    current_date, null, 'cus_5', 'sub_8');
  reset role;
  if (select status from subscriptions where id = v_awaiting) is distinct from 'awaiting' then
    insert into verify.failures values ('a subscription with no trial and nothing paid is not awaiting');
  end if;

  -- Charges, events and overdue steps.
  set local role service_role;
  perform billing_save_payment('pay_1', v_sub, 'cycle', 1000, 'PENDING', false,
    current_date + 14, null, 0, 'https://example.com/i/1');
  perform billing_save_payment('pay_1', v_sub, 'cycle', 1000, 'OVERDUE', false,
    current_date + 14, null, 0, 'https://example.com/i/1');
  perform verify.expect_named_refusal('a charge moved to another subscription',
    '23514 billing_payment_keeps_its_subscription',
    format('select billing_save_payment(%L, %L, %L, 1000, %L, false, current_date, null, 0, null)',
      'pay_1', v_other_sub, 'cycle', 'PENDING'));
  perform verify.expect_named_refusal('a refund larger than the charge',
    '23514 payments_refund_within_value',
    format('select billing_save_payment(%L, %L, %L, 1000, %L, false, current_date, null, 1001, null)',
      'pay_2', v_sub, 'cycle', 'REFUNDED'));
  if (select count(*) from billing_overdue_payments()) <> 1 then
    insert into verify.failures values ('the overdue charge of an alive subscription is not listed');
  end if;
  if not billing_take_overdue_step('pay_1', 1::smallint)
     or billing_take_overdue_step('pay_1', 1::smallint) then
    insert into verify.failures values ('an overdue step was not taken exactly once');
  end if;
  perform billing_finish_overdue_step('pay_1', 1::smallint, 'error', false);
  if not billing_take_overdue_step('pay_1', 1::smallint) then
    insert into verify.failures values ('an overdue step that ended in error is not taken again');
  end if;
  perform billing_finish_overdue_step('pay_1', 1::smallint, 'refused', true);
  if billing_take_overdue_step('pay_1', 1::smallint) then
    insert into verify.failures values ('an overdue step that ended is taken again');
  end if;
  perform verify.expect_named_refusal('an overdue step on day 2', '23514 overdue_steps_day_known',
    $q$select billing_take_overdue_step('pay_1', 2::smallint)$q$);
  if not billing_record_event('evt_1', 'PAYMENT_CREATED', '{}')
     or not billing_record_event('evt_1', 'PAYMENT_CREATED', '{}') then
    insert into verify.failures values ('an event not finished is not handled again');
  end if;
  perform billing_finish_event('evt_1', null);
  if billing_record_event('evt_1', 'PAYMENT_CREATED', '{}') then
    insert into verify.failures values ('a finished event is handled again');
  end if;
  reset role;
  if (select count(*) from billing_events) <> 1 then
    insert into verify.failures values ('an event redelivered was kept twice');
  end if;

  -- Each person reads her own; the platform admin reads all.
  set local role authenticated;
  perform set_config('test.uid', c_student::text, false);
  if (select count(*) from subscriptions) <> 1 or (select count(*) from payments) <> 1
     or (select count(*) from billing_customers) <> 1 then
    insert into verify.failures values ('a student does not read exactly her own billing rows');
  end if;
  perform set_config('test.uid', c_other::text, false);
  if (select count(*) from payments) <> 0
     or exists (select 1 from subscriptions where person_id <> c_other) then
    insert into verify.failures values ('a student reads another person''s billing rows');
  end if;
  perform set_config('test.uid', c_teacher::text, false);
  if (select count(*) from subscriptions) <> 4 then
    insert into verify.failures values (format(
      'the platform admin reads %s subscriptions, expected 4', (select count(*) from subscriptions)));
  end if;
  reset role;

  -- Leave nothing behind for the blocks after, nor for the types.
  delete from overdue_steps;
  delete from payments;
  delete from subscriptions;
  delete from billing_customers;
  delete from billing_events;
  delete from plans;
  delete from organization_members where user_id in (c_other, c_employee);
  delete from auth.users where id in (c_other, c_employee);
  perform set_config('test.uid', coalesce(v_uid, ''), false);

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'a plan is paid through asaas: %', v_failures;
  end if;
  raise notice 'billing rows are read by their person and the platform admin, written only through the ten billing functions, which service_role alone executes; billing reaches Chelsea St students only; one CPF per person and person per CPF, one trial, one subscription alive; a pending checkout is replaced, a canceled subscription stays canceled; an event and an overdue step are taken once; a charge keeps its subscription';
end;
$$;

-- A signup opens one door (0051) ------------------------------------------------------
--
-- An account whose metadata says signup (the invite /cadastro asks for, #275)
-- joins, on the first confirmation of its email, the one organization with
-- open_signup, as a student: Chelsea St since 0051. Without signup nobody
-- joins by it, and the invite path stays as it was. A student invite accepted
-- in the same confirmation wins: she stays in the company alone. Metadata
-- changed after the confirmation, and a second confirmation, make nobody a
-- member. With the door closed a signup joins nothing, and fails nothing.
-- The door: only an organization of the brand chelsea-st with a teacher, each
-- clause refused by organizations_open_signup_chelsea on its own; one at a
-- time, by organizations_one_open_signup; changed by the platform admin and
-- not by the admin of the organization. join_by_signup is executed by nobody.
-- Nothing written here is kept, and the door ends open as 0051 leaves it.

do $$
declare
  c_platform_admin constant uuid := '11111111-1111-1111-1111-111111111111';
  c_new constant uuid := 'b0510000-0000-4000-8000-000000000001';
  c_plain constant uuid := 'b0510000-0000-4000-8000-000000000002';
  c_false constant uuid := 'b0510000-0000-4000-8000-000000000003';
  c_employee constant uuid := 'b0510000-0000-4000-8000-000000000004';
  c_later constant uuid := 'b0510000-0000-4000-8000-000000000005';
  c_closed constant uuid := 'b0510000-0000-4000-8000-000000000006';
  c_chelsea_admin constant uuid := 'b0510000-0000-4000-8000-000000000007';
  c_people constant uuid[] := array[c_new, c_plain, c_false, c_employee, c_later,
                                    c_closed, c_chelsea_admin];
  v_chelsea uuid := (select id from organizations where slug = 'chelsea-st');
  v_b uuid := (select id from organizations where slug = 'escola-b');
  v_company uuid;
  v_without uuid;
  v_second uuid;
  v_uid text := current_setting('test.uid', true);
  v_role text;
  v_before integer;
  v_failures text;
begin
  delete from verify.failures;

  v_before := (select count(*) from verify.failures);
  if not (select open_signup from organizations where id = v_chelsea) then
    insert into verify.failures values ('Chelsea St does not have the door open after 0051');
  end if;
  if (select count(*) from organizations where open_signup) <> 1 then
    insert into verify.failures values ('another organization than Chelsea St has the door open after 0051');
  end if;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'after 0051 Chelsea St, and only it, has the door open';
  end if;

  -- 1. A signup, confirmed, is a student of Chelsea St.
  v_before := (select count(*) from verify.failures);
  insert into auth.users (id, email, raw_user_meta_data)
    values (c_new, 'signup-0051@example.com', '{"signup": true, "full_name": "Nova Aluna"}');
  if exists (select 1 from organization_members where user_id = c_new) then
    insert into verify.failures values ('an unconfirmed signup joined an organization');
  end if;
  update auth.users set email_confirmed_at = now() where id = c_new;
  if not exists (select 1 from organization_members
                  where user_id = c_new and organization_id = v_chelsea and role = 'student') then
    insert into verify.failures values ('a confirmed signup is not a student member of Chelsea St');
  end if;
  if not exists (select 1 from students where id = c_new and organization_id = v_chelsea) then
    insert into verify.failures values ('a confirmed signup has no students row in Chelsea St');
  end if;
  if (select count(*) from organization_members where user_id = c_new) <> 1 then
    insert into verify.failures values ('a confirmed signup holds more than the one membership');
  end if;
  if (select full_name from profiles where id = c_new) is distinct from 'Nova Aluna' then
    insert into verify.failures values ('a signup''s profile does not carry the name she typed');
  end if;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'a signup joins Chelsea St as a student on the first confirmation, not before, with her name';
  end if;

  -- 2. Without signup, confirmed at birth or later, nobody joins by it.
  v_before := (select count(*) from verify.failures);
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
    values (c_plain, 'plain-0051@example.com', '{"full_name": "Sem Cadastro"}', now());
  insert into auth.users (id, email, raw_user_meta_data)
    values (c_false, 'false-0051@example.com', '{"signup": false}');
  update auth.users set email_confirmed_at = now() where id = c_false;
  if exists (select 1 from organization_members where user_id in (c_plain, c_false)) then
    insert into verify.failures values ('an account without signup joined an organization with no invite');
  end if;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'an account without signup, or with signup false, joins nothing with no invite';
  end if;

  -- 3. A company's student invite accepted in the same confirmation wins.
  v_before := (select count(*) from verify.failures);
  insert into organizations (slug, name, brand, has_teacher)
    values ('empresa-0051', 'Empresa 0051', 'grifoai', false) returning id into v_company;
  insert into organization_invites (organization_id, email, role, invited_by)
    values (v_company, 'employee-0051@example.com', 'student', c_platform_admin);
  insert into auth.users (id, email, raw_user_meta_data)
    values (c_employee, 'employee-0051@example.com', '{"signup": true}');
  update auth.users set email_confirmed_at = now() where id = c_employee;
  if not exists (select 1 from students where id = c_employee and organization_id = v_company) then
    insert into verify.failures values ('the company invite was not accepted for a signup');
  end if;
  if exists (select 1 from organization_members where user_id = c_employee and organization_id = v_chelsea) then
    insert into verify.failures values ('a student of a company joined Chelsea St by the signup');
  end if;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'a student invite of a company, accepted in the same confirmation, wins over the signup';
  end if;

  -- 6. Only the first confirmation counts.
  v_before := (select count(*) from verify.failures);
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
    values (c_later, 'later-0051@example.com', '{"full_name": "Depois"}', now());
  update auth.users set raw_user_meta_data = '{"signup": true}' where id = c_later;
  update auth.users set email_confirmed_at = now() where id = c_later;
  if exists (select 1 from organization_members where user_id = c_later) then
    insert into verify.failures values ('signup written after the first confirmation made a member');
  end if;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'signup written after the first confirmation, and a second confirmation, make nobody a member';
  end if;

  -- With the door closed a signup joins nothing, and the confirmation goes through.
  v_before := (select count(*) from verify.failures);
  update organizations set open_signup = false where id = v_chelsea;
  insert into auth.users (id, email, raw_user_meta_data)
    values (c_closed, 'closed-0051@example.com', '{"signup": true}');
  update auth.users set email_confirmed_at = now() where id = c_closed;
  if exists (select 1 from organization_members where user_id = c_closed) then
    insert into verify.failures values ('a signup joined an organization with every door closed');
  end if;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'with every door closed a signup is confirmed and joins nothing';
  end if;

  -- 4. Only chelsea-st with a teacher opens the door, each clause on its own.
  -- Chelsea's door is closed here, so the unique index cannot answer first.
  perform verify.expect_named_refusal(
    'a company with a teacher opens the door', '23514 organizations_open_signup_chelsea',
    format('update organizations set open_signup = true where id = %L', v_b));
  insert into organizations (slug, name, brand, has_teacher)
    values ('chelsea-0051-sem-professor', 'Chelsea sem professor', 'chelsea-st', false)
    returning id into v_without;
  perform verify.expect_named_refusal(
    'a chelsea-st organization without a teacher opens the door', '23514 organizations_open_signup_chelsea',
    format('update organizations set open_signup = true where id = %L', v_without));
  perform verify.expect_named_refusal(
    'a company without a teacher opens the door', '23514 organizations_open_signup_chelsea',
    format('update organizations set open_signup = true where id = %L', v_company));

  -- 5. One door at a time.
  update organizations set open_signup = true where id = v_chelsea;
  insert into organizations (slug, name, brand, has_teacher)
    values ('chelsea-0051-segunda', 'Chelsea segunda', 'chelsea-st', true)
    returning id into v_second;
  perform verify.expect_named_refusal(
    'a second organization opens the door', '23505 organizations_one_open_signup',
    format('update organizations set open_signup = true where id = %L', v_second));

  -- 7. The admin of Chelsea St, not a platform admin, does not move the door;
  -- the platform admin does.
  v_before := (select count(*) from verify.failures);
  insert into auth.users (id, email, email_confirmed_at)
    values (c_chelsea_admin, 'chelsea-admin-0051@example.com', now());
  insert into organization_members (organization_id, user_id, role)
    values (v_chelsea, c_chelsea_admin, 'admin');
  set local role authenticated;
  perform set_config('test.uid', c_chelsea_admin::text, false);
  update organizations set open_signup = false where id = v_chelsea;
  reset role;
  if not (select open_signup from organizations where id = v_chelsea) then
    insert into verify.failures values ('the admin of Chelsea St, not a platform admin, closed its door');
    update organizations set open_signup = true where id = v_chelsea;
  end if;
  set local role authenticated;
  perform set_config('test.uid', c_platform_admin::text, false);
  update organizations set open_signup = false where id = v_chelsea;
  reset role;
  if (select open_signup from organizations where id = v_chelsea) then
    insert into verify.failures values ('the platform admin could not close the door');
  end if;
  set local role authenticated;
  update organizations set open_signup = true where id = v_chelsea;
  reset role;
  if not (select open_signup from organizations where id = v_chelsea) then
    insert into verify.failures values ('the platform admin could not open the door');
    update organizations set open_signup = true where id = v_chelsea;
  end if;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'only the platform admin moves the door, not the admin of the organization';
  end if;

  -- 8. join_by_signup is executed by nobody, as the trigger functions.
  v_before := (select count(*) from verify.failures);
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(v_role, 'public.join_by_signup(uuid, jsonb)', 'execute') then
      insert into verify.failures values (format('%s executes join_by_signup', v_role));
    end if;
  end loop;
  if not (select prosecdef from pg_proc where oid = 'public.join_by_signup(uuid, jsonb)'::regprocedure) then
    insert into verify.failures values ('join_by_signup is not security definer');
  end if;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'join_by_signup is security definer and executed by nobody';
  end if;

  -- Nothing written here is kept.
  delete from students where id = any (c_people);
  delete from organization_members where user_id = any (c_people);
  delete from organization_invites where email like '%-0051@example.com';
  delete from profiles where id = any (c_people);
  delete from auth.users where id = any (c_people);
  delete from organizations where id in (v_company, v_without, v_second);
  perform set_config('test.uid', coalesce(v_uid, ''), false);

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'a signup opens one door: %', v_failures;
  end if;
end;
$$;

-- A restored copy gets back what the dump leaves out (#101, #104) --------------------
--
-- supabase db dump writes the schemas of the project, not storage or auth, so
-- a copy restored by docs/commands.md comes back without what the migrations
-- create there: the policies of storage and auth (#101), and the triggers of
-- auth and storage that call a function of public (#104), on which a new
-- account gets its profile and an invite its yes. The functions themselves are
-- in public and come with the dump. scripts/restore-outside-public.sql
-- recreates the rest, and this block holds that file to what the migrations
-- above leave: it records every such policy and trigger, by the same catalog
-- fields scripts/catalog-fingerprint.sql reads (a trigger by pg_get_triggerdef,
-- which names its table, and tgenabled), drops them all, runs the file, and
-- compares both ways, by name. A migration that changes one of them and
-- forgets the file fails here. The order the two triggers of auth.users fire
-- in (by name: the profile before the invite) is held by the blocks above,
-- which sign people up through them; renaming one in the file alone fails
-- the comparison here.

create temporary view restore_objects as
  select 'policy'::text as kind,
         pol.polname::text as name,
         format('%s.%s|cmd=%s|roles=%s|permissive=%s|using=%s|check=%s',
                n.nspname, c.relname, pol.polcmd,
                (select string_agg(g.name, ',' order by g.name)
                   from unnest(pol.polroles) r
                   cross join lateral (select case when r = 0 then 'PUBLIC'
                                                   else pg_get_userbyid(r)::text end as name) g),
                pol.polpermissive,
                coalesce(pg_get_expr(pol.polqual, pol.polrelid), '-'),
                coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '-')) as shape,
         n.nspname::text as schema_name,
         c.relname::text as table_name
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('storage', 'auth')
  union all
  select 'trigger',
         t.tgname::text,
         format('%s|enabled=%s', pg_get_triggerdef(t.oid), t.tgenabled),
         n.nspname::text,
         c.relname::text
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
   where n.nspname in ('storage', 'auth')
     and p.pronamespace = 'public'::regnamespace
     and not t.tgisinternal;

create temporary table restore_expected as select kind, name, shape from restore_objects;

do $$
declare
  v_object record;
begin
  if (select count(*) from restore_expected where kind = 'policy') = 0
     or (select count(*) from restore_expected where kind = 'trigger') = 0 then
    raise exception 'restore: the migrations left no policy or no trigger outside public to compare with';
  end if;
  for v_object in select kind, name, schema_name, table_name from restore_objects loop
    execute format('drop %s %I on %I.%I',
                   v_object.kind, v_object.name, v_object.schema_name, v_object.table_name);
  end loop;
end;
$$;

\i scripts/restore-outside-public.sql

do $$
declare
  v_failures text;
begin
  with
  missing as (select kind, name, shape from restore_expected
              except select kind, name, shape from restore_objects),
  extra as (select kind, name, shape from restore_objects
            except select kind, name, shape from restore_expected)
  select string_agg(what, '; ' order by what) into v_failures
    from (select format('the file does not restore %s %s as the migrations leave it (%s)',
                        kind, name, shape) as what from missing
          union all
          select format('the file restores %s %s, which the migrations do not leave (%s)',
                        kind, name, shape) from extra) f;
  if v_failures is not null then
    raise exception 'restore: %', v_failures;
  end if;
  raise notice 'scripts/restore-outside-public.sql gives back every policy of storage and auth, and every trigger there on a function of public, that the migrations leave, and no other';
end;
$$;

drop table restore_expected;
drop view restore_objects;

-- Nobody truncates what RLS guards (0037) ----------------------------------------------
--
-- Holds for every relation public has now and any a migration adds later: the
-- last block of the script, so it sees whatever the migrations above created.
-- anon, authenticated and service_role hold none of truncate, references,
-- trigger and maintain on any relation of public, references on no column;
-- postgres's default ACL in public gives none of the four to the three; and a
-- table created here, as postgres, is born with no privilege at all for them.
-- has_table_privilege also sees what reaches a role through PUBLIC.
--
-- The probe table is dropped in the same block: scripts/gen-types.sh makes the
-- types from this same database, and it must not show in them.
do $$
declare
  c_roles constant text[] := array['anon', 'authenticated', 'service_role'];
  c_unused constant text[] := array['truncate', 'references', 'trigger', 'maintain'];
  v_relation record;
  v_role text;
  v_privilege text;
  v_failures text;
  v_before bigint := 0;
begin
  delete from verify.failures;

  for v_relation in
    select c.oid, c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     order by c.relname
  loop
    foreach v_role in array c_roles loop
      foreach v_privilege in array c_unused loop
        if has_table_privilege(v_role, v_relation.oid, v_privilege) then
          insert into verify.failures
            values (format('%s has %s on %s', v_role, v_privilege, v_relation.relname));
        end if;
      end loop;
      if has_any_column_privilege(v_role, v_relation.oid, 'references')
         and not has_table_privilege(v_role, v_relation.oid, 'references') then
        insert into verify.failures
          values (format('%s has references on a column of %s', v_role, v_relation.relname));
      end if;
    end loop;
  end loop;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'no relation of public gives truncate, references, trigger or maintain to anon, authenticated or service_role';
  end if;
  v_before := (select count(*) from verify.failures);

  insert into verify.failures
  select format('the default ACL of postgres in public gives %s %s on new tables',
                r.rolname, a.privilege_type)
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    join pg_roles r on r.oid = a.grantee
   where d.defaclrole = 'postgres'::regrole
     and d.defaclnamespace = 'public'::regnamespace
     and d.defaclobjtype = 'r'
     and r.rolname = any (c_roles)
     and lower(a.privilege_type) = any (c_unused)
   order by r.rolname, a.privilege_type;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'the default ACL of postgres in public gives none of the four to the three roles';
  end if;
  v_before := (select count(*) from verify.failures);

  if current_user <> 'postgres' then
    insert into verify.failures values (format(
      'the probe table would be created by %s, not postgres, and prove nothing about its default ACL',
      current_user));
  end if;
  create table public.verify_default_acl_probe (id integer);
  foreach v_role in array c_roles loop
    foreach v_privilege in array array['select', 'insert', 'update', 'delete',
                                       'truncate', 'references', 'trigger', 'maintain'] loop
      if has_table_privilege(v_role, 'public.verify_default_acl_probe', v_privilege) then
        insert into verify.failures
          values (format('a new table is born giving %s %s', v_role, v_privilege));
      end if;
    end loop;
  end loop;
  drop table public.verify_default_acl_probe;
  if (select count(*) from verify.failures) = v_before then
    raise notice 'a new table of public is born with no privilege for anon, authenticated or service_role';
  end if;

  select string_agg(what, '; ') into v_failures from verify.failures;
  if v_failures is not null then
    raise exception 'unused privileges: %', v_failures;
  end if;
end;
$$;
