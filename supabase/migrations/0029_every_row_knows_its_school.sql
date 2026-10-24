-- Every row knows its school (ADR 0004, issue #95).
--
-- The platform is one database for many schools. Until now everything belonged
-- to Chelsea St by implication, and is_teacher() answered "any teacher": a
-- teacher from a second school would have read and written everything.
--
-- After this migration:
--   - schools holds the schools; Chelsea St is the first row.
--   - school_members says who is admin, teacher or student of which school.
--     It replaces profiles.role, which is dropped at the end.
--   - platform_admins holds the people above every school (Luiz, for GrifoAI).
--     They may do everything, in every table. No policy lets the API write
--     this table.
--   - People and day-to-day operation carry a school_id that is never null.
--   - Content carries a school_id that is null for common content, shared by
--     every school, and filled for content that belongs to one school.
--
-- Measured against the project on 2026-10-24, before this was written:
--
--   26 migrations applied, the same as the files on disk (0001 to 0028,
--   without 0023 and 0024).
--   17 tables, every one with row level security; 29 policies, 27 of them
--   calling is_teacher(); 2 on storage.objects.
--   profiles: 1 row, role = 'teacher', and the same id has a students row
--   (the teacher's own test student), with 1 lesson.
--   books 12, lessons_content 9, points 128, blocks 144, vocabulary_items 283,
--   image_attempts 176, contrast_sets 21, contrast_set_items 61, questions 10;
--   lesson_schedules, assignments, assignment_items, attempts and
--   review_schedule 0 each.
--   Unique indexes that span the whole table: books_position_key (position)
--   and vocabulary_items_term_idx (lower(term)). Every other one is already
--   scoped by a parent.
--   storage.objects: 185 files; 163 under {vocabulary_item_id}/, 22 under
--   references/. No path changes here.
--
-- The backfill, from those numbers: the teacher becomes a platform admin and
-- admin of Chelsea St; every students row becomes a Chelsea St student, so
-- the teacher is also a student there and keeps the test student and its
-- lesson. All content becomes common.

-- Schools and who belongs to them ----------------------------------------------

create table schools (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);

insert into schools (slug, name) values ('chelsea-st', 'Chelsea St');

create type school_role as enum ('admin', 'teacher', 'student');

-- One row per role: the same person can be admin and student of one school,
-- which is how the platform admin sees the student's screens without a second
-- account. The key is the three columns for that reason.
create table school_members (
  school_id uuid not null references schools (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role school_role not null,
  created_at timestamptz not null default now(),
  primary key (school_id, user_id, role)
);
create index school_members_user_idx on school_members (user_id);

create table platform_admins (
  user_id uuid primary key references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into platform_admins (user_id)
  select id from profiles where role = 'teacher';

insert into school_members (school_id, user_id, role)
  select (select id from schools where slug = 'chelsea-st'), id, 'admin'
    from profiles where role = 'teacher';

insert into school_members (school_id, user_id, role)
  select (select id from schools where slug = 'chelsea-st'), id, 'student'
    from students;

-- Membership checks ------------------------------------------------------------
--
-- Security definer so a policy on school_members can call them without
-- recursing into its own policy. Each returns only a boolean about the caller.

create function is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- p_roles null means any role.
create function is_school_member(p_school uuid, p_roles school_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from school_members
     where school_id = p_school
       and user_id = auth.uid()
       and (p_roles is null or role = any (p_roles))
  );
$$;

-- Admin or teacher of at least one school: who may read common content.
create function teaches_anywhere()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from school_members
     where user_id = auth.uid() and role in ('admin', 'teacher')
  );
$$;

-- Member of at least one school, in any role: who may read a common question
-- once it is published.
create function belongs_anywhere()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from school_members where user_id = auth.uid());
$$;

-- Common content (null) is written only by a platform admin; a school's
-- content by a platform admin or that school's admin or teacher. Used by the
-- functions below, which name the row's school before they write.
create function can_write_content(p_school uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_platform_admin()
      or (p_school is not null and is_school_member(p_school, '{admin,teacher}'));
$$;

-- school_id on every older table ------------------------------------------------

alter table students add column school_id uuid references schools (id);
update students set school_id = (select id from schools where slug = 'chelsea-st');
alter table students alter column school_id set not null;
alter table students add constraint students_school_id_id_key unique (school_id, id);

alter table lessons add column school_id uuid;
alter table lesson_schedules add column school_id uuid;
alter table assignments add column school_id uuid;
alter table attempts add column school_id uuid;
alter table review_schedule add column school_id uuid;
update lessons t set school_id = s.school_id from students s where s.id = t.student_id;
update lesson_schedules t set school_id = s.school_id from students s where s.id = t.student_id;
update assignments t set school_id = s.school_id from students s where s.id = t.student_id;
update attempts t set school_id = s.school_id from students s where s.id = t.student_id;
update review_schedule t set school_id = s.school_id from students s where s.id = t.student_id;

alter table assignment_items add column school_id uuid;
update assignment_items t set school_id = a.school_id from assignments a where a.id = t.assignment_id;

alter table lessons alter column school_id set not null;
alter table lesson_schedules alter column school_id set not null;
alter table assignments alter column school_id set not null;
alter table assignment_items alter column school_id set not null;
alter table attempts alter column school_id set not null;
alter table review_schedule alter column school_id set not null;

-- A child of a student points at her through her school as well, so it cannot
-- name a student of another school. Replaces the single-column keys, with the
-- same delete behaviour.
alter table lessons drop constraint lessons_student_id_fkey,
  add constraint lessons_student_fkey foreign key (school_id, student_id)
    references students (school_id, id) on delete cascade;
alter table lesson_schedules drop constraint lesson_schedules_student_id_fkey,
  add constraint lesson_schedules_student_fkey foreign key (school_id, student_id)
    references students (school_id, id) on delete cascade;
alter table assignments drop constraint assignments_student_id_fkey,
  add constraint assignments_student_fkey foreign key (school_id, student_id)
    references students (school_id, id) on delete cascade;
alter table attempts drop constraint attempts_student_id_fkey,
  add constraint attempts_student_fkey foreign key (school_id, student_id)
    references students (school_id, id) on delete cascade;
alter table review_schedule drop constraint review_schedule_student_id_fkey,
  add constraint review_schedule_student_fkey foreign key (school_id, student_id)
    references students (school_id, id) on delete cascade;
alter table assignments add constraint assignments_school_id_id_key unique (school_id, id);
alter table assignment_items drop constraint assignment_items_assignment_id_fkey,
  add constraint assignment_items_assignment_fkey foreign key (school_id, assignment_id)
    references assignments (school_id, id) on delete cascade;

-- Content: null is common. based_on_id is the common row a school's copy
-- customizes; nothing reads it yet, the first customization will. Not on
-- image_attempts or contrast_set_items: an attempt is a record of a
-- generation and a set member is a link, neither is something a school
-- rewrites.
alter table books
  add column school_id uuid references schools (id),
  add column based_on_id uuid references books (id) on delete set null;
alter table lessons_content
  add column school_id uuid references schools (id),
  add column based_on_id uuid references lessons_content (id) on delete set null;
alter table points
  add column school_id uuid references schools (id),
  add column based_on_id uuid references points (id) on delete set null;
alter table blocks
  add column school_id uuid references schools (id),
  add column based_on_id uuid references blocks (id) on delete set null;
alter table vocabulary_items
  add column school_id uuid references schools (id),
  add column based_on_id uuid references vocabulary_items (id) on delete set null;
alter table image_attempts add column school_id uuid references schools (id);
alter table contrast_sets
  add column school_id uuid references schools (id),
  add column based_on_id uuid references contrast_sets (id) on delete set null;
alter table contrast_set_items add column school_id uuid references schools (id);
alter table questions
  add column school_id uuid references schools (id),
  add column based_on_id uuid references questions (id) on delete set null;

-- The two unique indexes that spanned the whole table hold per scope now:
-- common is one scope, each school another. nulls not distinct keeps two
-- common books from sharing a position.
alter table books drop constraint books_position_key;
alter table books
  add constraint books_position_key unique nulls not distinct (school_id, position);
drop index vocabulary_items_term_idx;
create unique index vocabulary_items_term_idx
  on vocabulary_items (school_id, lower(term)) nulls not distinct;

-- A row follows its parents --------------------------------------------------
--
-- Arguments are pairs: a column of the row and the table it points at. The
-- first parent gives the row its school when the row arrives without one, so
-- the functions and screens that insert today need not name it. Every parent
-- must then be common or of the row's own school; a foreign key cannot say
-- "null or equal", so this does. And a school_id never changes once written.
--
-- Security definer: the parent is read past RLS. Read as the caller, a parent
-- of another school would be invisible and look common.
create function school_follows_parents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_parent uuid;
  v_parent_school uuid;
  i integer := 0;
begin
  if tg_op = 'UPDATE' and new.school_id is distinct from old.school_id then
    raise exception '%: school_id cannot change once written', tg_table_name
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  while i < tg_nargs loop
    v_parent := (v_row ->> tg_argv[i])::uuid;
    if v_parent is not null then
      execute format('select school_id from %I where id = $1', tg_argv[i + 1])
        into v_parent_school
        using v_parent;

      if i = 0 and new.school_id is null then
        new.school_id := v_parent_school;
      end if;

      if v_parent_school is not null and v_parent_school is distinct from new.school_id then
        raise exception '%.%: points at a row of another school', tg_table_name, tg_argv[i]
          using errcode = 'check_violation', constraint = tg_name;
      end if;
    end if;
    i := i + 2;
  end loop;

  return new;
end;
$$;

create trigger students_school before insert or update on students
  for each row execute function school_follows_parents();
create trigger lessons_school before insert or update on lessons
  for each row execute function school_follows_parents('student_id', 'students');
create trigger lesson_schedules_school before insert or update on lesson_schedules
  for each row execute function school_follows_parents('student_id', 'students');
create trigger assignments_school before insert or update on assignments
  for each row execute function school_follows_parents('student_id', 'students');
create trigger assignment_items_school before insert or update on assignment_items
  for each row execute function school_follows_parents(
    'assignment_id', 'assignments', 'question_id', 'questions');
create trigger attempts_school before insert or update on attempts
  for each row execute function school_follows_parents(
    'student_id', 'students', 'question_id', 'questions',
    'assignment_item_id', 'assignment_items');
create trigger review_schedule_school before insert or update on review_schedule
  for each row execute function school_follows_parents(
    'student_id', 'students', 'question_id', 'questions');

create trigger books_school before insert or update on books
  for each row execute function school_follows_parents('based_on_id', 'books');
create trigger contrast_sets_school before insert or update on contrast_sets
  for each row execute function school_follows_parents('based_on_id', 'contrast_sets');
create trigger lessons_content_school before insert or update on lessons_content
  for each row execute function school_follows_parents(
    'book_id', 'books', 'based_on_id', 'lessons_content');
create trigger points_school before insert or update on points
  for each row execute function school_follows_parents(
    'book_id', 'books', 'lesson_content_id', 'lessons_content', 'based_on_id', 'points');
create trigger blocks_school before insert or update on blocks
  for each row execute function school_follows_parents(
    'point_id', 'points', 'based_on_id', 'blocks');
create trigger vocabulary_items_school before insert or update on vocabulary_items
  for each row execute function school_follows_parents(
    'first_point_id', 'points', 'approved_attempt_id', 'image_attempts',
    'based_on_id', 'vocabulary_items');
create trigger image_attempts_school before insert or update on image_attempts
  for each row execute function school_follows_parents(
    'vocabulary_item_id', 'vocabulary_items');
create trigger contrast_set_items_school before insert or update on contrast_set_items
  for each row execute function school_follows_parents(
    'set_id', 'contrast_sets', 'vocabulary_item_id', 'vocabulary_items');
create trigger questions_school before insert or update on questions
  for each row execute function school_follows_parents(
    'point_id', 'points', 'shown_vocabulary_item_id', 'vocabulary_items',
    'based_on_id', 'questions');

-- Policies ---------------------------------------------------------------------
--
-- (select is_platform_admin()) and the other checks that do not depend on the
-- row are wrapped in a select so Postgres evaluates them once per query.

alter table schools enable row level security;
alter table school_members enable row level security;
alter table platform_admins enable row level security;

grant select, insert, update, delete on schools to authenticated;
grant select, insert, update, delete on school_members to authenticated;
-- Read only, and no write policy either: a platform admin is made by a
-- migration or by Luiz in the dashboard, never through the API.
grant select on platform_admins to authenticated;
revoke all on schools, school_members, platform_admins from anon;

create policy schools_read on schools
  for select using ((select is_platform_admin()) or is_school_member(id));
create policy schools_write on schools
  for all using ((select is_platform_admin())) with check ((select is_platform_admin()));

create policy school_members_read on school_members
  for select using (
    (select is_platform_admin())
    or user_id = auth.uid()
    or is_school_member(school_id, '{admin,teacher}'));
create policy school_members_write on school_members
  for all using ((select is_platform_admin())) with check ((select is_platform_admin()));

create policy platform_admins_read on platform_admins
  for select using (user_id = auth.uid() or (select is_platform_admin()));

-- People. A teacher sees the profiles of the people of her schools.
drop policy profiles_select_self_or_teacher on profiles;
create policy profiles_read on profiles
  for select using (
    id = auth.uid()
    or (select is_platform_admin())
    or exists (
      select 1 from school_members m
       where m.user_id = profiles.id
         and is_school_member(m.school_id, '{admin,teacher}')));

drop policy students_select_self_or_teacher on students;
drop policy students_write_teacher on students;
create policy students_read on students
  for select using (
    id = auth.uid()
    or (select is_platform_admin())
    or is_school_member(school_id, '{admin,teacher}'));
create policy students_write on students
  for all
  using ((select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'))
  with check ((select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'));

-- Operation: the student reads her own rows, the school's admins and teachers
-- read and write them, as before but within the school.
drop policy lessons_select_own_or_teacher on lessons;
drop policy lessons_write_teacher on lessons;
create policy lessons_read on lessons
  for select using (
    student_id = auth.uid()
    or (select is_platform_admin())
    or is_school_member(school_id, '{admin,teacher}'));
create policy lessons_write on lessons
  for all
  using ((select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'))
  with check ((select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'));

drop policy lesson_schedules_select_own_or_teacher on lesson_schedules;
drop policy lesson_schedules_write_teacher on lesson_schedules;
create policy lesson_schedules_read on lesson_schedules
  for select using (
    student_id = auth.uid()
    or (select is_platform_admin())
    or is_school_member(school_id, '{admin,teacher}'));
create policy lesson_schedules_write on lesson_schedules
  for all
  using ((select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'))
  with check ((select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'));

drop policy assignments_select_own_or_teacher on assignments;
drop policy assignments_write_teacher on assignments;
create policy assignments_read on assignments
  for select using (
    student_id = auth.uid()
    or (select is_platform_admin())
    or is_school_member(school_id, '{admin,teacher}'));
create policy assignments_write on assignments
  for all
  using ((select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'))
  with check ((select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'));

drop policy assignment_items_select_own_or_teacher on assignment_items;
drop policy assignment_items_write_teacher on assignment_items;
create policy assignment_items_read on assignment_items
  for select using (
    (select is_platform_admin())
    or is_school_member(school_id, '{admin,teacher}')
    or exists (
      select 1 from assignments a
       where a.id = assignment_items.assignment_id and a.student_id = auth.uid()));
create policy assignment_items_write on assignment_items
  for all
  using ((select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'))
  with check ((select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'));

drop policy attempts_select_own_or_teacher on attempts;
drop policy attempts_update_teacher on attempts;
create policy attempts_read on attempts
  for select using (
    student_id = auth.uid()
    or (select is_platform_admin())
    or is_school_member(school_id, '{admin,teacher}'));
create policy attempts_update on attempts
  for update
  using ((select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'))
  with check ((select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'));

drop policy review_schedule_select_own_or_teacher on review_schedule;
drop policy review_schedule_write_teacher on review_schedule;
create policy review_schedule_read on review_schedule
  for select using (
    student_id = auth.uid()
    or (select is_platform_admin())
    or is_school_member(school_id, '{admin,teacher}'));
create policy review_schedule_write on review_schedule
  for all
  using ((select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'))
  with check ((select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'));

-- Content. Read by the admins and teachers who may use it: common content by
-- those of any school, a school's content by those of that school. Written
-- by a platform admin, and a school's content also by its admins and teachers.
do $$
declare
  t text;
begin
  foreach t in array array[
    'books', 'lessons_content', 'points', 'blocks', 'vocabulary_items',
    'image_attempts', 'contrast_sets', 'contrast_set_items', 'questions'
  ] loop
    execute format('drop policy %I on %I',
                   case when t = 'questions' then 'questions_write_teacher'
                        else t || '_teacher_all' end,
                   t);
    execute format($p$
      create policy %I on %I
        for all
        using ((select is_platform_admin())
               or (school_id is not null and is_school_member(school_id, '{admin,teacher}')))
        with check ((select is_platform_admin())
               or (school_id is not null and is_school_member(school_id, '{admin,teacher}')))
    $p$, t || '_write', t);
    execute format($p$
      create policy %I on %I
        for select using (
          (select is_platform_admin())
          or (school_id is null and (select teaches_anywhere()))
          or is_school_member(school_id, '{admin,teacher}'))
    $p$, t || '_read', t);
  end loop;
end;
$$;

-- And a published question reaches the students: a common one any student,
-- a school's one only that school's students.
drop policy questions_select_published on questions;
create policy questions_read_published on questions
  for select to authenticated using (
    is_published
    and ((school_id is null and (select belongs_anywhere()))
         or is_school_member(school_id)));

-- Storage: the bucket stays public to read. Writing: a platform admin
-- anywhere, a school's admin or teacher under a first folder that is the
-- school's id. Qualified, as in 0008: a storage request does not arrive with
-- public on its search_path.
drop policy vocabulary_images_write_teacher on storage.objects;
create policy vocabulary_images_write on storage.objects
  for all
  using (bucket_id = 'vocabulary-images' and (
    (select public.is_platform_admin())
    or exists (
      select 1 from public.school_members m
       where m.user_id = auth.uid()
         and m.role in ('admin', 'teacher')
         and m.school_id::text = split_part(name, '/', 1))))
  with check (bucket_id = 'vocabulary-images' and (
    (select public.is_platform_admin())
    or exists (
      select 1 from public.school_members m
       where m.user_id = auth.uid()
         and m.role in ('admin', 'teacher')
         and m.school_id::text = split_part(name, '/', 1))));

-- The functions that asked is_teacher() ask about the row's school ------------
--
-- Bodies as they are in the project on 2026-10-24 (pg_get_functiondef); only
-- the first check changes.

create or replace function delete_question(p_question_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_point uuid;
begin
  if not can_write_content((select school_id from questions where id = p_question_id)) then
    raise exception 'only a teacher of the question''s school may delete it'
      using errcode = 'insufficient_privilege';
  end if;

  -- The same lock reorder_questions takes, and taken before the delete: see
  -- there. A question that does not exist locks nothing and is refused below.
  perform 1 from points
    where id = (select point_id from questions where id = p_question_id)
      for update;

  delete from questions where id = p_question_id returning point_id into v_point;

  if v_point is null then
    raise exception 'question % not found', p_question_id;
  end if;

  perform reorder_questions(
    v_point,
    array(select id from questions where point_id = v_point order by position));
end;
$$;

create or replace function reorder_questions(p_point_id uuid, p_ids uuid[])
returns void
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
  v_given integer := coalesce(cardinality(p_ids), 0);
  v_base integer;
begin
  if not can_write_content((select school_id from points where id = p_point_id)) then
    raise exception 'only a teacher of the point''s school may order its questions'
      using errcode = 'insufficient_privilege';
  end if;

  -- The point's row is the one lock every write to its order takes, before
  -- anything is counted. Two orderings made from the same view cannot both
  -- compare equal and then interleave, and an insert waits too, since its
  -- foreign key needs a share of this row.
  --
  -- One row and not the questions themselves: locking those, two deletes in
  -- the same point each held the question it had just deleted and waited for
  -- the other's, and the database ended one of them as a deadlock.
  perform 1 from points where id = p_point_id for update;

  select count(*), coalesce(max(position), 0) into v_count, v_base
    from questions where point_id = p_point_id;

  -- Two clauses, and they are the whole test. As many ids as the point has
  -- questions, and that many of the point's questions among them: then every
  -- question is named once, and a repeated, null or foreign id has no room.
  if v_count <> v_given
     or (select count(*) from questions
          where point_id = p_point_id and id = any(p_ids)) <> v_given then
    raise exception
      'the questions of point % changed since they were loaded: nothing was reordered',
      p_point_id
      using errcode = 'QS001';
  end if;

  -- Above every position in use and above every position about to be
  -- written, so neither statement meets a row the other has not moved yet.
  v_base := greatest(v_base, v_given - 1);

  update questions q
     set position = (v_base + m.n)::integer
    from unnest(p_ids) with ordinality as m(id, n)
   where q.id = m.id;

  update questions q
     set position = (m.n - 1)::integer
    from unnest(p_ids) with ordinality as m(id, n)
   where q.id = m.id;
end;
$$;

create or replace function materialize_points(p_book_id uuid, p_first_point integer, p_last_point integer)
returns integer
language plpgsql
as $$
declare
  v_inserted integer;
  v_blocked_points integer;
  v_blocked_lessons integer;
begin
  if not can_write_content((select school_id from books where id = p_book_id)) then
    raise exception 'only a teacher of the book''s school may configure it';
  end if;

  if p_first_point is null or p_first_point < 1 then
    raise exception 'p_first_point must be at least 1, got %', p_first_point;
  end if;

  if p_last_point is null or p_last_point < p_first_point then
    raise exception
      'p_last_point must be at least p_first_point, got % and %',
      p_last_point, p_first_point;
  end if;

  if not exists (select 1 from books where id = p_book_id) then
    raise exception 'no such book: %', p_book_id;
  end if;

  -- Both checked before anything is written, so a refusal leaves the book
  -- exactly as it was.
  select count(*) into v_blocked_points
  from points p
  where p.book_id = p_book_id
    and (p.number < p_first_point or p.number > p_last_point)
    and (
      exists (select 1 from blocks b where b.point_id = p.id)
      or exists (select 1 from questions q where q.point_id = p.id)
      or exists (select 1 from vocabulary_items v where v.first_point_id = p.id)
    );

  select count(*) into v_blocked_lessons
  from lessons_content lc
  where lc.book_id = p_book_id
    and (lc.first_point < p_first_point or lc.last_point > p_last_point);

  if v_blocked_points > 0 or v_blocked_lessons > 0 then
    raise exception
      'cannot narrow book % to %..%: % point(s) outside carry content, % lesson(s) reach outside',
      p_book_id, p_first_point, p_last_point, v_blocked_points, v_blocked_lessons;
  end if;

  delete from points
  where book_id = p_book_id
    and (number < p_first_point or number > p_last_point);

  update books
  set first_point = p_first_point, last_point = p_last_point
  where id = p_book_id;

  insert into points (book_id, number)
  select p_book_id, n
  from generate_series(p_first_point, p_last_point) as n
  where not exists (
    select 1 from points p where p.book_id = p_book_id and p.number = n
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function materialize_lessons(p_student_id uuid, p_weeks integer default 4)
returns integer
language plpgsql
as $$
declare
  v_inserted integer;
begin
  if not (is_platform_admin()
          or is_school_member((select school_id from students where id = p_student_id),
                              '{admin,teacher}')) then
    raise exception 'only a teacher of the student''s school may materialize her lessons';
  end if;

  if p_weeks is null or p_weeks < 1 then
    raise exception 'p_weeks must be at least 1, got %', p_weeks;
  end if;

  -- The date series is built in each schedule's own zone, so "every Monday"
  -- means Monday where the student lives. Combining the local date with
  -- start_time and reading it "at time zone" produces the correct UTC instant,
  -- including across a DST change in zones that still have one.
  with candidate as (
    select
      ((day::date + s.start_time) at time zone s.timezone) as scheduled_at,
      s.duration_minutes
    from lesson_schedules s
    cross join lateral generate_series(
      (now() at time zone s.timezone)::date,
      (now() at time zone s.timezone)::date + (p_weeks * 7),
      interval '1 day'
    ) as day
    where s.student_id = p_student_id
      and s.is_active
      and extract(dow from day) = s.weekday
  ),
  -- Two schedules in different zones can land on the same instant, and not
  -- exists only sees rows already committed, not the ones this statement is
  -- about to insert. Without this the statement would trip its own unique index.
  occurrence as (
    select distinct on (scheduled_at) scheduled_at, duration_minutes
    from candidate
    order by scheduled_at, duration_minutes
  )
  insert into lessons (student_id, scheduled_at, duration_minutes)
  select p_student_id, o.scheduled_at, o.duration_minutes
  from occurrence o
  where o.scheduled_at >= now()
    and not exists (
      select 1
      from lessons l
      where l.student_id = p_student_id
        and l.scheduled_at = o.scheduled_at
    );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- The global role goes ----------------------------------------------------------

drop function is_teacher();
alter table profiles drop column role;
drop type user_role;
