-- Joining a school by invite (ADR 0004, issue #96).
--
-- Until now a membership was born only in a migration or by hand: the API
-- writes school_members for no one but a platform admin. After this, it is
-- born from an invite by email, and from nothing else:
--   - school_invites holds who was invited to which school, in which role, and
--     until when. An invite lasts 15 days and can be sent again, which renews
--     it.
--   - The membership is born when the invited email is confirmed for the
--     first time. Not when the account is created: Supabase creates the
--     account when the invite email goes out, before the person has said yes.
--   - Someone whose email is already confirmed gets the membership as soon as
--     the invite is written.
--   - An expired invite never becomes a membership.
--   - A student belongs to one school (students holds one school per person),
--     so an invite to study at a second school is refused when written.
--
-- Who invites whom (approved by Luiz on 2026-10-24): a school's admin invites
-- any role, its teacher invites students only, a student invites no one. A
-- platform admin invites anyone to any school.
--
-- Measured against the project on 2026-10-24, before this was written: 27
-- migrations applied (0029 the last); 1 account in auth.users, with a
-- confirmed email, and its profile; school_members 2 rows (Chelsea St: admin
-- and student), platform_admins 1. handle_new_user is still the one in 0002
-- and only creates the profile. No invite exists yet, so nothing is
-- backfilled.

create table school_invites (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools (id) on delete cascade,
  -- Stored the way auth.users stores it (Supabase Auth lower-cases every
  -- address), so the two compare with = and the index on auth.users.email
  -- serves the lookups below.
  email text not null
    constraint school_invites_email_check
    check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role school_role not null,
  invited_by uuid default auth.uid() references profiles (id) on delete set null,
  expires_at timestamptz not null default now() + interval '15 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- One open invite per school, email and role. Sending again renews this one
-- instead of piling up copies.
create unique index school_invites_open_key
  on school_invites (school_id, email, role) where accepted_at is null;
create index school_invites_email_idx on school_invites (email);

alter table school_invites enable row level security;

-- Who may write an invite of this role to this school.
create function can_invite(p_school uuid, p_role school_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_platform_admin()
      or is_school_member(p_school, '{admin}')
      or (p_role = 'student' and is_school_member(p_school, '{teacher}'));
$$;

-- Read, write, renew and cancel through the API. Renewing touches expires_at
-- only; accepted_at is written by the functions below and no one else.
grant select, insert, delete on school_invites to authenticated;
grant update (expires_at) on school_invites to authenticated;
revoke all on school_invites from anon;

create policy school_invites_read on school_invites
  for select using (
    (select is_platform_admin()) or is_school_member(school_id, '{admin,teacher}'));
create policy school_invites_insert on school_invites
  for insert with check (
    can_invite(school_id, role) and invited_by is not distinct from auth.uid());
-- Only an open invite is renewed or cancelled. An accepted one is the record
-- of how someone joined.
create policy school_invites_renew on school_invites
  for update
  using (accepted_at is null and can_invite(school_id, role))
  with check (can_invite(school_id, role));
create policy school_invites_cancel on school_invites
  for delete using (accepted_at is null and can_invite(school_id, role));

-- Fifteen days at most, whatever the API sends: renewing restarts the
-- fifteen days from now, and an insert can ask for less but not more. Without
-- this, an open student invite set to expire in 2100 would keep every other
-- school from inviting that person to study (the check below).
create function school_invites_fifteen_days()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.expires_at := now() + interval '15 days';
  else
    new.expires_at := least(new.expires_at, now() + interval '15 days');
  end if;
  return new;
end;
$$;

-- Before school_invites_one_school_per_student: triggers of one event fire in
-- name order.
create trigger school_invites_fifteen_days
  before insert or update of expires_at on school_invites
  for each row execute function school_invites_fifteen_days();

-- One school per student --------------------------------------------------------
--
-- students has one row per person, so a second school's student invite could
-- never become a students row. Refused when written or renewed: a student of
-- another school already, or an open student invite of another school.
-- Security definer to read auth.users and the other school's rows, which the
-- person inviting cannot see.

create function school_invites_one_school_per_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role <> 'student' then
    return new;
  end if;

  if exists (
       select 1
         from students s
         join auth.users u on u.id = s.id
        where u.email = new.email
          and s.school_id <> new.school_id)
     or exists (
       select 1
         from school_invites i
        where i.email = new.email
          and i.role = 'student'
          and i.accepted_at is null
          and i.expires_at > now()
          and i.school_id <> new.school_id
          and i.id <> new.id) then
    raise exception 'this person already studies at another school'
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

create trigger school_invites_one_school_per_student
  before insert or update of expires_at on school_invites
  for each row execute function school_invites_one_school_per_student();

-- Accepting -----------------------------------------------------------------------
--
-- Every open, unexpired invite for that email becomes a membership, and a
-- student invite also the students row (after the membership, which its key
-- requires). A student invite that finds her already a student of another
-- school is left open: the check above makes that a race, not a path.

create function accept_school_invites(p_user uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite school_invites;
begin
  for v_invite in
    select * from school_invites
     where email = lower(p_email)
       and accepted_at is null
       and expires_at > now()
     for update
  loop
    if v_invite.role = 'student' then
      if exists (select 1 from students where id = p_user and school_id <> v_invite.school_id) then
        continue;
      end if;
      insert into school_members (school_id, user_id, role)
        values (v_invite.school_id, p_user, 'student')
        on conflict do nothing;
      insert into students (id, school_id)
        values (p_user, v_invite.school_id)
        on conflict (id) do nothing;
    else
      insert into school_members (school_id, user_id, role)
        values (v_invite.school_id, p_user, v_invite.role)
        on conflict do nothing;
    end if;

    update school_invites set accepted_at = now() where id = v_invite.id;
  end loop;
end;
$$;

-- Not callable through the API: only the two triggers below accept.
revoke execute on function accept_school_invites(uuid, text) from public, anon, authenticated;

-- The first confirmation of the email. On insert as well: an account created
-- already confirmed (by the dashboard, for one) has no later update to wait
-- for. Named to sort after on_auth_user_created, so the profile that
-- school_members points at exists by the time this runs: Postgres fires
-- triggers of the same event in name order.
create function accept_school_invites_on_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null
     and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
    perform accept_school_invites(new.id, new.email);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function accept_school_invites_on_confirmation();

-- An invite written, or renewed, for someone whose email is already
-- confirmed: the membership is born now, there is no confirmation to come.
create function accept_school_invite_for_confirmed_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  select id into v_user
    from auth.users
   where email = new.email
     and email_confirmed_at is not null;
  if v_user is not null then
    perform accept_school_invites(v_user, new.email);
  end if;
  return new;
end;
$$;

create trigger school_invites_accept_confirmed
  after insert or update of expires_at on school_invites
  for each row execute function accept_school_invite_for_confirmed_account();
