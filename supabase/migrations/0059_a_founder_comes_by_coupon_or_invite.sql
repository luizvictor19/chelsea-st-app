-- A founder comes by coupon or invite (issue #296, ADR 0006, ADR 0007).
--
-- 0058 (#292) made the Founder seal and its one door, badge_grant, which
-- gives a seal only while a founder seat is left. This migration opens the
-- two normal ways to it; giving the seal by hand stays a repair.
--
--   1. founder_coupons: a code the platform admin makes on /teacher/founders,
--      general (he types it, for a post) or personal (the app draws it, one
--      use). Kept only as the sha256 of the code made normal (Q1 of 12/11):
--      a dump of public holds no code that makes anyone a founder. With a
--      brand, a validity and a number of uses, written by the admin, never
--      in the code. Never deleted: a coupon ends by its validity.
--   2. founder_coupon_redemptions: who used which coupon, one row per coupon
--      and person (the primary key): a coupon counts once per person, also
--      after her seal is taken back.
--   3. founder_invites: a founder invite for one e-mail, written by the
--      platform admin on /teacher/invites. The seal comes on the first
--      confirmation of that e-mail, or at once when an account is already
--      confirmed with it (Q3 of 12/11).
--   4. signup_origins: where a signup came from, only 'grifoai' (Q4 of
--      13/11), written by the first confirmation from the metadata, read by
--      the platform admin alone. Not on profiles, which the person rewrites.
--
-- Every seal given here goes through badge_grant, source 'coupon' or
-- 'invite'. With no seat left a coupon spends no use and an invite stays
-- open. A coupon typed at the signup waits in the metadata of the account
-- (Q2 of 12/11) and is redeemed by the first confirmation, after the
-- signup made her a student, because the brand of the coupon is checked
-- against the organization she studies in.
--
-- One function is recreated with its name, its trigger and its ACL:
-- accept_organization_invites_on_confirmation (0058's body, and after it
-- the founder invites, the coupon and the origin). Every function the
-- confirmation calls returns instead of raising, so a confirmation never
-- fails because of a coupon, an invite or an origin.
-- scripts/restore-outside-public.sql does not change.
--
-- Measured on 2026-11-13 through the MCP, read only, before this was written:
-- migrations applied through 0058; auth.users 7 accounts, 1 unconfirmed, none
-- with signup, founder_coupon or origin in the metadata, so applying this
-- redeems nothing and records no origin; person_badges 0 rows,
-- founder_program 0 rows, plans 0 rows; no table or function named coupon,
-- founder_inv or origin; organizations chelsea-st (open_signup), grifoai and
-- empresa-teste; the trigger function's body is 0058's, executable by its
-- owner alone ({postgres=X/postgres}); Postgres 17.6, sha256(bytea) native.
-- No existing row changes here.
--
-- A refusal raised here names its constraint twice: in the error, for
-- scripts/verify-rls.sql, and at the start of the message, because the API
-- passes the message on and not the constraint. No message carries a code.


-- The coupons -------------------------------------------------------------------

create table public.founder_coupons (
  id uuid primary key default gen_random_uuid(),
  -- Common, like person_badges: a coupon belongs to the platform.
  organization_id uuid references public.organizations on delete restrict
    constraint founder_coupons_is_common check (organization_id is null),
  -- The brand whose students may redeem it: the list of plans_brand_known.
  brand text not null
    constraint founder_coupons_brand_known check (brand in ('chelsea-st', 'grifoai')),
  -- sha256 of the code made normal (founder_coupon_hash). Never the code.
  code_hash bytea not null
    constraint founder_coupons_code_hash_key unique,
  label text not null
    constraint founder_coupons_label_length check (char_length(btrim(label)) between 1 and 120),
  max_uses integer not null
    constraint founder_coupons_max_uses_positive check (max_uses > 0),
  expires_at timestamptz not null,
  created_by uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.founder_coupons is
  'The founder coupons, made by the platform admin: a code kept only as its sha256, a brand, a validity and a number of uses. Read and changed (label, max_uses, expires_at) by the platform admin alone; created only by create_founder_coupon; never deleted, a coupon ends by its validity (the screen ends one by writing expires_at with the server''s clock, so no check ties it to created_at).';
comment on column public.founder_coupons.code_hash is
  'sha256 of the code in capitals without spaces or hyphens (founder_coupon_hash). The code itself is shown once, when made, and stored nowhere.';

alter table public.founder_coupons enable row level security;

create policy founder_coupons_read on public.founder_coupons
  for select to authenticated
  using ((select public.is_platform_admin()));
create policy founder_coupons_update on public.founder_coupons
  for update to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));

grant select on public.founder_coupons to authenticated;
grant update (label, max_uses, expires_at) on public.founder_coupons to authenticated;

create table public.founder_coupon_redemptions (
  organization_id uuid references public.organizations on delete restrict
    constraint founder_coupon_redemptions_is_common check (organization_id is null),
  -- A coupon used is never deleted: its uses are its history.
  coupon_id uuid not null references public.founder_coupons on delete restrict,
  person_id uuid not null references public.profiles on delete cascade,
  redeemed_at timestamptz not null default now(),
  -- A coupon counts once per person.
  constraint founder_coupon_redemptions_pkey primary key (coupon_id, person_id)
);

create index founder_coupon_redemptions_person_idx
  on public.founder_coupon_redemptions (person_id);

comment on table public.founder_coupon_redemptions is
  'Who used which founder coupon: one row per coupon and person, written only by redeem_founder_coupon when the seal is given. A coupon whose seal finds no seat writes no row. Read by the platform admin alone.';

alter table public.founder_coupon_redemptions enable row level security;

create policy founder_coupon_redemptions_read on public.founder_coupon_redemptions
  for select to authenticated
  using ((select public.is_platform_admin()));

grant select on public.founder_coupon_redemptions to authenticated;


-- The founder invites -------------------------------------------------------------

create table public.founder_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations on delete restrict
    constraint founder_invites_is_common check (organization_id is null),
  -- The format of organization_invites (0031): lower-cased and trimmed, as
  -- auth.users keeps it.
  email text not null
    constraint founder_invites_email_check
    check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  invited_by uuid default auth.uid() references public.profiles on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- One open founder invite per e-mail: sending again renews this one.
create unique index founder_invites_one_open
  on public.founder_invites (email) where accepted_at is null;

comment on table public.founder_invites is
  'A founder invite for one e-mail, written by the platform admin on /teacher/invites. The seal comes on the first confirmation of that e-mail (accept_founder_invites), or when the invite is written or renewed for an account already confirmed (founder_invites_grant_confirmed). With no seat left it stays open. Read, written, renewed (expires_at) and cancelled (open only) by the platform admin alone.';

alter table public.founder_invites enable row level security;

create policy founder_invites_read on public.founder_invites
  for select to authenticated
  using ((select public.is_platform_admin()));
create policy founder_invites_insert on public.founder_invites
  for insert to authenticated
  with check ((select public.is_platform_admin()) and invited_by is not distinct from (select auth.uid()));
-- Only an open invite is renewed or cancelled: an accepted one is the record
-- of how a founder came.
create policy founder_invites_renew on public.founder_invites
  for update to authenticated
  using (accepted_at is null and (select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));
create policy founder_invites_cancel on public.founder_invites
  for delete to authenticated
  using (accepted_at is null and (select public.is_platform_admin()));

grant select, insert, delete on public.founder_invites to authenticated;
grant update (expires_at) on public.founder_invites to authenticated;


-- The origin of a signup --------------------------------------------------------------

create table public.signup_origins (
  person_id uuid primary key references public.profiles on delete cascade,
  organization_id uuid references public.organizations on delete restrict
    constraint signup_origins_is_common check (organization_id is null),
  origin text not null
    constraint signup_origins_known check (origin in ('grifoai')),
  created_at timestamptz not null default now()
);

comment on table public.signup_origins is
  'Where a signup came from (/cadastro?origem=grifoai, the Chelsea St section of the GrifoAI landing): one row per person, written only by the first confirmation from the metadata (record_signup_origin), read by the platform admin alone. The person never changes it.';

alter table public.signup_origins enable row level security;

create policy signup_origins_read on public.signup_origins
  for select to authenticated
  using ((select public.is_platform_admin()));

grant select on public.signup_origins to authenticated;


-- The functions of the coupon --------------------------------------------------------

-- A code made normal: capitals, without spaces or hyphens, so "abcd-efgh"
-- and "ABCD EFGH" are the same code. Its sha256 is what is stored.
create function public.founder_coupon_hash(p_code text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g')),
    'UTF8'));
