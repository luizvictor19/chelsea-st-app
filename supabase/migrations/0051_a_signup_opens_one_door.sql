-- A signup opens one door (issue #275, ADR 0004, ADR 0005, ADR 0006).
--
-- Until now an account joined an organization only through an invite (0031,
-- 0032). The B2C line, Chelsea St, takes people who sign up on their own; a
-- company on GrifoAI stays invite only. The account is still born from an
-- invite, one the person asks for herself: /cadastro calls inviteUserByEmail
-- from the server with the metadata { signup: true, full_name }, and GoTrue's
-- open signup stays off. The metadata only says "came from the signup"; which
-- organization she joins is decided here, never by the request:
--
--   - organizations.open_signup marks the one organization a signup enters.
--     Only an organization of the brand chelsea-st that has a teacher may hold
--     it (organizations_open_signup_chelsea), and only one at a time
--     (organizations_one_open_signup). A company never does. Only the platform
--     admin changes it, through organizations_write, which already exists.
--   - On the first confirmation of the email, after the open invites are
--     accepted, join_by_signup makes an account whose metadata says signup a
--     student of that organization. Nothing when she is already a member of
--     any organization, in any role: an invite accepted first, in the same
--     confirmation (of a company or of Chelsea St itself, as student, teacher
--     or admin), wins, and the signup adds no second role beside it. Nothing
--     when no organization has the door open.
--   - Only the first confirmation counts, as for the invites: metadata the
--     person changes later, signed in, makes nobody a member.
--
-- The trigger function keeps its name, its trigger and its ACL, so
-- scripts/restore-outside-public.sql does not change.
--
-- Measured on 2026-11-12 through the MCP, before this was written: migrations
-- applied through 0049. 3 organizations: chelsea-st (brand chelsea-st, with a
-- teacher, 4 members, 2 students), empresa-teste (brand grifoai, no teacher,
-- 2 members, 1 student) and grifoai (brand grifoai, no teacher, empty). No
-- column open_signup and no function join_by_signup. auth.users: 7 accounts,
-- 1 unconfirmed, none with signup in its metadata, so no existing account
-- joins anything when this is applied. accept_organization_invites_on_confirmation
-- as 0040 left it, executable by its owner alone ({postgres=X/postgres}, 0047).
--
-- Measured on the local stack (chelsea-e2e) on 2026-11-12, step 0 of the
-- plan: inviteUserByEmail with metadata creates the account unconfirmed with
-- the metadata, and verifying its token_hash confirms it and keeps them. For
-- an address that already has an account, confirmed, GoTrue refuses with
-- email_exists and mails nothing. For an unconfirmed one it mails again and
-- keeps the metadata it had: an account born from an invite never gains
-- signup this way.

alter table organizations add column open_signup boolean not null default false;

alter table organizations add constraint organizations_open_signup_chelsea
  check (not open_signup or (brand = 'chelsea-st' and has_teacher));

create unique index organizations_one_open_signup on organizations ((true))
  where open_signup;

comment on column organizations.open_signup is
  'The one organization a signup (/cadastro, #275) enters, as a student, on the first confirmation of the email. Only chelsea-st with a teacher, only one. Written by the platform admin.';

-- One row, measured above.
update organizations set open_signup = true where slug = 'chelsea-st';

-- Security definer, as accept_organization_invites: it writes
-- organization_members and students past their policies, and only the trigger
-- function below calls it.
create function join_by_signup(p_user uuid, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization uuid;
begin
  if coalesce(p_meta ->> 'signup', '') <> 'true' then
    return;
  end if;
  if exists (select 1 from organization_members where user_id = p_user) then
    return;
  end if;

  select id into v_organization from organizations where open_signup;
  if v_organization is null then
    return;
  end if;

  insert into organization_members (organization_id, user_id, role)
    values (v_organization, p_user, 'student')
    on conflict do nothing;
  insert into students (id, organization_id)
    values (p_user, v_organization)
    on conflict (id) do nothing;
end;
$$;

-- Born closed since 0047; said here too, as 0049 does for its functions.
revoke all on function join_by_signup(uuid, jsonb) from public, anon, authenticated, service_role;

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
    perform join_by_signup(new.id, new.raw_user_meta_data);
  end if;
  return new;
end;
$$;
