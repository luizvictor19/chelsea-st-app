-- A lesson is booked and paid (issue #276, on the ledger of #273).
--
-- A teacher publishes her free hours; a student books one of them and pays
-- for it in credits, in the same transaction that writes the lesson. The new
-- agenda lives beside the fixed one (0003) until #295 retires it and moves
-- today's lessons here; the calendar invite by e-mail is #294; the Founder
-- seal, which changes the cost, is #292 and changes credit_price alone.
-- Spec: docs/spec-f1.md, "Reserva de aula (#276)".
--
-- Measured through the MCP on 2026-11-13 before writing: migrations up to
-- 0051 applied, 0051 the highest on every branch; three organizations,
-- chelsea-st (brand chelsea-st, with a teacher), grifoai and empresa-teste
-- (brand grifoai, without); in chelsea-st 1 admin, 1 teacher and 2 students;
-- lessons has 11 rows (10 scheduled, 1 cancelled), all of chelsea-st, 10 of
-- 45 min and 1 of 50, 6 scheduled ahead of now, none with meet_url; no two
-- scheduled lessons of one organization overlap, and no two of one student
-- (so both exclusions below are born valid, the one per teacher on no row at
-- all, since no lesson has a teacher yet); lessons has no teacher column and
-- the triggers lessons_organization and lessons_stop_in_organization; 0 rows
-- in credit_costs and credit_entries; btree_gist 1.7 is available and not
-- installed. The only rows touched are none: every new column of lessons has
-- a default or is null.
--
-- Why a range of timestamp and not of timestamptz: timestamptz + interval is
-- stable (timestamptz_pl_interval, measured in pg_proc on 2026-11-12), so it
-- cannot enter an exclusion constraint. timezone(text, timestamptz),
-- timestamp + interval and tsrange are immutable: the range is taken on the
-- lesson's instant read in UTC.
--
-- Who writes (Q5): the booking and the cancel are security definer functions
-- of postgres that authenticated executes, always for auth.uid(), with the
-- cost read from the ledger's own price function. credit_debit and
-- credit_refund stay executable by nobody (0050): nobody debits a number
-- chosen in the browser. A refusal raised here names its rule twice: in the
-- error, for scripts/verify-rls.sql, and at the start of the message, because
-- the API passes the message on and not the constraint (the convention of
-- 0050).

-- The exclusion constraints need the btree operator classes for uuid in a
-- GiST index. In extensions, as every extension of the project, so the rule
-- of 0047 about the functions of public is untouched. An extension may give
-- its functions to postgres alone: checked after the push (docs/context.md).
create extension if not exists btree_gist with schema extensions;


-- The rules of a booking, in one place --------------------------------------------
--
-- Every number of the booking (Q3, Luiz 12/11, the 24 h of the same evening
-- withdrawn): a lesson of 50 min, a slot every 60 min inside a window, the
-- booking closing 12 h before the start and opening 8 weeks ahead, and the
-- student's cancel giving the credits back up to 1 h before the start. Read
-- by every function below and by the screen; changed by a migration.
create function public.lesson_rules(
  out lesson_minutes integer,
  out slot_minutes integer,
  out book_closes_before interval,
  out book_opens_ahead interval,
  out refund_until_before interval)
language sql
immutable
set search_path = ''
as $$
  select 50, 60, interval '12 hours', interval '8 weeks', interval '1 hour';
$$;

comment on function public.lesson_rules() is
  'The numbers of a booking (#276): the minutes of a lesson, a slot every so many minutes inside a window, how long before the start the booking closes, how far ahead it opens, and until how long before the start a student''s cancel gives the credits back. One place; changed by a migration.';


-- The teacher -------------------------------------------------------------------------
--
-- One row per person and organization she teaches in (Q1): her Meet link,
-- the e-mail her calendar lives under (it may not be her login) and whether
-- she takes bookings. Tied to her membership, as students is
-- (students_membership_fkey): leaving the organization with this row is
-- refused, and a lesson in the history keeps the row. A second teacher is a
-- teacher's invite and this row, no code. The student never reads the table
-- (it holds the calendar e-mail): her screen reads the name and the Meet
-- through the functions below.
create table public.teachers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete restrict,
  user_id uuid not null references public.profiles on delete restrict,
  -- The role she teaches in: a teacher, or an admin where the organization
  -- has a teacher (teaches_in, 0042).
  member_role public.organization_role not null
    constraint teachers_member_teaches check (member_role in ('teacher', 'admin')),
  meet_url text
    constraint teachers_meet_url_https check (meet_url ~ '^https://[^[:space:]]+$'),
  calendar_email text
    constraint teachers_calendar_email_shape
      check (calendar_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teachers_one_per_organization unique (organization_id, user_id),
  -- The target of the composite keys below: a row that points at a teacher
  -- points at one of its own organization.
  constraint teachers_organization_id_id_key unique (organization_id, id),
  constraint teachers_membership_fkey foreign key (organization_id, user_id, member_role)
    references public.organization_members (organization_id, user_id, role),
  -- She takes bookings only with somewhere to meet and somewhere to invite.
  constraint teachers_active_needs_contact
    check (not is_active or (meet_url is not null and calendar_email is not null))
);

comment on table public.teachers is
  'A person who teaches in an organization, as the booking sees her (#276): her Meet link, her calendar e-mail and whether she takes bookings. Tied to her membership. Read by herself, the organization''s admin and the platform admin; never by a student, who reads the name and the Meet through bookable_teachers and my_lessons.';

alter table public.teachers enable row level security;

-- She writes her own row only where she teaches; the platform admin any.
-- Only the platform admin removes one: a teacher stops taking bookings
-- instead, and a row with lessons stays (lessons_teacher_fkey).
create policy teachers_read on public.teachers
  for select to authenticated
  using (user_id = (select auth.uid())
         or (select public.is_platform_admin())
         or public.is_organization_member(organization_id, '{admin}'));
create policy teachers_insert on public.teachers
  for insert to authenticated
  with check ((user_id = (select auth.uid()) and public.teaches_in(organization_id))
              or (select public.is_platform_admin()));
create policy teachers_update on public.teachers
  for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_platform_admin()))
  with check ((user_id = (select auth.uid()) and public.teaches_in(organization_id))
              or (select public.is_platform_admin()));
