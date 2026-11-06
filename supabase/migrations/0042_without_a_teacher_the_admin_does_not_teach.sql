-- Without a teacher, the admin does not teach (issue #197, ADR 0005).
--
-- ADR 0004 let an organization's admin do everything a teacher can. A company
-- on GrifoAI has no teacher: its people practise with Robin only, and its
-- admin invites them and nothing else. has_teacher says which kind an
-- organization is; teaches_in() is the one place that turns admin into
-- teacher, and only where there is a teacher.
--
-- Measured on 2026-11-06 through the MCP, after 0041: migrations applied
-- through 0041. 2 organizations: chelsea-st (1 admin, 1 teacher, 2 students,
-- 5 invites, none open) and grifoai (no member, no invite). 51 policies in
-- public and storage. 36 policies of public hold the text
-- is_organization_member(organization_id, '{admin,teacher}'::organization_role[]):
-- 34 on the 17 tables below, a teacher's power, and 2 for running the
-- organization (organization_members_read, organization_invites_read), which
-- stay. profiles_read asks the same of m.organization_id and stays too: the
-- admin of a company reads the names of the people she invited (#198). 10
-- policies ask teaches_anywhere(); 1 on storage names the two roles.
-- Functions that give a teacher's power: teaches_anywhere, can_write_content
-- (called by delete_question, reorder_questions and materialize_points) and
-- materialize_lessons.
--
-- In an organization with a teacher (Chelsea St) nothing changes: there
-- teaches_in(o) is exactly is_organization_member(o, '{admin,teacher}').

alter table organizations add column has_teacher boolean not null default true;
-- No default afterwards, as brand in 0041: a new organization says whether it
-- has a teacher.
alter table organizations alter column has_teacher drop default;
-- GrifoAI's own organization, created by 0041, has no teacher.
update organizations set has_teacher = false where slug = 'grifoai';

-- Who teaches in an organization: its teacher, or its admin where the
-- organization has a teacher. Security definer, as is_organization_member:
-- a policy calls it, and it reads organization_members and organizations past
-- their own policies.
create function teaches_in(p_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_members m
      join organizations o on o.id = m.organization_id
     where m.organization_id = p_organization
       and m.user_id = auth.uid()
       and (m.role = 'teacher' or (m.role = 'admin' and o.has_teacher)));
$$;

-- Common content is read by whoever teaches somewhere. The admin of a company
-- without a teacher does not.
create or replace function teaches_anywhere()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_members m
      join organizations o on o.id = m.organization_id
     where m.user_id = auth.uid()
       and (m.role = 'teacher' or (m.role = 'admin' and o.has_teacher)));
$$;

create or replace function can_write_content(p_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_platform_admin()
      or (p_organization is not null and teaches_in(p_organization));
$$;

-- The body of 0040, which is production's (pg_get_functiondef on 2026-11-06);
-- only the first check changes. No search_path, as today.
create or replace function materialize_lessons(p_student_id uuid, p_weeks integer default 4)
returns integer
language plpgsql
as $$
declare
  v_inserted integer;
begin
  if not (is_platform_admin()
          or teaches_in((select organization_id from students where id = p_student_id))) then
    raise exception 'only a teacher of the student''s organization may materialize her lessons';
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

-- The 34 policies: the admin-or-teacher check becomes teaches_in, and nothing
-- else in the expression moves. Read from pg_policies and altered in place, so
-- the other clauses (the student's own rows, the common rows, the platform
-- admin) are the ones production holds, not a copy typed again.
-- scripts/verify-rls.sql compares every policy with its text before this.
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
  v record;
  v_moved integer := 0;
begin
  for v in
    select tablename, policyname, qual, with_check from pg_policies
     where schemaname = 'public' and tablename = any (c_tables)
       and (strpos(coalesce(qual, ''), c_from) > 0
            or strpos(coalesce(with_check, ''), c_from) > 0)
  loop
    execute format('alter policy %I on public.%I%s%s', v.policyname, v.tablename,
      case when v.qual is null then ''
           else format(' using (%s)', replace(v.qual, c_from, c_to)) end,
      case when v.with_check is null then ''
           else format(' with check (%s)', replace(v.with_check, c_from, c_to)) end);
    v_moved := v_moved + 1;
  end loop;
  if v_moved <> 34 then
    raise exception 'expected 34 policies to move to teaches_in, moved %', v_moved;
  end if;
end;
$$;

-- Storage: an organization's image folder is written by whoever teaches in
-- it. Qualified, as in 0029: a storage request does not arrive with public on
-- its search_path.
drop policy vocabulary_images_write on storage.objects;
create policy vocabulary_images_write on storage.objects
  for all
  using (bucket_id = 'vocabulary-images' and (
    (select public.is_platform_admin())
    or exists (
      select 1 from public.organization_members m
       where m.user_id = auth.uid()
         and m.organization_id::text = split_part(name, '/', 1)
         and public.teaches_in(m.organization_id))))
  with check (bucket_id = 'vocabulary-images' and (
    (select public.is_platform_admin())
    or exists (
      select 1 from public.organization_members m
       where m.user_id = auth.uid()
         and m.organization_id::text = split_part(name, '/', 1)
         and public.teaches_in(m.organization_id))));

-- Nobody teaches where there is no teacher. A trigger and not a policy: the
-- platform admin writes organizations, members and invites through the API,
-- and no policy limits her. The refusal names its rule in the message too,
-- because the app reads PostgREST's message, not the constraint.
create function a_teacher_needs_a_teaching_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'organizations' then
    if not new.has_teacher and (
         exists (select 1 from organization_members
                  where organization_id = new.id and role = 'teacher')
      or exists (select 1 from organization_invites
                  where organization_id = new.id and role = 'teacher'
                    and accepted_at is null)) then
      raise exception 'organization % still has a teacher (organization_without_teacher_has_none)', new.slug
        using errcode = 'check_violation',
              constraint = 'organization_without_teacher_has_none';
    end if;
  elsif new.role = 'teacher'
        and not (select has_teacher from organizations where id = new.organization_id) then
    raise exception 'organization % has no teacher (teacher_needs_a_teaching_organization)', new.organization_id
      using errcode = 'check_violation',
            constraint = 'teacher_needs_a_teaching_organization';
  end if;
  return new;
end;
$$;

create trigger organizations_teacher
  before update of has_teacher on organizations
  for each row execute function a_teacher_needs_a_teaching_organization();
create trigger organization_members_teacher
  before insert or update of role, organization_id on organization_members
  for each row execute function a_teacher_needs_a_teaching_organization();
create trigger organization_invites_teacher
  before insert or update of role, organization_id on organization_invites
  for each row execute function a_teacher_needs_a_teaching_organization();
