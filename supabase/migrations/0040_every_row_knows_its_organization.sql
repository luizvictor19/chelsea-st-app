-- Every row knows its organization (#199).
--
-- The tenant of ADR 0004 was named a school. ADR 0005 names it an
-- organization: a school is one kind of organization the platform serves. This
-- renames every object of the database that says school, by one map with no
-- exception: school -> organization, School -> Organization, and "a school"
-- -> "an organization" where the article follows the noun. Names of tables,
-- columns, the enum, constraints, indexes, triggers, policies, functions and
-- their parameters, and the words of every refusal a function raises. Nothing
-- else changes: no row, no privilege, no expression of a policy beyond the name
-- of the function it calls, no body beyond the map. One cutover, no
-- compatibility names left behind (Luiz, on the plan of #199).
--
-- Measured against the project through the MCP on 2026-11-06, before this was
-- written: migrations applied through 0039. 3 tables (schools,
-- school_members, school_invites), the enum school_role, 19 columns school_id,
-- 24 constraints and 3 indexes with school in the name, 7 index columns named
-- school_id, 19 triggers (17 named
-- <table>_school on school_follows_parents, lessons_stop_in_school,
-- school_invites_fifteen_days), 16 functions whose name, parameters, result or
-- body say school (11 security definer), 51 policies in public and storage, of
-- which 8 have school in the name, 39 call is_school_member and 3 call
-- can_invite. Rows: 1 school, 4 members (1 admin, 1 teacher, 2 students),
-- 5 invites and none open, 2 students, 4 accounts in auth.users.
--
-- How each kind of object is carried:
--
-- * Tables, columns, the enum, constraints, indexes, triggers and policies by
--   alter ... rename: the OID stays, and with it every row, grant, RLS flag and
--   every reference a policy, a foreign key or a trigger holds by OID.
-- * A function whose parameters keep their names by alter function rename
--   (when its name says school) and create or replace with the body mapped,
--   with the same attributes: create or replace resets security definer,
--   volatility and search_path to what it is given, and keeps only the OID,
--   the owner and the grants. The bodies are the text of
--   pg_get_functiondef on the project, with the map applied and nothing more.
-- * A function whose parameter says school (is_school_member, can_invite and
--   can_write_content take p_school) by a new function: create or replace
--   refuses to rename a parameter. A new function in public is born with the
--   default execute for PUBLIC, the same null ACL the three have today
--   (postgres's default ACL for functions in public is postgres=X, which is
--   also the built-in default), so anon, authenticated and service_role
--   execute them as before.
-- * my_open_school_invites returns school_id and school_name, so its result
--   type changes: dropped and created again under its new name, with the
--   revoke and grant of 0032 repeated, or authenticated would lose it.
-- * The 42 policies that call is_school_member or can_invite are pointed at
--   the new functions from their own text in pg_policy, and the old functions
--   are dropped without cascade: a policy left calling one of them makes the
--   drop, and the whole migration, fail.
--
-- Trigger order. Row triggers of the same timing fire in name order. Only
-- questions changes: questions_scene_in_use fired before questions_school and
-- now fires after questions_organization. Neither reads what the other
-- writes (question_scene_in_use reads scene_id and scenes.archived_at, never
-- the organization), so a row is accepted or refused exactly as before; a row
-- refused by both is now named by questions_organization first. lessons and
-- scenes keep their order.
--
-- What changes for a caller: every name above, the constraint names a refusal
-- carries (organization_invites_email_check, accept_my_organization_invite_open,
-- accept_my_organization_invite_one_organization, <table>_organization,
-- lessons_stop_in_organization) and the words "another organization". The app
-- of the same PR reads the new names; the app before it does not, so the push
-- and the merge go together (docs/context.md, Environments).
--
-- Storage paths start with the value of an id, which does not change. The
-- policy vocabulary_images_write on storage.objects names
-- organization_members and organization_role by OID and follows on its own.
--
-- Until 0039 these objects were named school; the older migrations keep the
-- names of their time.

-- The enum, the tables and their columns -----------------------------------------------

alter type school_role rename to organization_role;

alter table schools rename to organizations;
alter table school_members rename to organization_members;
alter table school_invites rename to organization_invites;

alter table assignment_items rename column school_id to organization_id;
alter table assignments rename column school_id to organization_id;
alter table attempts rename column school_id to organization_id;
alter table blocks rename column school_id to organization_id;
alter table books rename column school_id to organization_id;
alter table contrast_set_items rename column school_id to organization_id;
alter table contrast_sets rename column school_id to organization_id;
alter table image_attempts rename column school_id to organization_id;
alter table lesson_schedules rename column school_id to organization_id;
alter table lessons rename column school_id to organization_id;
alter table lessons_content rename column school_id to organization_id;
alter table organization_invites rename column school_id to organization_id;
alter table organization_members rename column school_id to organization_id;
alter table points rename column school_id to organization_id;
alter table questions rename column school_id to organization_id;
alter table review_schedule rename column school_id to organization_id;
alter table scenes rename column school_id to organization_id;
alter table students rename column school_id to organization_id;
alter table vocabulary_items rename column school_id to organization_id;

-- Constraints and indexes ----------------------------------------------------------------
--
-- A primary key or unique constraint renames its index with it.

alter table assignments rename constraint assignments_school_id_id_key to assignments_organization_id_id_key;
alter table blocks rename constraint blocks_school_id_fkey to blocks_organization_id_fkey;
alter table books rename constraint books_school_id_fkey to books_organization_id_fkey;
alter table contrast_set_items rename constraint contrast_set_items_school_id_fkey to contrast_set_items_organization_id_fkey;
alter table contrast_sets rename constraint contrast_sets_school_id_fkey to contrast_sets_organization_id_fkey;
alter table image_attempts rename constraint image_attempts_school_id_fkey to image_attempts_organization_id_fkey;
alter table lessons_content rename constraint lessons_content_school_id_fkey to lessons_content_organization_id_fkey;
alter table points rename constraint points_school_id_fkey to points_organization_id_fkey;
alter table questions rename constraint questions_school_id_fkey to questions_organization_id_fkey;
alter table scenes rename constraint scenes_school_id_fkey to scenes_organization_id_fkey;
alter table organization_invites rename constraint school_invites_email_check to organization_invites_email_check;
alter table organization_invites rename constraint school_invites_invited_by_fkey to organization_invites_invited_by_fkey;
alter table organization_invites rename constraint school_invites_pkey to organization_invites_pkey;
alter table organization_invites rename constraint school_invites_school_id_fkey to organization_invites_organization_id_fkey;
alter table organization_members rename constraint school_members_pkey to organization_members_pkey;
alter table organization_members rename constraint school_members_school_id_fkey to organization_members_organization_id_fkey;
alter table organization_members rename constraint school_members_user_id_fkey to organization_members_user_id_fkey;
alter table organizations rename constraint schools_name_check to organizations_name_check;
alter table organizations rename constraint schools_pkey to organizations_pkey;
alter table organizations rename constraint schools_slug_check to organizations_slug_check;
alter table organizations rename constraint schools_slug_key to organizations_slug_key;
alter table students rename constraint students_school_id_fkey to students_organization_id_fkey;
alter table students rename constraint students_school_id_id_key to students_organization_id_id_key;
alter table vocabulary_items rename constraint vocabulary_items_school_id_fkey to vocabulary_items_organization_id_fkey;

alter index school_invites_email_idx rename to organization_invites_email_idx;
alter index school_invites_open_key rename to organization_invites_open_key;
alter index school_members_user_idx rename to organization_members_user_idx;

-- An index keeps, as the name of its own column, the name the table's column
-- had when the index was built: the rename of the column does not reach it.
-- Nothing reads that name (pg_get_indexdef prints the table's column), but it
-- says school, so it is renamed too. Measured on the project: these 7, each
-- at attnum 1.
alter table assignments_organization_id_id_key rename column school_id to organization_id;
alter table books_position_key rename column school_id to organization_id;
alter table organization_invites_open_key rename column school_id to organization_id;
alter table organization_members_pkey rename column school_id to organization_id;
alter table scenes_description_key rename column school_id to organization_id;
alter table students_organization_id_id_key rename column school_id to organization_id;
alter table vocabulary_items_term_idx rename column school_id to organization_id;

-- Triggers -------------------------------------------------------------------------------

alter trigger assignment_items_school on assignment_items rename to assignment_items_organization;
alter trigger assignments_school on assignments rename to assignments_organization;
alter trigger attempts_school on attempts rename to attempts_organization;
alter trigger blocks_school on blocks rename to blocks_organization;
alter trigger books_school on books rename to books_organization;
alter trigger contrast_set_items_school on contrast_set_items rename to contrast_set_items_organization;
alter trigger contrast_sets_school on contrast_sets rename to contrast_sets_organization;
alter trigger image_attempts_school on image_attempts rename to image_attempts_organization;
alter trigger lesson_schedules_school on lesson_schedules rename to lesson_schedules_organization;
alter trigger lessons_school on lessons rename to lessons_organization;
alter trigger lessons_content_school on lessons_content rename to lessons_content_organization;
alter trigger points_school on points rename to points_organization;
alter trigger questions_school on questions rename to questions_organization;
alter trigger review_schedule_school on review_schedule rename to review_schedule_organization;
alter trigger scenes_school on scenes rename to scenes_organization;
alter trigger students_school on students rename to students_organization;
alter trigger vocabulary_items_school on vocabulary_items rename to vocabulary_items_organization;
alter trigger lessons_stop_in_school on lessons rename to lessons_stop_in_organization;
alter trigger school_invites_fifteen_days on organization_invites rename to organization_invites_fifteen_days;

-- Policies, by name ----------------------------------------------------------------------
--
-- Their expressions are carried below, with the functions they call.

alter policy schools_read on organizations rename to organizations_read;
alter policy schools_write on organizations rename to organizations_write;
alter policy school_members_read on organization_members rename to organization_members_read;
alter policy school_members_write on organization_members rename to organization_members_write;
alter policy school_invites_cancel on organization_invites rename to organization_invites_cancel;
alter policy school_invites_insert on organization_invites rename to organization_invites_insert;
alter policy school_invites_read on organization_invites rename to organization_invites_read;
alter policy school_invites_renew on organization_invites rename to organization_invites_renew;

-- Functions renamed, same parameters ------------------------------------------------------

alter function accept_my_school_invite(uuid) rename to accept_my_organization_invite;
alter function accept_school_invites(uuid, text) rename to accept_organization_invites;
alter function accept_school_invites_on_confirmation() rename to accept_organization_invites_on_confirmation;
alter function school_follows_parents() rename to organization_follows_parents;
alter function school_invites_fifteen_days() rename to organization_invites_fifteen_days;
alter function lesson_stop_in_school() rename to lesson_stop_in_organization;

-- organization_invites_fifteen_days names no school in its body: the rename is
-- all it takes. The other five get their bodies mapped.

create or replace function accept_my_organization_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invite organization_invites;
begin
  -- One acceptance per person at a time. Two student invites of different
  -- organizations accepted at once (two tabs) would both pass the one-organization check
  -- below, and the second students insert would be swallowed by on conflict.
  perform pg_advisory_xact_lock(hashtextextended('accept_my_organization_invite:' || v_user::text, 0));

  select i.* into v_invite
    from organization_invites i
   where i.id = p_invite
     and i.accepted_at is null
     and i.expires_at > now()
     and i.email = (select u.email from auth.users u
                     where u.id = v_user and u.email_confirmed_at is not null)
     for update;

  if not found then
    raise exception 'invite % is not open for this account', p_invite
      using errcode = 'check_violation', constraint = 'accept_my_organization_invite_open';
  end if;

  if v_invite.role = 'student'
     and exists (select 1 from students where id = v_user and organization_id <> v_invite.organization_id) then
    raise exception 'this person already studies at another organization'
      using errcode = 'check_violation', constraint = 'accept_my_organization_invite_one_organization';
  end if;

  insert into organization_members (organization_id, user_id, role)
    values (v_invite.organization_id, v_user, v_invite.role)
    on conflict do nothing;
  if v_invite.role = 'student' then
    insert into students (id, organization_id)
      values (v_user, v_invite.organization_id)
      on conflict (id) do nothing;
  end if;

  update organization_invites set accepted_at = now() where id = v_invite.id;
end;
$$;

create or replace function accept_organization_invites(p_user uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite organization_invites;
begin
  for v_invite in
    select * from organization_invites
     where email = lower(p_email)
       and accepted_at is null
       and expires_at > now()
     for update
  loop
    if v_invite.role = 'student' then
      if exists (select 1 from students where id = p_user and organization_id <> v_invite.organization_id) then
        continue;
      end if;
      insert into organization_members (organization_id, user_id, role)
        values (v_invite.organization_id, p_user, 'student')
        on conflict do nothing;
      insert into students (id, organization_id)
        values (p_user, v_invite.organization_id)
        on conflict (id) do nothing;
    else
      insert into organization_members (organization_id, user_id, role)
        values (v_invite.organization_id, p_user, v_invite.role)
        on conflict do nothing;
    end if;

    update organization_invites set accepted_at = now() where id = v_invite.id;
  end loop;
end;
$$;

create or replace function accept_organization_invites_on_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null
     and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
    perform accept_organization_invites(new.id, new.email);
  end if;
  return new;
end;
$$;

-- The query is built as text, so the rename of the column does not reach it:
-- 'select organization_id from %I' is written here.
create or replace function organization_follows_parents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_parent uuid;
  v_parent_organization uuid;
  v_adopted boolean := false;
  i integer := 0;
begin
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception '%: organization_id cannot change once written', tg_table_name
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  while i < tg_nargs loop
    v_parent := (v_row ->> tg_argv[i])::uuid;
    if v_parent is not null then
      execute format('select organization_id from %I where id = $1', tg_argv[i + 1])
        into v_parent_organization
        using v_parent;

      -- Only on insert, and only from the first parent present. On update the
      -- organization is already written, and a common row moved under an organization's
      -- parent must be refused below, not adopted.
      if not v_adopted and new.organization_id is null and tg_op = 'INSERT' then
        new.organization_id := v_parent_organization;
      end if;
      v_adopted := true;

      if v_parent_organization is not null and v_parent_organization is distinct from new.organization_id then
        raise exception '%.%: points at a row of another organization', tg_table_name, tg_argv[i]
          using errcode = 'check_violation', constraint = tg_name;
      end if;
    end if;
    i := i + 2;
  end loop;

  return new;
end;
$$;

create or replace function lesson_stop_in_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stopped_at_point_id is not null
     and not exists (
       select 1
         from points p
        where p.id = new.stopped_at_point_id
          and (p.organization_id is null or p.organization_id = new.organization_id)
     ) then
    raise exception 'lesson %: point % is not common nor of the lesson''s organization',
      new.id, new.stopped_at_point_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

-- Functions with a parameter named for the school ------------------------------------------
--
-- New functions. is_organization_member first: can_invite and
-- can_write_content are SQL functions, and their bodies are checked against it
-- when they are created.

create function is_organization_member(p_organization uuid, p_roles organization_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_members
     where organization_id = p_organization
       and user_id = auth.uid()
       and (p_roles is null or role = any (p_roles))
  );
$$;

-- The old can_invite steps aside under another name until its three policies
-- leave it, below; then it is dropped.
alter function can_invite(uuid, organization_role) rename to can_invite_before_0040;

create function can_invite(p_organization uuid, p_role organization_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_platform_admin()
      or is_organization_member(p_organization, '{admin}')
      or (p_role = 'student' and is_organization_member(p_organization, '{teacher}'));
$$;

-- No policy calls can_write_content: it is called from function bodies and by
-- the app, and nothing depends on it.
drop function can_write_content(uuid);

create function can_write_content(p_organization uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_platform_admin()
      or (p_organization is not null and is_organization_member(p_organization, '{admin,teacher}'));
$$;

drop function my_open_school_invites();

-- The alias s stays: the body is the project's text with the map applied and
-- nothing more, so a rehearsal compares it to production with an empty diff.

create function my_open_organization_invites()
returns table (id uuid, organization_id uuid, organization_name text, role organization_role, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.organization_id, s.name, i.role, i.expires_at
    from organization_invites i
    join organizations s on s.id = i.organization_id
   where i.email = (select u.email from auth.users u
                     where u.id = auth.uid() and u.email_confirmed_at is not null)
     and i.accepted_at is null
     and i.expires_at > now()
   order by i.created_at;
$$;

-- As 0032: only a signed-in person asks for her own invites.
revoke execute on function my_open_organization_invites() from public, anon;
grant execute on function my_open_organization_invites() to authenticated;

-- Functions whose body alone names the school ------------------------------------------

create or replace function belongs_anywhere()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from organization_members where user_id = auth.uid());
$$;

create or replace function teaches_anywhere()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_members
     where user_id = auth.uid() and role in ('admin', 'teacher')
  );
$$;

-- No search_path, as today.
create or replace function materialize_lessons(p_student_id uuid, p_weeks integer default 4)
returns integer
language plpgsql
as $$
declare
  v_inserted integer;
begin
  if not (is_platform_admin()
          or is_organization_member((select organization_id from students where id = p_student_id),
                              '{admin,teacher}')) then
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

-- The text of 0039, mapped. The refusal of a narrowing names no school and is
-- the same sentence, word for word.
create or replace function materialize_points(p_book_id uuid, p_first_point integer, p_last_point integer)
returns integer
language plpgsql
as $$
declare
  v_inserted integer;
  v_blocked_points integer;
  v_blocked_lessons integer;
  v_stopped_points integer;
begin
  if not can_write_content((select organization_id from books where id = p_book_id)) then
    raise exception 'only a teacher of the book''s organization may configure it';
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

  -- All three checked before anything is written, so a refusal leaves the
  -- book exactly as it was.
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

  -- A point a lesson stopped at is restricted by lessons_stopped_at_point_fkey
  -- (0035). Counted apart from content: the teacher has to know the reason is
  -- a lesson, to know where to look. A point with content and a mark counts in
  -- both.
  select count(*) into v_stopped_points
  from points p
  where p.book_id = p_book_id
    and (p.number < p_first_point or p.number > p_last_point)
    and exists (select 1 from lessons l where l.stopped_at_point_id = p.id);

  if v_blocked_points > 0 or v_blocked_lessons > 0 or v_stopped_points > 0 then
    raise exception
      'cannot narrow book % to %..%: % point(s) outside carry content, % lesson(s) reach outside, % point(s) outside are where a lesson stopped',
      p_book_id, p_first_point, p_last_point, v_blocked_points, v_blocked_lessons, v_stopped_points;
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

create or replace function delete_question(p_question_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_point uuid;
begin
  if not can_write_content((select organization_id from questions where id = p_question_id)) then
    raise exception 'only a teacher of the question''s organization may delete it'
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
  if not can_write_content((select organization_id from points where id = p_point_id)) then
    raise exception 'only a teacher of the point''s organization may order its questions'
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

-- The policies leave the old functions ----------------------------------------------------
--
-- Every policy of public that depends on is_school_member or
-- can_invite_before_0040 is altered with its own expressions, read back from
-- pg_policy, where only the name of the function changes. The tables and
-- columns in them are held by OID and already print with their new names.
-- Read from the catalog and not written out by hand, so no expression can
-- drift from what the project holds.
do $$
declare
  c_old constant regprocedure[] := array[
    'is_school_member(uuid, organization_role[])'::regprocedure,
    'can_invite_before_0040(uuid, organization_role)'::regprocedure];
  v_policy record;
  v_using text;
  v_check text;
  v_count integer := 0;
begin
  for v_policy in
    select pol.polname, c.relname, pol.polrelid, pol.polqual, pol.polwithcheck
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and exists (select 1 from pg_depend d
                    where d.classid = 'pg_policy'::regclass
                      and d.objid = pol.oid
                      and d.refclassid = 'pg_proc'::regclass
                      and d.refobjid = any (c_old::oid[]))
     order by c.relname, pol.polname
  loop
    v_using := regexp_replace(
      regexp_replace(pg_get_expr(v_policy.polqual, v_policy.polrelid),
                     '(public\.)?is_school_member\(', 'is_organization_member(', 'g'),
      '(public\.)?can_invite_before_0040\(', 'can_invite(', 'g');
    v_check := regexp_replace(
      regexp_replace(pg_get_expr(v_policy.polwithcheck, v_policy.polrelid),
                     '(public\.)?is_school_member\(', 'is_organization_member(', 'g'),
      '(public\.)?can_invite_before_0040\(', 'can_invite(', 'g');

    -- A select or delete policy has no with check, an insert policy no using:
    -- each clause is altered only where the policy has it.
    execute format('alter policy %I on public.%I', v_policy.polname, v_policy.relname)
      || coalesce(' using (' || v_using || ')', '')
      || coalesce(' with check (' || v_check || ')', '');
    v_count := v_count + 1;
  end loop;

  -- 42 measured on the project on 2026-11-06 (39 call is_school_member, 3
  -- call can_invite). Another number means the catalog is not the one this
  -- was written against: stop here, by name, rather than at the drop below.
  if v_count <> 42 then
    raise exception '0040: % policies call is_school_member or can_invite, 42 were measured', v_count;
  end if;
  raise notice '0040: % policies moved to is_organization_member and can_invite', v_count;
end;
$$;

-- Without cascade: a policy still calling either one refuses the drop, and
-- with it the migration.
drop function is_school_member(uuid, organization_role[]);
drop function can_invite_before_0040(uuid, organization_role);