create policy teachers_delete on public.teachers
  for delete to authenticated
  using ((select public.is_platform_admin()));

grant select, insert, update, delete on public.teachers to authenticated;


-- Her free hours (Q2) ---------------------------------------------------------------
--
-- A weekly window in her zone (a weekday, a start and an end on that day),
-- and periods off, from one instant to another. The bookable slots are not
-- stored: lesson_open_slots computes them from these and the lessons already
-- booked, so nothing is generated and nothing goes stale.
create table public.teacher_availability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  teacher_id uuid not null,
  -- 0 is Sunday, as lesson_schedules.weekday.
  weekday smallint not null
    constraint teacher_availability_weekday_range check (weekday between 0 and 6),
  start_time time not null,
  -- 24:00 closes the day; a window never crosses midnight.
  end_time time not null,
  timezone text not null,
  created_at timestamptz not null default now(),
  constraint teacher_availability_teacher_fkey foreign key (organization_id, teacher_id)
    references public.teachers (organization_id, id) on delete cascade,
  constraint teacher_availability_ends_after_start check (end_time > start_time)
);

create index teacher_availability_by_teacher on public.teacher_availability (teacher_id);

comment on table public.teacher_availability is
  'A weekly window a teacher takes bookings in, in her zone (#276). The slots inside it are computed, never stored (lesson_open_slots).';

-- The zone, as profiles and lesson_schedules (0048): a name both Postgres
-- and the screen read, refused under teacher_availability_timezone_known.
create trigger teacher_availability_timezone_known
  before insert or update of timezone on public.teacher_availability
  for each row execute function public.a_time_zone_is_known();

create table public.teacher_time_off (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  teacher_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint teacher_time_off_teacher_fkey foreign key (organization_id, teacher_id)
    references public.teachers (organization_id, id) on delete cascade,
  constraint teacher_time_off_ends_after_start check (ends_at > starts_at)
);

create index teacher_time_off_by_teacher on public.teacher_time_off (teacher_id, starts_at);

comment on table public.teacher_time_off is
  'A period a teacher takes no booking (holidays, a day off), from one instant to another (#276). A lesson already booked in it stays.';

alter table public.teacher_availability enable row level security;
alter table public.teacher_time_off enable row level security;

-- Her own rows, through her row of teachers (which she reads); the admin of
-- the organization reads them; the platform admin reads and writes them.
create policy teacher_availability_read on public.teacher_availability
  for select to authenticated
  using (exists (select 1 from public.teachers t
                  where t.id = teacher_id and t.user_id = (select auth.uid()))
         or (select public.is_platform_admin())
         or public.is_organization_member(organization_id, '{admin}'));
