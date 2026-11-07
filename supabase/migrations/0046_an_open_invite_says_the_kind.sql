-- An open invite says the kind of its organization (issue #213).
--
-- Someone who already has an account joins another organization only by
-- saying yes to an invite on her screen (0032), which reads her open invites
-- through my_open_organization_invites (0040). The screen named the role as
-- a school does, always: "Aluna" for an invite to a company without a
-- teacher, where the same role is "Funcionário" (0042, roleLabel). It could
-- not do better, because the function did not say which kind the
-- organization is, and someone who is not a member yet cannot read
-- organizations (organizations_read).
--
-- The function now also gives has_teacher, from the join it already makes.
-- The new column goes last, so every column it gave keeps its place. A
-- result of another type cannot be replaced in place, so it is dropped and
-- created; the body is 0040's with one column more, and the revoke and the
-- grant are 0040's again, since a new function starts with execute for
-- public.
--
-- Measured on 2026-11-07 through the MCP, before this migration: the
-- function in production is 0040's, the last migration applied is 0045, and
-- no invite is open, so nobody is reading one while it changes.
--
-- No table, policy or row changes. has_teacher is no secret from her: the
-- invite already names the organization and the role she would hold.

drop function my_open_organization_invites();

create function my_open_organization_invites()
returns table (id uuid, organization_id uuid, organization_name text, role organization_role, expires_at timestamptz, has_teacher boolean)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.organization_id, s.name, i.role, i.expires_at, s.has_teacher
    from organization_invites i
    join organizations s on s.id = i.organization_id
   where i.email = (select u.email from auth.users u
                     where u.id = auth.uid() and u.email_confirmed_at is not null)
     and i.accepted_at is null
     and i.expires_at > now()
   order by i.created_at;
$$;

-- As 0032 and 0040: only a signed-in person asks for her own invites.
revoke execute on function my_open_organization_invites() from public, anon;
grant execute on function my_open_organization_invites() to authenticated;
