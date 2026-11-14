-- A founder keeps a door (issue #292, ADR 0006, ADR 0007).
--
-- The Plano Fundador is sold before the launch and only to founders. The
-- Founder seal is what makes someone a founder: the right to subscribe to
-- the Plano Fundador, at the founder's price, to stay in it and to come back
-- to it after switching or cancelling, for life. The seal does not change
-- what a lesson costs; the plan does. A Plano Fundador Personalizado is made
-- by the platform admin for one e-mail, and reaches the account that
-- confirms that e-mail.
--
-- What this migration holds (the plan of 13/11 on #292, Q1 to Q6 answered A):
--
--   1. person_badges: one row per seal given, never deleted. A revoked seal
--      keeps its row (revoked_at); a seal given again is a new row. One live
--      seal per person and kind. Nobody writes it through the API: only the
--      functions below. Nothing ties it to a subscription, which is what
--      makes it for life.
--   2. The founder's terms, on the seal: the prices, the credits of a month,
--      the ceiling, the days after a cancel and the cost of a lesson of her
--      first Plano Fundador subscription that was paid (Luiz, 13/11 02:02:
--      the founder's price is guaranteed for ever, also after leaving and
--      coming back). Fixed by person_badges_fix_terms on the first 'active'
--      of a founder subscription; a founder who comes back subscribes with
--      them, and billing_open_subscription refuses another value.
--   3. founder_program: one row, the total of founder seats. A seat is a
--      live seal. badge_grant locks this row and refuses with no seat left,
--      for the admin too. founder_seats_left() gives the landing the number
--      left, to anon: the second security definer anon executes, beside
--      submit_lead.
--   4. plans.audience: 'public' (everyone), 'founder' (who holds a live
--      seal) or 'person' (one person, by e-mail). Three read policies, and
--      billing_open_subscription refuses a plan outside her audience
--      (billing_plan_audience). The last active founder plan of a brand
--      never leaves sale (plans_founder_stays_on_sale).
--   5. The personal plan: plans.person_email, and plans.person_id once an
--      account confirmed with that e-mail; bound when written (an account
--      already confirmed) or on the first confirmation, and bound for good.
--   6. The cost of a lesson by plan: plans.teacher_lesson_credits (null: the
--      brand's cost), copied onto the subscription when it is born, and read
--      by credit_price from the subscription that counts.
--   7. A plan without the trail: trail_minutes_per_day 0.
--
-- Four functions are recreated with their signatures, names, triggers and
-- ACLs: billing_open_subscription (0049), credit_subscription_copies_plan and
-- credit_price (0050), accept_organization_invites_on_confirmation (0051).
-- Each keeps its whole previous body and adds what is said where it is.
-- scripts/restore-outside-public.sql does not change: the trigger on
-- auth.users keeps its name and its function.
--
-- Measured on 2026-11-13 through the MCP, read only, before this was written:
-- migrations applied through 0056 (0053 and 0055 never existed); plans 0
-- rows, subscriptions 0, credit_entries 0, credit_costs 1; the four policies
-- of plans are 0049's; no table or function named badge, founder, seat,
-- coupon or personal; organization_invites with no open invite; auth.users
-- 7 accounts, 1 unconfirmed; no citext and no dblink extension; Postgres
-- 17.6. No existing row changes here: plans and subscriptions are empty, and
-- the new columns have a default or are null.
--
-- The e-mail of a personal plan is text kept lower-cased and trimmed, the
-- format of organization_invites (0031), and compared with lower(): the
-- project has no citext, and this needs no extension.
--
-- A refusal raised here names its constraint twice: in the error, for
-- scripts/verify-rls.sql, and at the start of the message, because the API
-- passes the message on and not the constraint.


-- The seal ----------------------------------------------------------------------

create table public.person_badges (
  id uuid primary key default gen_random_uuid(),
  -- Common, like plans: a seal belongs to a person, not to an organization.
  organization_id uuid references public.organizations on delete restrict
    constraint person_badges_is_common check (organization_id is null),
  -- Deleting the account deletes the seal; the money lives in the ledger.
  person_id uuid not null references public.profiles on delete cascade,
  badge text not null
    constraint person_badges_badge_known check (badge in ('founder')),
  -- How it came: by the platform admin (a repair since 13/11), a coupon or an
  -- invite (#296). Born with the three so #296 does not rewrite the check.
  source text not null
    constraint person_badges_source_known check (source in ('admin', 'coupon', 'invite')),
  granted_by uuid references public.profiles on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles on delete set null,
  -- The founder's terms (item 2 above), null until her first founder
  -- subscription is paid. The cost of a lesson may stay null within whole
  -- terms: null is the brand's cost, as on the plan.
  terms_monthly_price_cents integer,
  terms_annual_price_cents integer,
  terms_monthly_credits integer,
  terms_teacher_lesson_credits integer,
  terms_credit_ceiling_months smallint,
  terms_credit_days_after_cancel smallint,
  terms_fixed_at timestamptz,
  constraint person_badges_terms_whole check (
    (terms_fixed_at is null
     and terms_monthly_price_cents is null and terms_annual_price_cents is null
     and terms_monthly_credits is null and terms_teacher_lesson_credits is null
     and terms_credit_ceiling_months is null and terms_credit_days_after_cancel is null)
    or
    (terms_fixed_at is not null
     and terms_monthly_price_cents is not null and terms_annual_price_cents is not null
     and terms_monthly_credits is not null
     and terms_credit_ceiling_months is not null and terms_credit_days_after_cancel is not null)),
  -- The ranges of the plan's own columns (0049, 0050).
  constraint person_badges_terms_ranges check (
    (terms_monthly_price_cents is null or terms_monthly_price_cents > 0)
    and (terms_annual_price_cents is null or terms_annual_price_cents > 0)
    and (terms_monthly_credits is null or terms_monthly_credits >= 0)
    and (terms_teacher_lesson_credits is null or terms_teacher_lesson_credits > 0)
    and (terms_credit_ceiling_months is null or terms_credit_ceiling_months between 1 and 60)
    and (terms_credit_days_after_cancel is null or terms_credit_days_after_cancel between 0 and 365))
);

-- One live seal per person and kind.
create unique index person_badges_one_live
  on public.person_badges (person_id, badge) where revoked_at is null;

comment on table public.person_badges is
  'The seals given to a person, one row per grant, never deleted: revoking writes revoked_at, giving again is a new row. The Founder seal is the right to subscribe to the Plano Fundador at the founder''s terms, to stay in it and to come back to it, for life: nothing here follows a subscription. Read by the person and the platform admin; written only by badge_grant, grant_badge, revoke_badge and the trigger that fixes the terms.';
comment on column public.person_badges.terms_fixed_at is
  'When the founder''s terms were fixed: the first time a Plano Fundador subscription of hers became active. The terms_* columns are that subscription''s, and a founder who comes back subscribes with them.';

alter table public.person_badges enable row level security;

create policy person_badges_read on public.person_badges
  for select to authenticated
  using (person_id = (select auth.uid()) or (select public.is_platform_admin()));

grant select on public.person_badges to authenticated;


-- The seats ---------------------------------------------------------------------

create table public.founder_program (
  -- One row: true, or none.
  id boolean primary key default true
    constraint founder_program_one_row check (id),
  seats_total integer not null
    constraint founder_program_seats_not_negative check (seats_total >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null
);

comment on table public.founder_program is
  'The founder seats: one row with the total, written by the platform admin on /teacher/founders. A seat is a live Founder seal; a seal revoked gives its seat back, a cancelled subscription does not touch the seal. No row: no seat, and badge_grant refuses. The number never enters the repository.';

alter table public.founder_program enable row level security;

create policy founder_program_read on public.founder_program
  for select to authenticated
  using ((select public.is_platform_admin()));
create policy founder_program_insert on public.founder_program
  for insert to authenticated
  with check ((select public.is_platform_admin()));
create policy founder_program_update on public.founder_program
  for update to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));

grant select, insert, update on public.founder_program to authenticated;

-- Who changed the total and when, by the database and not by the screen.
create function public.founder_program_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create trigger founder_program_stamped
  before insert or update on public.founder_program
  for each row execute function public.founder_program_stamp();


-- The functions of the seal -------------------------------------------------------

-- Whether the caller holds a live seal of the kind. security invoker: she
-- reads her own seals under person_badges_read. The policy of founder plans
-- calls it.
create function public.holds_badge(p_badge text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from public.person_badges b
                  where b.person_id = (select auth.uid())
                    and b.badge = p_badge
                    and b.revoked_at is null);
$$;

comment on function public.holds_badge(text) is
  'Whether the caller holds a live seal of this kind. Read by the policy plans_read_founder and by the screens.';

-- The one door a seal comes through. Idempotent: a person with a live seal
-- gets its id back and spends no seat. Locks the row of founder_program
-- first, so two grants of the last seat give one seal; with no row, or no
-- seat left, refuses (founder_seats_available). A seal given again after one
-- was revoked inherits the terms of the last one that had them: revoking is
-- a correction, it never resets the guaranteed price. Executed by its owner
-- alone: grant_badge calls it, and #296 calls it from its coupon and invite.
create function public.badge_grant(p_person uuid, p_badge text, p_source text, p_granted_by uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_id uuid;
  v_terms public.person_badges;
begin
  select f.seats_total into v_total from public.founder_program f where f.id for update;

  select b.id into v_id from public.person_badges b
   where b.person_id = p_person and b.badge = p_badge and b.revoked_at is null;
  if v_id is not null then
    return v_id;
  end if;

  if v_total is null
     or v_total <= (select count(*) from public.person_badges b
                     where b.badge = p_badge and b.revoked_at is null) then
    raise exception 'founder_seats_available: no founder seat is left'
      using errcode = 'check_violation', constraint = 'founder_seats_available';
  end if;

  select b.* into v_terms from public.person_badges b
   where b.person_id = p_person and b.badge = p_badge and b.terms_fixed_at is not null
   order by b.revoked_at desc nulls last, b.granted_at desc
   limit 1;

  insert into public.person_badges (
    person_id, badge, source, granted_by,
    terms_monthly_price_cents, terms_annual_price_cents, terms_monthly_credits,
    terms_teacher_lesson_credits, terms_credit_ceiling_months,
    terms_credit_days_after_cancel, terms_fixed_at
  ) values (
    p_person, p_badge, p_source, p_granted_by,
    v_terms.terms_monthly_price_cents, v_terms.terms_annual_price_cents, v_terms.terms_monthly_credits,
    v_terms.terms_teacher_lesson_credits, v_terms.terms_credit_ceiling_months,
    v_terms.terms_credit_days_after_cancel, v_terms.terms_fixed_at
  ) returning id into v_id;
  return v_id;
end;
$$;

comment on function public.badge_grant(uuid, text, text, uuid) is
  'Gives a person the seal, or returns her live one. Refuses with no founder seat left (founder_seats_available), locking founder_program so two grants of the last seat give one. A seal given again inherits the terms of the last one that had them. Executed by its owner alone.';

-- The platform admin's door: a repair (13/11), for who forgot the coupon,
-- signed up before the coupons, or whom Luiz decides to make a founder.
create function public.grant_badge(p_person uuid, p_badge text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only the platform admin gives a seal'
      using errcode = 'insufficient_privilege';
  end if;
  return public.badge_grant(p_person, p_badge, 'admin', (select auth.uid()));
end;
$$;

comment on function public.grant_badge(uuid, text) is
  'The platform admin gives a person the seal (badge_grant, source admin). Refuses (42501) anyone else, so nobody gives herself a seal.';

create function public.revoke_badge(p_person uuid, p_badge text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only the platform admin revokes a seal'
      using errcode = 'insufficient_privilege';
  end if;
  update public.person_badges
     set revoked_at = now(), revoked_by = (select auth.uid())
   where person_id = p_person and badge = p_badge and revoked_at is null;
  return found;
end;
$$;

comment on function public.revoke_badge(uuid, text) is
  'The platform admin revokes the live seal of a person: false when there was none. Gives the seat back; cancels no subscription. Refuses (42501) anyone else.';

-- The seats left, for the landing and the signup: only the number, null
-- when there is no total. Never who holds a seal.
create function public.founder_seats_left()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (select greatest(f.seats_total
                          - (select count(*) from public.person_badges b
                              where b.badge = 'founder' and b.revoked_at is null),
                          0)::integer
            from public.founder_program f);
$$;

comment on function public.founder_seats_left() is
  'How many founder seats are left: the total less the live Founder seals, never below 0; null with no total. Executed by anon too, the second security definer anon executes beside submit_lead: it takes no argument and returns one number.';


-- Who sees a plan, and the cost of its lesson --------------------------------------

alter table public.plans
  add column audience text not null default 'public'
    constraint plans_audience_known check (audience in ('public', 'founder', 'person')),
  add column person_email text
    constraint plans_person_email_shape
      check (person_email = lower(btrim(person_email))
             and person_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column person_id uuid references public.profiles on delete restrict,
  add column teacher_lesson_credits integer
    constraint plans_teacher_lesson_credits_positive
      check (teacher_lesson_credits is null or teacher_lesson_credits > 0),
  add constraint plans_founder_is_chelsea_st check (audience = 'public' or brand = 'chelsea-st'),
  add constraint plans_personal_has_email check ((audience = 'person') = (person_email is not null)),
  add constraint plans_person_only_personal check (person_id is null or audience = 'person');

-- 0 is a plan that does not open the trail (approved on 12/11).
alter table public.plans drop constraint plans_trail_minutes_range;
alter table public.plans add constraint plans_trail_minutes_range
  check (trail_minutes_per_day between 0 and 240);

comment on column public.plans.audience is
  'Who reads and subscribes to the plan: public (everyone, anon too), founder (who holds a live Founder seal) or person (the account bound in person_id). Founder and person plans are Chelsea St''s only.';
comment on column public.plans.person_email is
  'The e-mail a Plano Fundador Personalizado was made for, lower-cased. The plan reaches the account that confirms it (person_id).';
comment on column public.plans.person_id is
  'The account a personal plan is bound to: the one confirmed with person_email, bound when the plan is written or on the first confirmation. Bound for good.';
comment on column public.plans.teacher_lesson_credits is
  'What a lesson with a teacher costs a subscriber of this plan, in credits; null is the brand''s cost in credit_costs. Copied onto each new subscription.';
comment on column public.plans.trail_minutes_per_day is
  'The minutes of the trail a day; 0 is a plan without the trail.';

drop policy plans_read_active on public.plans;
create policy plans_read_active on public.plans
  for select to anon, authenticated
  using (is_active and audience = 'public');
-- Two more policies, and not one: anon never reaches holds_badge, which it
-- may not execute (0047).
create policy plans_read_founder on public.plans
  for select to authenticated
  using (is_active and audience = 'founder' and (select public.holds_badge('founder')));
create policy plans_read_personal on public.plans
  for select to authenticated
  using (is_active and audience = 'person' and person_id = (select auth.uid()));

-- The last active founder plan of a brand never leaves sale, nor its
-- audience: a founder must always find one to stay in or come back to
-- (Luiz, 12/11 19:14). The admin makes a new one active first, then retires
-- the old. security definer: it counts every plan, past row level security.
create function public.plans_founder_stays_on_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.audience = 'founder' and old.is_active
     and (not new.is_active or new.audience <> 'founder') then
    -- Two retirements at once wait for each other.
    perform 1 from public.plans p
     where p.brand = old.brand and p.audience = 'founder' and p.is_active
       for update;
    if not exists (select 1 from public.plans p
                    where p.brand = old.brand and p.audience = 'founder' and p.is_active
                      and p.id <> old.id) then
      raise exception 'plans_founder_stays_on_sale: plan % is the last founder plan on sale', old.id
        using errcode = 'check_violation', constraint = 'plans_founder_stays_on_sale';
    end if;
  end if;
  return new;
end;
$$;

create trigger plans_founder_stays_on_sale
  before update of is_active, audience on public.plans
  for each row execute function public.plans_founder_stays_on_sale();

-- A personal plan written for the e-mail of an account already confirmed is
-- born bound to it. security definer: it reads auth.users.
create function public.plans_bind_personal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.audience = 'person' and new.person_id is null and new.person_email is not null then
    select u.id into new.person_id
      from auth.users u
      join public.profiles p on p.id = u.id
     where lower(u.email) = new.person_email
       and u.email_confirmed_at is not null
     order by u.id
     limit 1;
  end if;
  return new;
end;
$$;

create trigger plans_bind_personal
  before insert or update of person_email on public.plans
  for each row execute function public.plans_bind_personal();

-- Bound, it stays bound: for another person, another plan.
create function public.plans_personal_bound_for_good()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.person_id is not null
     and (new.person_email is distinct from old.person_email
          or new.person_id is distinct from old.person_id) then
    raise exception 'plans_personal_bound_for_good: plan % is bound to its person', old.id
      using errcode = 'check_violation', constraint = 'plans_personal_bound_for_good';
  end if;
  return new;
end;
$$;

create trigger plans_personal_bound_for_good
  before update of person_email, person_id on public.plans
  for each row execute function public.plans_personal_bound_for_good();

-- Binds the personal plans waiting for this e-mail to the account that just
-- confirmed it. Never raises: a confirmation never fails because of it (the
-- confirmation trigger calls it). Executed by nobody.
create function public.bind_personal_plans(p_user uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.plans
     set person_id = p_user, updated_at = now()
   where audience = 'person'
     and person_id is null
     and person_email = lower(btrim(p_email));
exception when others then
  -- The state only: the message of a failed write may carry the address.
  raise warning 'bind_personal_plans failed: %', sqlstate;
end;
$$;

comment on function public.bind_personal_plans(uuid, text) is
  'Binds every personal plan still waiting for this e-mail to the account. Called by the trigger of the first confirmation; never raises. Executed by nobody.';

-- 0051's body, and the personal plans after the signup.
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
  end if;
  return new;
end;
$$;


-- The cost of a lesson by plan ---------------------------------------------------

alter table public.subscriptions
  add column teacher_lesson_credits integer
    constraint subscriptions_teacher_lesson_credits_positive
      check (teacher_lesson_credits is null or teacher_lesson_credits > 0);

comment on column public.subscriptions.teacher_lesson_credits is
  'What a lesson costs under this subscription, copied when the row is made from its plan, or from the founder''s terms when she comes back to the Plano Fundador (subscriptions_credits_from_plan). Null is the brand''s cost. A change to the plan later does not reach it.';

-- 0050's body, plus the cost of a lesson, and, for a Plano Fundador
-- subscription of a founder whose terms are fixed, the terms instead of the
-- plan's numbers.
create or replace function public.credit_subscription_copies_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_audience text;
  v_terms public.person_badges;
begin
  select p.monthly_credits, p.credit_ceiling_months, p.credit_days_after_cancel,
         p.teacher_lesson_credits, p.audience
    into new.monthly_credits, new.credit_ceiling_months, new.credit_days_after_cancel,
         new.teacher_lesson_credits, v_audience
    from public.plans p
   where p.id = new.plan_id;

  if v_audience = 'founder' then
    select b.* into v_terms from public.person_badges b
     where b.person_id = new.person_id and b.badge = 'founder'
       and b.revoked_at is null and b.terms_fixed_at is not null;
    if found then
      new.monthly_credits := v_terms.terms_monthly_credits;
      new.credit_ceiling_months := v_terms.terms_credit_ceiling_months;
      new.credit_days_after_cancel := v_terms.terms_credit_days_after_cancel;
      new.teacher_lesson_credits := v_terms.terms_teacher_lesson_credits;
    end if;
  end if;
  return new;
end;
$$;

-- The founder's terms are fixed by her first Plano Fundador subscription that
-- is paid: the first time it turns active, while her live seal has none. A
-- checkout given up or a Pix never paid fixes nothing. The price of her
-- cycle is the subscription's value; the other cycle's is the plan's at that
-- moment.
create function public.person_badges_fix_terms()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    update public.person_badges b
       set terms_monthly_price_cents =
             case when new.cycle = 'monthly' then new.value_cents else p.monthly_price_cents end,
           terms_annual_price_cents =
             case when new.cycle = 'annual' then new.value_cents else p.annual_price_cents end,
           terms_monthly_credits = new.monthly_credits,
           terms_teacher_lesson_credits = new.teacher_lesson_credits,
           terms_credit_ceiling_months = new.credit_ceiling_months,
           terms_credit_days_after_cancel = new.credit_days_after_cancel,
           terms_fixed_at = now()
      from public.plans p
     where p.id = new.plan_id
       and p.audience = 'founder'
       and b.person_id = new.person_id
       and b.badge = 'founder'
       and b.revoked_at is null
       and b.terms_fixed_at is null;
  end if;
  return new;
end;
$$;

create trigger person_badges_fix_terms
  after update of status on public.subscriptions
  for each row execute function public.person_badges_fix_terms();

-- 0050's body, and before it the cost of a lesson by plan: the subscription
-- that counts is her latest alive one; with none alive, her latest one that
-- ran (a cancel that is not replaced, checkout_expired or trial_used), whose
-- credits she may still be spending. Its teacher_lesson_credits when it has
-- one; otherwise the brand's cost, as before. The seal is not read here.
create or replace function public.credit_price(p_person uuid, p_action text)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_brand text;
  v_credits integer;
begin
  if p_action = 'teacher_lesson' then
    select s.teacher_lesson_credits into v_credits
      from public.subscriptions s
     where s.person_id = p_person
       and s.status in ('trialing', 'awaiting', 'active', 'past_due')
     order by s.created_at desc, s.id desc
     limit 1;
    if not found then
      select s.teacher_lesson_credits into v_credits
        from public.subscriptions s
       where s.person_id = p_person
         and s.status = 'canceled'
         and s.cancel_reason not in ('replaced', 'checkout_expired', 'trial_used')
       order by s.canceled_at desc, s.created_at desc
       limit 1;
    end if;
    if v_credits is not null then
      return v_credits;
    end if;
  end if;

  select o.brand into v_brand
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
   where m.user_id = p_person
   order by (m.role = 'student') desc, m.created_at, o.id
   limit 1;
  select c.credits into v_credits
    from public.credit_costs c
   where c.brand = v_brand and c.action = p_action;
  if v_credits is null then
    raise exception 'credit_cost_known: % has no cost in credits in the brand of person % (%)', p_action, p_person, coalesce(v_brand, 'no organization')
      using errcode = 'check_violation', constraint = 'credit_cost_known';
  end if;
  return v_credits;
end;
$$;

comment on function public.credit_price(uuid, text) is
  'What one unit of the action costs the person. A lesson with a teacher: the teacher_lesson_credits of the subscription that counts (her latest alive, or with none alive her latest that ran) when it has one. Otherwise the row of credit_costs in the brand of her organization. Refuses an action without a cost there (credit_cost_known). Called by credit_cost, credit_debit, bookable_teachers and book_lesson only.';


-- Subscribing: who may, and at which value ------------------------------------------

-- 0049's body, plus two refusals after billing_plan_active: a plan outside
-- her audience (a founder plan without a live seal of hers, a personal plan
-- not bound to her) is billing_plan_audience; a value other than the one she
-- is owed (her seal's terms on a founder plan, once fixed; the plan's price
-- otherwise, for the cycle) is billing_value_matches. The app computes the
-- value; the database checks it, so an app that forgets the terms charges
-- nothing wrong in silence.
create or replace function public.billing_open_subscription(
  p_person uuid,
  p_plan uuid,
  p_cycle text,
  p_billing_type text,
  p_value_cents integer,
  p_with_trial boolean,
  p_first_due_on date,
  p_checkout_id text,
  p_customer_id text,
  p_subscription_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.billing_customers;
  v_plan public.plans;
  v_seal public.person_badges;
  v_has_seal boolean := false;
  v_value integer;
  v_status text;
  v_id uuid;
begin
  select * into v_customer from public.billing_customers where person_id = p_person;
  if not found then
    raise exception 'person % has no billing row', p_person
      using errcode = 'foreign_key_violation';
  end if;
  if p_with_trial and v_customer.trial_used_at is not null then
    raise exception 'billing_one_trial_per_person: person % already had her trial', p_person
      using errcode = 'check_violation', constraint = 'billing_one_trial_per_person';
  end if;
  select * into v_plan from public.plans
   where id = p_plan and is_active and brand = 'chelsea-st';
  if not found then
    raise exception 'billing_plan_active: plan % is not an active Chelsea St plan', p_plan
      using errcode = 'check_violation', constraint = 'billing_plan_active';
  end if;

  if v_plan.audience = 'founder' then
    select * into v_seal from public.person_badges
     where person_id = p_person and badge = 'founder' and revoked_at is null;
    v_has_seal := found;
  end if;
  if (v_plan.audience = 'founder' and not v_has_seal)
     or (v_plan.audience = 'person' and v_plan.person_id is distinct from p_person) then
    raise exception 'billing_plan_audience: plan % is not for person %', p_plan, p_person
      using errcode = 'check_violation', constraint = 'billing_plan_audience';
  end if;

  if v_has_seal and v_seal.terms_fixed_at is not null then
    v_value := case p_cycle when 'monthly' then v_seal.terms_monthly_price_cents
                            when 'annual' then v_seal.terms_annual_price_cents end;
  else
    v_value := case p_cycle when 'monthly' then v_plan.monthly_price_cents
                            when 'annual' then v_plan.annual_price_cents end;
  end if;
  -- An unknown cycle is left to subscriptions_cycle_known, as before.
  if v_value is not null and p_value_cents is distinct from v_value then
    raise exception 'billing_value_matches: % is not what person % pays for plan % (%)', p_value_cents, p_person, p_plan, p_cycle
      using errcode = 'check_violation', constraint = 'billing_value_matches';
  end if;

  update public.subscriptions
     set status = 'canceled', canceled_at = now(), cancel_reason = 'replaced', updated_at = now()
   where person_id = p_person and status = 'pending';

  v_status := case
    when p_checkout_id is not null then 'pending'
    when p_with_trial then 'trialing'
    -- No trial: nothing opens until the first charge is paid.
    else 'awaiting'
  end;

  insert into public.subscriptions (
    person_id, organization_id, plan_id, cycle, billing_type, value_cents,
    with_trial, first_due_on, asaas_checkout_id, asaas_customer_id,
    asaas_subscription_id, status
  ) values (
    p_person, v_customer.organization_id, p_plan, p_cycle, p_billing_type, p_value_cents,
    p_with_trial, p_first_due_on, p_checkout_id, p_customer_id,
    p_subscription_id, v_status
  ) returning id into v_id;

  if v_status = 'trialing' then
    update public.billing_customers set trial_used_at = now() where person_id = p_person;
  end if;
  return v_id;
end;
$$;

comment on function public.billing_open_subscription(uuid, uuid, text, text, integer, boolean, date, text, text, text) is
  'Opens a subscription for a person with a billing row: pending when it waits at a checkout, trialing or active when the provider already holds it. Refuses a second trial (billing_one_trial_per_person), an inactive or GrifoAI plan (billing_plan_active), a plan outside her audience (billing_plan_audience: a founder plan without her live seal, a personal plan not bound to her) and a value other than hers (billing_value_matches: her seal''s terms on a founder plan once fixed, the plan''s price otherwise). Cancels a pending one of hers as replaced.';


-- Who executes what (0047) --------------------------------------------------------

revoke all on function public.founder_program_stamp() from public, anon, authenticated, service_role;
revoke all on function public.holds_badge(text) from public, anon, authenticated, service_role;
revoke all on function public.badge_grant(uuid, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.grant_badge(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.revoke_badge(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.founder_seats_left() from public, anon, authenticated, service_role;
revoke all on function public.plans_founder_stays_on_sale() from public, anon, authenticated, service_role;
revoke all on function public.plans_bind_personal() from public, anon, authenticated, service_role;
revoke all on function public.plans_personal_bound_for_good() from public, anon, authenticated, service_role;
revoke all on function public.bind_personal_plans(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.person_badges_fix_terms() from public, anon, authenticated, service_role;
-- The four recreated keep their ACL through create or replace; said again.
revoke all on function public.accept_organization_invites_on_confirmation() from public, anon, authenticated, service_role;
revoke all on function public.credit_subscription_copies_plan() from public, anon, authenticated, service_role;
revoke all on function public.credit_price(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.billing_open_subscription(uuid, uuid, text, text, integer, boolean, date, text, text, text) from public, anon, authenticated;

grant execute on function public.holds_badge(text) to authenticated;
grant execute on function public.grant_badge(uuid, text) to authenticated;
grant execute on function public.revoke_badge(uuid, text) to authenticated;
grant execute on function public.founder_seats_left() to anon, authenticated;
grant execute on function public.billing_open_subscription(uuid, uuid, text, text, integer, boolean, date, text, text, text) to service_role;