create policy teacher_availability_write on public.teacher_availability
  for all to authenticated
  using (exists (select 1 from public.teachers t
                  where t.id = teacher_id and t.user_id = (select auth.uid()))
         or (select public.is_platform_admin()))
  with check (exists (select 1 from public.teachers t
                       where t.id = teacher_id and t.user_id = (select auth.uid()))
              or (select public.is_platform_admin()));

create policy teacher_time_off_read on public.teacher_time_off
  for select to authenticated
  using (exists (select 1 from public.teachers t
                  where t.id = teacher_id and t.user_id = (select auth.uid()))
         or (select public.is_platform_admin())
         or public.is_organization_member(organization_id, '{admin}'));
create policy teacher_time_off_write on public.teacher_time_off
  for all to authenticated
  using (exists (select 1 from public.teachers t
                  where t.id = teacher_id and t.user_id = (select auth.uid()))
         or (select public.is_platform_admin()))
  with check (exists (select 1 from public.teachers t
                       where t.id = teacher_id and t.user_id = (select auth.uid()))
              or (select public.is_platform_admin()));

grant select, insert, update, delete on public.teacher_availability to authenticated;
grant select, insert, update, delete on public.teacher_time_off to authenticated;


-- The lesson knows its teacher and what it cost --------------------------------------
--
-- teacher_id is null on a lesson of the fixed agenda until #295 (Q6): it
-- moves them and makes the column not null. The ledger keeps the entries
-- (reference 'lesson:<id>'); these columns are for the screen and for the
-- cancel to know whether there is anything to give back. A lesson that was
-- not paid (every lesson before this migration) debited 0.
alter table public.lessons
  add column teacher_id uuid,
  add column credits_debited integer not null default 0
    constraint lessons_credits_debited_not_negative check (credits_debited >= 0),
  add column credits_refunded boolean not null default false,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles on delete set null,
  -- A lesson's teacher is of the lesson's organization, never of another.
  add constraint lessons_teacher_fkey foreign key (organization_id, teacher_id)
    references public.teachers (organization_id, id) on delete restrict,
  add constraint lessons_refund_needs_debit check (not credits_refunded or credits_debited > 0),
  add constraint lessons_cancelled_is_cancelled check (cancelled_at is null or status = 'cancelled');

comment on column public.lessons.teacher_id is
  'The teacher of a booked lesson (#276), of the lesson''s organization. Null on a lesson of the fixed agenda (0003) until #295.';
comment on column public.lessons.credits_debited is
  'What the booking debited from the student, as the ledger wrote it (reference lesson:<id>). 0 on a lesson nobody paid for.';
comment on column public.lessons.credits_refunded is
  'Whether the cancel gave the debit back (credit_refund, reference lesson:<id>).';

create index lessons_by_teacher on public.lessons (teacher_id, scheduled_at) where teacher_id is not null;

-- Q4: two scheduled lessons of one teacher, or of one student, that cross,
-- even by a minute, are refused by the database, whatever wrote them. A
-- lesson without a teacher is held by the student's alone (and by
-- lesson_open_slots, which counts it as taking every teacher of its
-- organization).
alter table public.lessons
  add constraint lessons_teacher_no_overlap exclude using gist (
    teacher_id with =,
    tsrange(scheduled_at at time zone 'UTC',
            (scheduled_at at time zone 'UTC') + make_interval(mins => duration_minutes)) with &&)
    where (status = 'scheduled'),
  add constraint lessons_student_no_overlap exclude using gist (
    student_id with =,
    tsrange(scheduled_at at time zone 'UTC',
            (scheduled_at at time zone 'UTC') + make_interval(mins => duration_minutes)) with &&)
    where (status = 'scheduled');


