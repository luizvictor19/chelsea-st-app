-- An invite waits for a yes (#103). Approved by Luiz on 2026-10-25.
--
-- Until now an invite written for an email whose account was already confirmed
-- became a membership at once (0031): the person joined without saying so, and
-- the screen told whoever invited whether that email had an account. Since
-- #109 every account is born from an invite, so "already has an account" means
-- someone who joined through an earlier invite and gets another one, from
-- another school or for another role.
--
-- - An invite for a confirmed account stays open until that person accepts it
--   while signed in, through accept_my_school_invite. Nothing is mailed to her:
--   Supabase refuses inviteUserByEmail for a confirmed account.
-- - A new account is unchanged: the first confirmation of the email (the click
--   on the invite email) accepts, through the trigger on auth.users of 0031.
-- - A student belongs to one school (students holds one school per person).
--   That is now checked when the invite is accepted, not when it is written:
--   refusing the write told the inviting school that the person studies
--   elsewhere. The person reads the reason, the school does not.
--
-- Measured against the project on 2026-10-25, before this was written: 1
-- account, 1 school, 2 memberships, 2 invites, both accepted, none open. No row
-- changes here.

-- No membership at write time ------------------------------------------------------

drop trigger school_invites_accept_confirmed on school_invites;
drop function accept_school_invite_for_confirmed_account();

-- One school per student, at acceptance --------------------------------------------
--
-- The fifteen days of school_invites_fifteen_days stay: an invite still should
-- not sit open for years, though an open student invite no longer keeps other
-- schools from inviting the same email.

drop trigger school_invites_one_school_per_student on school_invites;
drop function school_invites_one_school_per_student();

-- The signed-in person's invites ----------------------------------------------------
--
-- Security definer: the invited person reads no school_invites row through RLS,
-- and no schools row of a school she has not joined yet. The email is read from
-- auth.users, confirmed, never from the token: it is the address the account
-- proved it owns.

create function my_open_school_invites()
returns table (
  id uuid,
  school_id uuid,
  school_name text,
  role school_role,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.school_id, s.name, i.role, i.expires_at
    from school_invites i
    join schools s on s.id = i.school_id
   where i.email = (select u.email from auth.users u
                     where u.id = auth.uid() and u.email_confirmed_at is not null)
     and i.accepted_at is null
     and i.expires_at > now()
   order by i.created_at;
$$;

revoke execute on function my_open_school_invites() from public, anon;
grant execute on function my_open_school_invites() to authenticated;

-- Accepting ---------------------------------------------------------------------------
--
-- One invite, by the person it was written for: open, not expired, and her own
-- confirmed email. The membership is born here, and for a student the students
-- row after it (its key requires the membership). Each refusal names its rule,
-- so the screen can say which.

create function accept_my_school_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invite school_invites;
begin
  select i.* into v_invite
    from school_invites i
   where i.id = p_invite
     and i.accepted_at is null
     and i.expires_at > now()
     and i.email = (select u.email from auth.users u
                     where u.id = v_user and u.email_confirmed_at is not null)
     for update;

  if not found then
    raise exception 'invite % is not open for this account', p_invite
      using errcode = 'check_violation', constraint = 'accept_my_school_invite_open';
  end if;

  if v_invite.role = 'student'
     and exists (select 1 from students where id = v_user and school_id <> v_invite.school_id) then
    raise exception 'this person already studies at another school'
      using errcode = 'check_violation', constraint = 'accept_my_school_invite_one_school';
  end if;

  insert into school_members (school_id, user_id, role)
    values (v_invite.school_id, v_user, v_invite.role)
    on conflict do nothing;
  if v_invite.role = 'student' then
    insert into students (id, school_id)
      values (v_user, v_invite.school_id)
      on conflict (id) do nothing;
  end if;

  update school_invites set accepted_at = now() where id = v_invite.id;
end;
$$;

revoke execute on function accept_my_school_invite(uuid) from public, anon;
grant execute on function accept_my_school_invite(uuid) to authenticated;