$$;

comment on function public.founder_coupon_hash(text) is
  'sha256 of a coupon code in capitals, without spaces or hyphens. Executed by nobody outside: the coupon functions call it.';

-- The platform admin makes a coupon. The code is hashed here, in the
-- database, so it never reaches a table.
create function public.create_founder_coupon(
  p_code text, p_label text, p_brand text, p_max_uses integer, p_expires_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g'));
  v_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'only the platform admin makes a founder coupon'
      using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_code) not between 6 and 64 then
    raise exception 'founder_coupons_code_length: a coupon code has 6 to 64 letters or digits'
      using errcode = 'check_violation', constraint = 'founder_coupons_code_length';
  end if;
  insert into public.founder_coupons (brand, code_hash, label, max_uses, expires_at, created_by)
    values (p_brand, public.founder_coupon_hash(v_code), btrim(p_label), p_max_uses, p_expires_at,
            (select auth.uid()))
    returning id into v_id;
  return v_id;
end;
$$;

comment on function public.create_founder_coupon(text, text, text, integer, timestamptz) is
  'The platform admin makes a founder coupon; the code is stored as its sha256 only. Refuses anyone else (42501), a code shorter than 6 or longer than 64 once made normal (founder_coupons_code_length) and a code already used (founder_coupons_code_hash_key).';