-- A booked lesson changes only through the functions (Q6) ---------------------------
--
-- lessons_write (0042) lets whoever teaches write lessons, which the fixed
-- agenda still needs until #295. So a trigger, and not a policy, refuses to
-- anyone but the owner of the table (the security definer functions below,
-- and postgres): a lesson inserted with a teacher or a debit; on a lesson
-- with a teacher, a change of its status, time, length, student, teacher,
-- debit, refund or cancel; the debit, the refund or the cancel of any
-- lesson; and the delete of a lesson with a teacher. "Parei aqui" and the
-- note still pass. #295 closes the rest with column grants.
create function public.lessons_booked_through_functions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = (select r.rolname from pg_catalog.pg_class c
                       join pg_catalog.pg_roles r on r.oid = c.relowner
                      where c.oid = tg_relid) then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.teacher_id is not null or new.credits_debited <> 0 or new.credits_refunded
       or new.cancelled_at is not null or new.cancelled_by is not null then
      raise exception 'lessons_booked_through_functions: a lesson with a teacher or a debit is booked through book_lesson'
        using errcode = 'insufficient_privilege', constraint = 'lessons_booked_through_functions',
              schema = tg_table_schema, table = tg_table_name;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.teacher_id is not null then
      raise exception 'lessons_booked_through_functions: a booked lesson is cancelled through cancel_lesson, never removed'
        using errcode = 'insufficient_privilege', constraint = 'lessons_booked_through_functions',
              schema = tg_table_schema, table = tg_table_name;
    end if;
    return old;
  end if;

  if (new.credits_debited, new.credits_refunded, new.cancelled_at, new.cancelled_by)
       is distinct from (old.credits_debited, old.credits_refunded, old.cancelled_at, old.cancelled_by)
     or ((old.teacher_id is not null or new.teacher_id is not null)
         and (new.status, new.scheduled_at, new.duration_minutes, new.student_id, new.teacher_id)
               is distinct from (old.status, old.scheduled_at, old.duration_minutes, old.student_id, old.teacher_id)) then
    raise exception 'lessons_booked_through_functions: a booked lesson changes through book_lesson and cancel_lesson'
      using errcode = 'insufficient_privilege', constraint = 'lessons_booked_through_functions',
            schema = tg_table_schema, table = tg_table_name;
  end if;
  return new;
end;
$$;

comment on function public.lessons_booked_through_functions() is
  'Refuses (42501) to anyone but the owner of lessons: a lesson inserted with a teacher or a debit, a change of the status, time, length, student or teacher of a booked lesson, a change of any debit, refund or cancel, and the delete of a booked lesson (#276). Executed by nobody: a trigger.';

create trigger lessons_booked_through_functions
  before insert or update or delete on public.lessons
  for each row execute function public.lessons_booked_through_functions();


-- The pieces the functions share ------------------------------------------------------
--
-- Executed by nobody: called only by the security definer functions below,
-- all owned by postgres (0047, a function is born closed).

