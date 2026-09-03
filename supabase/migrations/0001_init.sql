-- Initial schema for the Chelsea St learning platform.
-- Every table has RLS enabled: students reach only their own rows, teachers reach all.

create extension if not exists "pgcrypto";

create type user_role as enum ('student', 'teacher');
create type lesson_status as enum ('scheduled', 'done', 'cancelled', 'no_show');
create type attempt_verdict as enum ('pending', 'correct', 'incorrect');

-- One row per authenticated person.
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  role user_role not null default 'student',
  full_name text not null,
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now()
);

-- Curriculum map. Targets describe what the stage teaches, not any published text.
create table stages (
  id uuid primary key default gen_random_uuid(),
  position integer not null unique,
  name text not null,
  grammar_targets text[] not null default '{}',
  vocabulary_targets text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references stages on delete cascade,
  position integer not null,
  prompt text not null,
  expected_answer text not null,
  prompt_audio_path text,
  image_path text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (stage_id, position)
);

create table students (
  id uuid primary key references profiles on delete cascade,
  current_stage_id uuid references stages on delete set null,
  meet_url text,
  started_on date,
  is_active boolean not null default true
);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students on delete cascade,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 50 check (duration_minutes > 0),
  meet_url text,
  status lesson_status not null default 'scheduled',
  teacher_note text,
  created_at timestamptz not null default now()
);
create index lessons_student_scheduled_idx on lessons (student_id, scheduled_at desc);

-- The daily challenge for one student on one day.
create table assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students on delete cascade,
  due_on date not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (student_id, due_on)
);

create table assignment_items (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments on delete cascade,
  question_id uuid not null references questions on delete restrict,
  position integer not null,
  unique (assignment_id, position)
);

-- One spoken answer. Audio lives in Storage; only the path is stored here.
create table attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students on delete cascade,
  question_id uuid not null references questions on delete restrict,
  assignment_item_id uuid references assignment_items on delete set null,
  audio_path text not null,
  transcript text,
  verdict attempt_verdict not null default 'pending',
  teacher_note text,
  reviewed_at timestamptz,
  reviewed_by uuid references profiles on delete set null,
  created_at timestamptz not null default now()
);
create index attempts_student_created_idx on attempts (student_id, created_at desc);
create index attempts_pending_idx on attempts (verdict) where verdict = 'pending';

-- Simplified SM-2 state per student and question.
create table review_schedule (
  student_id uuid not null references students on delete cascade,
  question_id uuid not null references questions on delete cascade,
  ease numeric(4, 2) not null default 2.5 check (ease >= 1.3),
  interval_days integer not null default 0 check (interval_days >= 0),
  repetitions integer not null default 0 check (repetitions >= 0),
  due_on date not null default current_date,
  primary key (student_id, question_id)
);
create index review_schedule_due_idx on review_schedule (student_id, due_on);

-- Teacher check used by every policy below. Security definer avoids recursive RLS on profiles.
create function is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'teacher'
  );
$$;

alter table profiles enable row level security;
alter table stages enable row level security;
alter table questions enable row level security;
alter table students enable row level security;
alter table lessons enable row level security;
alter table assignments enable row level security;
alter table assignment_items enable row level security;
alter table attempts enable row level security;
alter table review_schedule enable row level security;

create policy profiles_select_self_or_teacher on profiles
  for select using (id = auth.uid() or is_teacher());
create policy profiles_update_self on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Curriculum is readable by any signed-in person; only teachers write it.
create policy stages_select_authenticated on stages
  for select to authenticated using (true);
create policy stages_write_teacher on stages
  for all using (is_teacher()) with check (is_teacher());

create policy questions_select_published on questions
  for select to authenticated using (is_published or is_teacher());
create policy questions_write_teacher on questions
  for all using (is_teacher()) with check (is_teacher());

create policy students_select_self_or_teacher on students
  for select using (id = auth.uid() or is_teacher());
create policy students_write_teacher on students
  for all using (is_teacher()) with check (is_teacher());

create policy lessons_select_own_or_teacher on lessons
  for select using (student_id = auth.uid() or is_teacher());
create policy lessons_write_teacher on lessons
  for all using (is_teacher()) with check (is_teacher());

create policy assignments_select_own_or_teacher on assignments
  for select using (student_id = auth.uid() or is_teacher());
create policy assignments_update_own on assignments
  for update using (student_id = auth.uid()) with check (student_id = auth.uid());
create policy assignments_write_teacher on assignments
  for all using (is_teacher()) with check (is_teacher());

create policy assignment_items_select_own_or_teacher on assignment_items
  for select using (
    is_teacher() or exists (
      select 1 from assignments a
      where a.id = assignment_items.assignment_id and a.student_id = auth.uid()
    )
  );
create policy assignment_items_write_teacher on assignment_items
  for all using (is_teacher()) with check (is_teacher());

-- A student may record an answer but never grade it.
create policy attempts_select_own_or_teacher on attempts
  for select using (student_id = auth.uid() or is_teacher());
create policy attempts_insert_own on attempts
  for insert to authenticated with check (student_id = auth.uid() and verdict = 'pending');
create policy attempts_update_teacher on attempts
  for update using (is_teacher()) with check (is_teacher());

create policy review_schedule_select_own_or_teacher on review_schedule
  for select using (student_id = auth.uid() or is_teacher());
create policy review_schedule_write_teacher on review_schedule
  for all using (is_teacher()) with check (is_teacher());

-- Explicit privileges.
-- The project is created with "automatically expose new tables" turned off, so
-- any table added later stays invisible to the API until it is granted here on
-- purpose. RLS still decides which rows each person sees; these grants only
-- decide which tables the API may reach at all.
grant usage on schema public to authenticated;

grant select, update on profiles to authenticated;
grant select, insert, update, delete on stages to authenticated;
grant select, insert, update, delete on questions to authenticated;
grant select, insert, update, delete on students to authenticated;
grant select, insert, update, delete on lessons to authenticated;
grant select, insert, update, delete on assignments to authenticated;
grant select, insert, update, delete on assignment_items to authenticated;
grant select, insert, update on attempts to authenticated;
grant select, insert, update, delete on review_schedule to authenticated;

-- Signed-out visitors reach nothing.
revoke all on all tables in schema public from anon;
