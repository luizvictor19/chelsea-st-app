-- Recurring lesson schedules, and the function that turns them into lessons.
--
-- A schedule is the rule ("Mondays at 19:00"); a lesson is one occurrence of it.
-- Keeping them apart means a cancelled lesson does not erase the rule, and
-- moving the rule does not rewrite history.

create table lesson_schedules (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday, matching extract(dow)
  start_time time not null,
  -- The wall-clock time the student agreed to, in the zone they said it in.
  -- start_time alone is meaningless without it.
  timezone text not null default 'America/Sao_Paulo',
  duration_minutes integer not null default 50 check (duration_minutes > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (student_id, weekday, start_time)
);
create index lesson_schedules_active_idx on lesson_schedules (student_id) where is_active;

-- One student cannot hold two live lessons at the same instant.
--
-- Partial on purpose. A cancelled lesson keeps its row as a record of what was
-- agreed, so an unqualified unique index would make that dead row block the
-- slot forever and break rescheduling into a time that was cancelled earlier.
create unique index lessons_student_slot_idx
  on lessons (student_id, scheduled_at)
  where status = 'scheduled';

-- Inserts the occurrences of a student's active schedules that do not exist yet,
-- from now up to p_weeks ahead, and returns how many rows it created.
--
-- Idempotent: the not exists guard means a second run over the same horizon
-- inserts nothing and returns 0. The guard is what does the work; the unique
-- index above is the net under it for when this becomes a scheduled job and two
-- runs can overlap.
--
-- Note the guard deliberately ignores status: a cancelled lesson still counts as
-- existing, so re-running this never resurrects a lesson the teacher called off.
-- The index is looser than the guard on purpose, because a teacher rescheduling
-- by hand into a cancelled slot is legitimate and this function is not.
--
-- Security invoker on purpose. The insert into lessons is checked by
-- lessons_write_teacher, so RLS stays the real defence; the is_teacher() guard
-- below only turns an RLS violation into a message worth reading. When this
-- becomes a scheduled job it will run without auth.uid() and that guard is the
-- line to revisit.
create function materialize_lessons(p_student_id uuid, p_weeks integer default 4)
returns integer
language plpgsql
as $$
declare
  v_inserted integer;
begin
  if not is_teacher() then
    raise exception 'only a teacher may materialize lessons';
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

-- lessons.meet_url is left null here on purpose. The room is fixed per student
-- in students.meet_url, which the dashboard reads; copying it into every lesson
-- would freeze a stale link into rows created weeks in advance. The column
-- stays available as a per-lesson override.

alter table lesson_schedules enable row level security;

create policy lesson_schedules_select_own_or_teacher on lesson_schedules
  for select using (student_id = auth.uid() or is_teacher());
create policy lesson_schedules_write_teacher on lesson_schedules
  for all using (is_teacher()) with check (is_teacher());

-- Explicit privileges, because the project does not expose new tables
-- automatically. RLS still decides the rows; this decides whether the API can
-- see the table at all.
grant select, insert, update, delete on lesson_schedules to authenticated;
revoke all on lesson_schedules from anon;

revoke all on function materialize_lessons(uuid, integer) from public;
grant execute on function materialize_lessons(uuid, integer) to authenticated;