-- The organization the caller books in: she is an active student of an
-- organization with a teacher, and the teacher (when one is named) is of
-- that same organization and takes bookings. Refused by name otherwise.
create function public.lesson_booker_organization(p_teacher uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_org uuid;
  v_has_teacher boolean;
  v_teacher record;
begin
  select s.organization_id, o.has_teacher into v_org, v_has_teacher
    from public.students s
    join public.organizations o on o.id = s.organization_id
   where s.id = (select auth.uid()) and s.is_active;
  if v_org is null then
    raise exception 'lesson_booking_student: only an active student books a lesson'
      using errcode = 'insufficient_privilege', constraint = 'lesson_booking_student';
  end if;
  if not v_has_teacher then
    raise exception 'lesson_booking_needs_teacher: an organization without a teacher books no lesson'
      using errcode = 'insufficient_privilege', constraint = 'lesson_booking_needs_teacher';
  end if;
  if p_teacher is not null then
    select t.organization_id, t.is_active into v_teacher
      from public.teachers t where t.id = p_teacher;
    if v_teacher.organization_id is distinct from v_org then
      raise exception 'lesson_booking_same_organization: the teacher is not of your organization'
        using errcode = 'insufficient_privilege', constraint = 'lesson_booking_same_organization';
    end if;
    if not v_teacher.is_active then
      raise exception 'lesson_teacher_active: the teacher takes no booking now'
        using errcode = 'check_violation', constraint = 'lesson_teacher_active';
    end if;
  end if;
  return v_org;
end;
$$;

comment on function public.lesson_booker_organization(uuid) is
  'The organization the caller books in, refusing by name a caller who is not an active student (lesson_booking_student), an organization without a teacher (lesson_booking_needs_teacher), a teacher of another organization (lesson_booking_same_organization) and a teacher who takes no booking (lesson_teacher_active). Called by the booking functions only.';

-- The starts a teacher has free between two instants, for one student: on
-- the grid of her windows (one every slot_minutes from the window's start,
-- a whole lesson inside it), in her zone; from book_closes_before ahead of
-- now to book_opens_ahead; outside her time off; and crossing no scheduled
-- lesson of hers (in any of her organizations), of the student's, or
-- without a teacher in her organization (the fixed agenda takes every
-- teacher there, Q6). Inclusive at both ends, so book_lesson asks for one
-- instant.
create function public.lesson_open_slots(
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
  )
  select distinct c.starts_at
    from candidate c
    cross join r
    cross join span
    cross join t
   where c.starts_at between span.lo and span.hi
     and not exists (
       select 1 from public.teacher_time_off o
        where o.teacher_id = t.id
          and tstzrange(o.starts_at, o.ends_at)
              && tstzrange(c.starts_at, c.starts_at + make_interval(mins => r.lesson_minutes)))
     and not exists (
       select 1 from public.lessons l
        where l.status = 'scheduled'
          and (l.teacher_id in (select o.id from public.teachers o where o.user_id = t.user_id)
               or (l.teacher_id is null and l.organization_id = t.organization_id)
               or l.student_id = p_student)
          and tstzrange(l.scheduled_at, l.scheduled_at + make_interval(mins => l.duration_minutes))
              && tstzrange(c.starts_at, c.starts_at + make_interval(mins => r.lesson_minutes)))
   order by c.starts_at;
$$;

comment on function public.lesson_open_slots(uuid, uuid, timestamptz, timestamptz) is
  'The starts a teacher has free for a student between two instants (both included), by lesson_rules: on the grid of her windows, in her zone, inside the booking horizon, outside her time off, crossing no scheduled lesson of hers, of the student''s or without a teacher in her organization. Called by bookable_slots and book_lesson only.';


-- What the student reads ----------------------------------------------------------------
--
-- security definer: she reads neither teachers (the calendar e-mail is the
-- teacher's) nor the teacher's name in profiles (profiles_read). Each one
-- answers for auth.uid() alone.

create function public.bookable_teachers()
returns table (teacher_id uuid, full_name text, lesson_credits integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.lesson_booker_organization(null);
  v_credits integer;
begin
  -- The cost through the ledger's one price (#273), null while the action
  -- has no cost in her brand: the screen says the lessons are not on sale.
  begin
    v_credits := public.credit_price((select auth.uid()), 'teacher_lesson');
  exception when check_violation then
    v_credits := null;
  end;
  return query
    select t.id, p.full_name, v_credits
      from public.teachers t
      join public.profiles p on p.id = t.user_id
     where t.organization_id = v_org and t.is_active
     order by p.full_name, t.id;
end;
$$;

comment on function public.bookable_teachers() is
  'The teachers who take bookings in the caller''s organization, with their name and what a lesson costs her in credits (null: not on sale). Refuses a caller who is not an active student of an organization with a teacher.';

create function public.bookable_slots(p_teacher uuid, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.lesson_booker_organization(p_teacher);
  return query
    select s.starts_at
      from public.lesson_open_slots(p_teacher, (select auth.uid()), p_from, p_to) s;
end;
$$;

comment on function public.bookable_slots(uuid, timestamptz, timestamptz) is
  'The starts the teacher has free for the caller between two instants (lesson_open_slots). Refuses as lesson_booker_organization does.';

create function public.my_lessons()
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
  select l.id, l.scheduled_at, l.duration_minutes, p.full_name,
         -- The lesson's own room first, as before; then the teacher's; a
         -- lesson of the fixed agenda keeps the student's room until #295.
         coalesce(l.meet_url, t.meet_url, s.meet_url),
         l.credits_debited, l.credits_refunded,
         case when l.credits_debited > 0 and not l.credits_refunded
              then l.scheduled_at - r.refund_until_before end
    from public.lessons l
    join public.students s on s.id = l.student_id
    left join public.teachers t on t.id = l.teacher_id
    left join public.profiles p on p.id = t.user_id
    cross join public.lesson_rules() r
   where l.student_id = (select auth.uid())
     and l.status = 'scheduled'
     and l.scheduled_at + make_interval(mins => l.duration_minutes) > now()
   order by l.scheduled_at;
$$;

comment on function public.my_lessons() is
  'The caller''s scheduled lessons not finished yet, soonest first, with the teacher''s name, the room (the lesson''s, the teacher''s, or the student''s for a lesson of the fixed agenda), the debit and until when her cancel gives it back (null: nothing to give back).';


-- Booking -------------------------------------------------------------------------------
--
-- Q5: for auth.uid() alone, at the cost the ledger reads, in one
-- transaction. The teacher's row is locked, so two bookings of hers wait for
-- each other; the exclusion constraints hold underneath all the same. The
-- lesson is written first, so the debit names it; a balance that does not
-- cover the cost refuses the debit (credits_not_negative), and the lesson
-- goes back with it. credits_debited is what the ledger wrote, read back.
create function public.book_lesson(p_teacher uuid, p_starts_at timestamptz)
returns table (lesson_id uuid, credits_debited integer, balance integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_org uuid;
  v_id uuid := gen_random_uuid();
  v_reference text := 'lesson:' || v_id::text;
  v_balance integer;
  v_debited integer;
begin
  v_org := public.lesson_booker_organization(p_teacher);
  perform 1 from public.teachers t where t.id = p_teacher for update;

  if p_starts_at is null or not exists (
       select 1 from public.lesson_open_slots(p_teacher, v_me, p_starts_at, p_starts_at) s
        where s.starts_at = p_starts_at) then
    raise exception 'lesson_slot_bookable: % is not a free slot of this teacher', p_starts_at
      using errcode = 'check_violation', constraint = 'lesson_slot_bookable';
  end if;

  insert into public.lessons
    (id, organization_id, student_id, teacher_id, scheduled_at, duration_minutes)
    values (v_id, v_org, v_me, p_teacher, p_starts_at,
            (select r.lesson_minutes from public.lesson_rules() r));

  v_balance := public.credit_debit(v_me, 'teacher_lesson', 1, v_reference);

  select coalesce(-sum(e.amount), 0)::integer into v_debited
    from public.credit_entries e
   where e.person_id = v_me and e.kind = 'debit' and e.reference = v_reference;
  update public.lessons l set credits_debited = v_debited where l.id = v_id;

  return query select v_id, v_debited, v_balance;
end;
$$;

comment on function public.book_lesson(uuid, timestamptz) is
  'Books the slot of the teacher for the caller and debits what a lesson costs her (credit_debit, reference lesson:<id>), in one transaction. Refuses by name: not a student or another organization (lesson_booker_organization), a start that is not a free slot (lesson_slot_bookable), a balance that does not cover it (credits_not_negative), a lesson without a cost (credit_cost_known); two lessons that cross are refused by lessons_teacher_no_overlap and lessons_student_no_overlap. Returns the lesson, the credits debited and her balance.';


-- Cancelling ----------------------------------------------------------------------------
--
-- The student cancels her own lesson until it starts, and gets back what
-- she paid (credit_refund gives back the debit, not today's price) up to
-- refund_until_before the start; after that nothing comes back. The
-- lesson's teacher, the organization's admin or the platform admin cancel
-- until its planned end, and the refund is always whole: the absence is
-- theirs. A lesson of the fixed agenda (no teacher) is cancelled by whoever
-- teaches in its organization, as before. Returns the credits given back.
create function public.cancel_lesson(p_lesson uuid, out refunded_credits integer)
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
             or (v_lesson.teacher_id is null and public.teaches_in(v_lesson.organization_id))
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
  'Cancels a scheduled lesson and returns the credits given back. The student, until it starts, with her debit back up to lesson_rules().refund_until_before the start; the lesson''s teacher, the organization''s admin or the platform admin (whoever teaches there, for a lesson without a teacher), until its planned end, always with the debit back. Refuses by name: lesson_cancel_allowed, lesson_cancel_before_start, lesson_cancel_before_end, lesson_cancel_scheduled.';


-- Who executes what (0047) --------------------------------------------------------------

revoke all on function public.lessons_booked_through_functions() from public, anon, authenticated;
revoke all on function public.lesson_booker_organization(uuid) from public, anon, authenticated;
revoke all on function public.lesson_open_slots(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.lesson_rules() from public, anon;
revoke all on function public.bookable_teachers() from public, anon;
revoke all on function public.bookable_slots(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.my_lessons() from public, anon;
revoke all on function public.book_lesson(uuid, timestamptz) from public, anon;
revoke all on function public.cancel_lesson(uuid) from public, anon;

-- The student's screen and the teacher's call these six.
grant execute on function public.lesson_rules() to authenticated;
grant execute on function public.bookable_teachers() to authenticated;
grant execute on function public.bookable_slots(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.my_lessons() to authenticated;
grant execute on function public.book_lesson(uuid, timestamptz) to authenticated;
grant execute on function public.cancel_lesson(uuid) to authenticated;