-- The redemption, for a person: never raises, returns what happened.
-- granted, already_founder (no use spent), not_found, expired, repeated (she
-- used it before, even with her seal taken back), other_brand (she studies
-- in no organization of its brand), exhausted, no_seats (badge_grant found no
-- seat: no use spent) or failed. The coupon's row is locked first, so two
-- redemptions of its last use give one; badge_grant locks the seats.
create function public.redeem_founder_coupon(p_person uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coupon public.founder_coupons;
  v_name text;
begin
  select c.* into v_coupon from public.founder_coupons c
   where c.code_hash = public.founder_coupon_hash(p_code)
     for update;
  if not found then
    return 'not_found';
  end if;

  if exists (select 1 from public.person_badges b
              where b.person_id = p_person and b.badge = 'founder' and b.revoked_at is null) then
    return 'already_founder';
  end if;
  if v_coupon.expires_at <= now() then
    return 'expired';
  end if;
  if exists (select 1 from public.founder_coupon_redemptions r
              where r.coupon_id = v_coupon.id and r.person_id = p_person) then
    return 'repeated';
  end if;
  if not exists (select 1 from public.organization_members m
                   join public.organizations o on o.id = m.organization_id
                  where m.user_id = p_person and m.role = 'student' and o.brand = v_coupon.brand) then
    return 'other_brand';
  end if;
  if (select count(*) from public.founder_coupon_redemptions r
       where r.coupon_id = v_coupon.id) >= v_coupon.max_uses then
    return 'exhausted';
  end if;

  begin
    perform public.badge_grant(p_person, 'founder', 'coupon', v_coupon.created_by);
  exception when check_violation then
    get stacked diagnostics v_name = constraint_name;
    if v_name = 'founder_seats_available' then
      return 'no_seats';
    end if;
    raise;
  end;
  -- After the seal, never before: a coupon spends no use without a seal.
  insert into public.founder_coupon_redemptions (coupon_id, person_id)
    values (v_coupon.id, p_person);
  return 'granted';
exception when others then
  -- The state only: no code, no address.
  raise warning 'redeem_founder_coupon failed: %', sqlstate;
  return 'failed';
end;
$$;

comment on function public.redeem_founder_coupon(uuid, text) is
  'Redeems a founder coupon for a person and returns what happened (granted, already_founder, not_found, expired, repeated, other_brand, exhausted, no_seats, failed). Never raises: the confirmation trigger calls it. Executed by nobody.';

-- The screen's door: /dashboard/plano, for the person signed in. Every
-- refusal is raised by the name of its rule; already_founder is no refusal.
create function public.redeem_my_founder_coupon(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_result text;
begin
  if v_user is null then
    raise exception 'a coupon is redeemed signed in'
      using errcode = 'insufficient_privilege';
  end if;
  v_result := public.redeem_founder_coupon(v_user, p_code);
  case v_result
    when 'granted', 'already_founder' then
      return v_result;
    when 'not_found' then
      raise exception 'founder_coupon_exists: no founder coupon has this code'
        using errcode = 'check_violation', constraint = 'founder_coupon_exists';
    when 'expired' then
      raise exception 'founder_coupon_expired: the founder coupon has expired'
        using errcode = 'check_violation', constraint = 'founder_coupon_expired';
    when 'repeated' then
      raise exception 'founder_coupon_once_per_person: this person already used the founder coupon'
        using errcode = 'check_violation', constraint = 'founder_coupon_once_per_person';
    when 'other_brand' then
      raise exception 'founder_coupon_brand: the founder coupon is of another brand'
        using errcode = 'check_violation', constraint = 'founder_coupon_brand';
    when 'exhausted' then
      raise exception 'founder_coupon_exhausted: the founder coupon has no use left'
        using errcode = 'check_violation', constraint = 'founder_coupon_exhausted';
    when 'no_seats' then
      raise exception 'founder_coupon_seats: no founder seat is left'
        using errcode = 'check_violation', constraint = 'founder_coupon_seats';
    else
      raise exception 'founder_coupon_redeemed: the founder coupon could not be redeemed now'
        using errcode = 'internal_error';
  end case;
end;
$$;

comment on function public.redeem_my_founder_coupon(text) is
  'The person signed in redeems a founder coupon: granted or already_founder, or a refusal named by its rule (founder_coupon_exists, founder_coupon_expired, founder_coupon_once_per_person, founder_coupon_brand, founder_coupon_exhausted, founder_coupon_seats). Executed by authenticated alone.';


-- The functions of the founder invite ---------------------------------------------------

-- Every open founder invite of this e-mail, for the account that just
-- confirmed it: the seal, then accepted_at. With no seat left, the invite
-- stays open. Never raises.
create function public.accept_founder_invites(p_user uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.founder_invites;
  v_name text;
begin
  for v_invite in
    select i.* from public.founder_invites i
     where i.email = lower(btrim(p_email))
       and i.accepted_at is null
       and i.expires_at > now()
       for update
  loop
    begin
      perform public.badge_grant(p_user, 'founder', 'invite', v_invite.invited_by);
    exception when check_violation then
      get stacked diagnostics v_name = constraint_name;
      if v_name = 'founder_seats_available' then
        return;
      end if;
      raise;
    end;
    update public.founder_invites set accepted_at = now() where id = v_invite.id;
  end loop;
exception when others then
  -- The state only: the message of a failed write may carry the address.
  raise warning 'accept_founder_invites failed: %', sqlstate;
end;
$$;

comment on function public.accept_founder_invites(uuid, text) is
  'Gives the seal (badge_grant, source invite, granted_by who invited) for every open founder invite of this e-mail, and marks it accepted; with no seat left the invite stays open. Called by the trigger of the first confirmation; never raises. Executed by nobody.';

-- A founder invite written, or renewed, for an e-mail an account already
-- confirmed: the seal now, there is no confirmation to come (Q3 of 12/11).
-- With no seat left the write is refused (founder_seats_available), so the
-- admin knows at once.
create function public.founder_invites_grant_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if new.accepted_at is not null or new.expires_at <= now() then
    return new;
  end if;
  select u.id into v_user
    from auth.users u
    join public.profiles p on p.id = u.id
   where lower(u.email) = new.email
     and u.email_confirmed_at is not null
   order by u.id
   limit 1;
  if v_user is null then
    return new;
  end if;
  perform public.badge_grant(v_user, 'founder', 'invite', new.invited_by);
  update public.founder_invites set accepted_at = now() where id = new.id;
  return new;
end;
$$;

create trigger founder_invites_grant_confirmed
  after insert or update of expires_at on public.founder_invites
  for each row execute function public.founder_invites_grant_confirmed();


-- The origin --------------------------------------------------------------------------

-- The origin in the metadata of a first confirmation. A value outside
-- signup_origins_known is refused by the check and recorded as nothing.
-- Never raises.
create function public.record_signup_origin(p_user uuid, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(p_meta ->> 'origin', '') is null then
    return;
  end if;
  insert into public.signup_origins (person_id, origin)
    values (p_user, p_meta ->> 'origin')
    on conflict (person_id) do nothing;
exception when others then
  raise warning 'record_signup_origin failed: %', sqlstate;
end;
$$;

comment on function public.record_signup_origin(uuid, jsonb) is
  'Records the origin of a signup from the metadata of its first confirmation, only a value signup_origins_known takes. Never raises. Executed by nobody.';


-- The first confirmation ------------------------------------------------------------------

-- 0058's body, and after it, in this order: the founder invites of the
-- e-mail, the coupon of the signup (after join_by_signup, which made her a
-- student: the brand of the coupon is hers), and the origin.
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
    perform bind_personal_plans(new.id, new.email);
    perform accept_founder_invites(new.id, new.email);
    if nullif(new.raw_user_meta_data ->> 'founder_coupon', '') is not null then
      perform redeem_founder_coupon(new.id, new.raw_user_meta_data ->> 'founder_coupon');
    end if;
    perform record_signup_origin(new.id, new.raw_user_meta_data);
  end if;
  return new;
end;
$$;


-- Who executes what (0047) --------------------------------------------------------

revoke all on function public.founder_coupon_hash(text) from public, anon, authenticated, service_role;
revoke all on function public.create_founder_coupon(text, text, text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.redeem_founder_coupon(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.redeem_my_founder_coupon(text) from public, anon, authenticated, service_role;
revoke all on function public.accept_founder_invites(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.founder_invites_grant_confirmed() from public, anon, authenticated, service_role;
revoke all on function public.record_signup_origin(uuid, jsonb) from public, anon, authenticated, service_role;
-- The recreated one keeps its ACL through create or replace; said again.
revoke all on function public.accept_organization_invites_on_confirmation() from public, anon, authenticated, service_role;

grant execute on function public.create_founder_coupon(text, text, text, integer, timestamptz) to authenticated;
grant execute on function public.redeem_my_founder_coupon(text) to authenticated;
