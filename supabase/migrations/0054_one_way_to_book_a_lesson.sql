-- One way to book a lesson (issue #295, on the booking of #276).
--
-- The fixed weekly agenda (0003: lesson_schedules, materialize_lessons, a
-- Meet per student) retires, and the lessons it wrote move to the booking
-- agenda of 0052: each one gets the one active teacher of its organization,
-- teacher_id becomes not null, and a lesson is born only through book_lesson
-- and changes status only through cancel_lesson. The moved lessons keep their
-- status, time, length, "Parei aqui" and note, and debited nothing
-- (credits_debited stays 0, no entry is written): cancelling one gives
-- nothing back because nothing was paid. Spec: docs/spec-f1.md.
--
-- Measured through the MCP on 2026-11-13 before writing: migrations up to
-- 0052 applied; lessons has 11 rows, all of chelsea-st, none with a teacher:
-- 10 scheduled and 1 cancelled, 7 ahead of now (6 scheduled, 1 cancelled,
-- from 2026-11-18 to 2026-12-23), 10 of 45 min and 1 of 50, 1 with
-- stopped_at_point_id, 0 with teacher_note, 0 with credits_debited > 0;
-- lessons.meet_url set on 0 rows and students.meet_url on 1; lesson_schedules
-- has 1 row, active; credit_entries has 0 rows; teachers has 0 rows in every
-- organization. So on that day the guard below refuses: Luiz creates his
-- teacher profile on /teacher/agenda (Meet, calendar e-mail, active) before
-- the push, and the test account TEACHER keeps none active (the plan of #295).
--
-- Who teaches the moved lessons (Q1): the only active row of teachers of the
-- lesson's organization, at the moment of the push. With none or more than
-- one, the migration stops whole, naming each organization with its count,
-- and nothing changes. No id enters this public repository, and the rule
-- holds for any copy (a local stack, scripts/verify-rls.sql).


-- The guard, and the lessons get their teacher -------------------------------------------
--
-- The guard comes first, so a refusal leaves every row as it was. Counted
-- over the organizations that hold a lesson without a teacher: a booked
-- lesson already has one. One statement with the update, under a share lock
-- on teachers taken before the count: nobody turns a second teacher active
-- between the count and the update, whether or not the push wraps the file
-- in one transaction.
--
-- Past, cancelled and future alike: every lesson is tied to the teacher of
-- its organization. Run as postgres, the owner of lessons, so
-- lessons_booked_through_functions lets it through; the exclusion
-- constraints of 0052 check every moved lesson, and no two crossed on the
-- day measured.
do $$
declare
  v_counts text;
begin
  lock table public.teachers in share mode;

  select string_agg(format('%s: %s active teachers, %s lessons',
                           o.slug, coalesce(t.active, 0), l.lessons),
                    '; ' order by o.slug)
    into v_counts
    from (select organization_id, count(*) as lessons
            from public.lessons
           where teacher_id is null
           group by organization_id) l
    join public.organizations o on o.id = l.organization_id
    left join (select organization_id, count(*) as active
                 from public.teachers
                where is_active
                group by organization_id) t on t.organization_id = l.organization_id
   where coalesce(t.active, 0) <> 1;

  if v_counts is not null then
    raise exception 'lessons_move_to_one_teacher: every organization with lessons of the fixed agenda needs exactly one active teacher before they move (%)', v_counts
      using errcode = 'check_violation', constraint = 'lessons_move_to_one_teacher';
  end if;

  update public.lessons l
     set teacher_id = t.id
    from public.teachers t
   where l.teacher_id is null
     and t.organization_id = l.organization_id
     and t.is_active;
end;
$$;

alter table public.lessons alter column teacher_id set not null;

comment on column public.lessons.teacher_id is
  'The teacher of the lesson (#276), of the lesson''s organization. Every lesson has one since 0054 (#295), which gave the lessons of the fixed agenda the one active teacher of their organization.';


-- The fixed agenda goes (Q2, Q3) ---------------------------------------------------------
--
-- materialize_lessons first: it reads lesson_schedules. The table takes its
-- policies, its index and its triggers (organization, time zone) with it.
-- a_time_zone_is_known stays: profiles and teacher_availability call it.
drop function public.materialize_lessons(uuid, integer);
drop table public.lesson_schedules;

-- The room is the teacher's (teachers.meet_url, 0052): the student's and the
-- lesson's own go. On 2026-11-13 one student held a room and no lesson did;
-- Luiz pastes the room he wants on his profile.
alter table public.students drop column meet_url;
alter table public.lessons drop column meet_url;

-- Covered by lessons_student_no_overlap (0052), which refuses the same start
-- and any crossing.
drop index public.lessons_student_slot_idx;


-- What reads the lessons now that every one has a teacher --------------------------------
--
-- my_lessons read coalesce(l.meet_url, t.meet_url, s.meet_url): a function
-- in sql keeps no dependency on the columns it names, so the drop above
-- passes and the function would fail when called. Now the teacher's room,
-- and the teacher's name, of every lesson. Same signature, so the grant of
-- 0052 stays.
create or replace function public.my_lessons()
returns table (
  lesson_id uuid,
  scheduled_at timestamptz,
  duration_minutes integer,
  teacher_name text,
  meet_url text,
  credits_debited integer,
  credits_refunded boolean,
  refund_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.scheduled_at, l.duration_minutes, p.full_name, t.meet_url,
         l.credits_debited, l.credits_refunded,
         case when l.credits_debited > 0 and not l.credits_refunded
              then l.scheduled_at - r.refund_until_before end
    from public.lessons l
    join public.teachers t on t.id = l.teacher_id
    join public.profiles p on p.id = t.user_id
    cross join public.lesson_rules() r
   where l.student_id = (select auth.uid())
     and l.status = 'scheduled'
     and l.scheduled_at + make_interval(mins => l.duration_minutes) > now()
   order by l.scheduled_at;
$$;

comment on function public.my_lessons() is
  'The caller''s scheduled lessons not finished yet, soonest first, with the teacher''s name, her Meet, the debit and until when her cancel gives it back (null: nothing to give back).';

-- lesson_open_slots without the branch for a lesson without a teacher, which
-- no lesson is any more: what takes a slot is a lesson of hers in any of her
-- organizations, a lesson of the student's, and her time off.
create or replace function public.lesson_open_slots(
  p_teacher uuid, p_student uuid, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz)
language sql
stable
set search_path = ''
as $$
  with r as (
    select * from public.lesson_rules()
  ),
  t as (
    select t.id, t.organization_id, t.user_id
      from public.teachers t
     where t.id = p_teacher and t.is_active
  ),
  span as (
    select greatest(p_from, now() + r.book_closes_before) as lo,
           least(p_to, now() + r.book_opens_ahead) as hi
      from r
  ),
  candidate as (
    select (((span.lo at time zone a.timezone)::date - 1 + g.i)
              + a.start_time + make_interval(mins => n.k * r.slot_minutes))
             at time zone a.timezone as starts_at
      from t
      join public.teacher_availability a on a.teacher_id = t.id
      cross join r
      cross join span
      cross join lateral generate_series(
        0, ((span.hi at time zone a.timezone)::date - (span.lo at time zone a.timezone)::date) + 2) g (i)
      cross join lateral generate_series(
        0, floor((extract(epoch from (a.end_time - a.start_time)) / 60 - r.lesson_minutes)
                 / r.slot_minutes)::integer) n (k)
     where span.lo <= span.hi
       and extract(dow from ((span.lo at time zone a.timezone)::date - 1 + g.i)) = a.weekday
  ),
  -- What takes a slot, gathered once by two indexed lookups and her time
  -- off, then held against every candidate. Only the lessons near the span:
  -- none lasts a day.
  busy as (
    select tstzrange(l.scheduled_at, l.scheduled_at + make_interval(mins => l.duration_minutes)) as during
      from t
      join public.teachers o on o.user_id = t.user_id
      join public.lessons l on l.teacher_id = o.id
      cross join span
     where l.status = 'scheduled'
       and l.scheduled_at between span.lo - interval '1 day' and span.hi + interval '1 day'
    union all
    select tstzrange(l.scheduled_at, l.scheduled_at + make_interval(mins => l.duration_minutes))
      from public.lessons l
      cross join span
     where l.student_id = p_student
       and l.status = 'scheduled'
       and l.scheduled_at between span.lo - interval '1 day' and span.hi + interval '1 day'
    union all
    select tstzrange(o.starts_at, o.ends_at)
      from t
      join public.teacher_time_off o on o.teacher_id = t.id
  )
  select distinct c.starts_at
    from candidate c
    cross join r
    cross join span
   where c.starts_at between span.lo and span.hi
     and not exists (
       select 1 from busy b
        where b.during && tstzrange(c.starts_at, c.starts_at + make_interval(mins => r.lesson_minutes)))
   order by c.starts_at;
$$;

comment on function public.lesson_open_slots(uuid, uuid, timestamptz, timestamptz) is
  'The starts a teacher has free for a student between two instants (both included), by lesson_rules: on the grid of her windows, in her zone, inside the booking horizon, outside her time off, crossing no scheduled lesson of hers or of the student''s. Called by bookable_slots and book_lesson only.';

-- cancel_lesson without the branch for a lesson without a teacher: the
-- student cancels any lesson of hers until it starts (a moved one gives
-- nothing back, it debited nothing), and the lesson's teacher, the
-- organization's admin or the platform admin until its planned end.
create or replace function public.cancel_lesson(p_lesson uuid, out refunded_credits integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_lesson public.lessons;
  v_rules record;
  v_refund boolean;
begin
  select * into v_rules from public.lesson_rules();
  select * into v_lesson from public.lessons l where l.id = p_lesson for update;

  if v_me is not null and v_lesson.student_id = v_me then
    if now() >= v_lesson.scheduled_at then
      raise exception 'lesson_cancel_before_start: a student cancels her lesson before it starts'
        using errcode = 'check_violation', constraint = 'lesson_cancel_before_start';
    end if;
    v_refund := now() <= v_lesson.scheduled_at - v_rules.refund_until_before;
  elsif v_me is not null and v_lesson.id is not null
        and (public.is_platform_admin()
             or public.is_organization_member(v_lesson.organization_id, '{admin}')
             or exists (select 1 from public.teachers t
                         where t.id = v_lesson.teacher_id and t.user_id = v_me)) then
    if now() >= v_lesson.scheduled_at + make_interval(mins => v_lesson.duration_minutes) then
      raise exception 'lesson_cancel_before_end: a lesson is cancelled before its planned end'
        using errcode = 'check_violation', constraint = 'lesson_cancel_before_end';
    end if;
    v_refund := true;
  else
    -- A lesson she may not cancel reads as one that does not exist.
    raise exception 'lesson_cancel_allowed: no such lesson of yours to cancel'
      using errcode = 'insufficient_privilege', constraint = 'lesson_cancel_allowed';
  end if;

  if v_lesson.status <> 'scheduled' then
    raise exception 'lesson_cancel_scheduled: the lesson is not scheduled any more'
      using errcode = 'check_violation', constraint = 'lesson_cancel_scheduled';
  end if;

  refunded_credits := 0;
  if v_refund and v_lesson.credits_debited > 0 and not v_lesson.credits_refunded then
    refunded_credits := public.credit_refund(v_lesson.student_id, 'lesson:' || v_lesson.id::text);
  end if;

  update public.lessons l
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = v_me,
         credits_refunded = l.credits_refunded or refunded_credits > 0
   where l.id = v_lesson.id;
end;
$$;

comment on function public.cancel_lesson(uuid) is
  'Cancels a scheduled lesson and returns the credits given back. Its student, until it starts, with her debit back up to lesson_rules().refund_until_before the start; the lesson''s teacher, the organization''s admin or the platform admin, until its planned end, always with the debit back. A lesson that debited nothing gives nothing back. Refuses by name: lesson_cancel_allowed, lesson_cancel_before_start, lesson_cancel_before_end, lesson_cancel_scheduled.';


-- The direct writes on lessons close (Q3) ------------------------------------------------
--
-- A lesson is born only through book_lesson and changes status only through
-- cancel_lesson, both security definer functions of postgres. Through the
-- API, whoever teaches in the lesson's organization (teaches_in, 0042) or the
-- platform admin writes "Parei aqui" and the note, and nothing else: no
-- insert, no delete, no other column. lessons_read (0029) is untouched: the
-- student reads her own, whoever teaches there reads all.
-- lessons_booked_through_functions (0052) stays, as a second line.
drop policy lessons_write on public.lessons;

create policy lessons_update_notes on public.lessons
  for update to authenticated
  using ((select public.is_platform_admin()) or public.teaches_in(organization_id))
  with check ((select public.is_platform_admin()) or public.teaches_in(organization_id));

revoke insert, update, delete on public.lessons from authenticated;
grant update (stopped_at_point_id, teacher_note) on public.lessons to authenticated;
