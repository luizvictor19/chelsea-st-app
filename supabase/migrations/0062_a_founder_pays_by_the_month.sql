-- A founder pays by the month (#331).
--
-- Luiz's decision of 14/11: the Plano Fundador and the Plano Fundador
-- Personalizado are sold monthly only. Until now every plan carried both
-- prices (0049: annual_price_cents not null), so a founder plan was also on
-- sale by the year, and the seal kept an annual price among its terms (0058).
--
-- 1. plans.annual_price_cents may be empty: an empty annual price is a plan
--    with no annual cycle. plans_annual_price_positive stays: empty passes,
--    zero or less does not.
-- 2. plans_monthly_only_for_founders: a founder or personal plan never has
--    an annual price. A public plan may have one or not.
-- 3. billing_open_subscription refuses the annual cycle on a plan without an
--    annual price, by name (billing_cycle_offered). Before this, a cycle
--    whose price was empty left the value unchecked ("an unknown cycle is
--    left to subscriptions_cycle_known"), so an annual subscription of a plan
--    with no annual price would have opened at any value.
-- 4. The seal no longer keeps an annual price: the column
--    person_badges.terms_annual_price_cents goes (#331, Q1 A). Its two
--    checks are made again without it, under the same names, and the three
--    functions that read it (badge_grant, person_badges_fix_terms,
--    billing_open_subscription) are recreated without it.
--
-- Measured in production on 14/11 (MCP, read only): plans 0, founder or
-- personal plans 0, subscriptions 0 (annual 0), person_badges 0 (with terms
-- 0). No row is written, converted or lost: the new check meets no plan and
-- the dropped column holds no value.
--
-- Each recreated body is the one of 0058 whole, with what changes said in
-- place. create or replace keeps each function's grants and owner.

-- 1 and 2 · the plan ----------------------------------------------------------------------

alter table public.plans alter column annual_price_cents drop not null;

alter table public.plans
  add constraint plans_monthly_only_for_founders
    check (audience = 'public' or annual_price_cents is null);

comment on column public.plans.annual_price_cents is
  'What the year costs, in cents; empty when the plan has no annual cycle. Never set on a founder or personal plan (plans_monthly_only_for_founders): those are monthly only (#331).';

-- 4 · the seal's terms --------------------------------------------------------------------

-- The two checks name the column; dropping it would drop them silently, so
-- they go first by name and come back below without it.
alter table public.person_badges drop constraint person_badges_terms_whole;
alter table public.person_badges drop constraint person_badges_terms_ranges;
alter table public.person_badges drop column terms_annual_price_cents;

alter table public.person_badges
  -- 0058's check without the annual price: the terms are all empty until
  -- the first paid founder subscription, then all set (the cost of a lesson
  -- may stay empty within whole terms: empty is the brand's cost).
  add constraint person_badges_terms_whole check (
    (terms_fixed_at is null
     and terms_monthly_price_cents is null
     and terms_monthly_credits is null and terms_teacher_lesson_credits is null
     and terms_credit_ceiling_months is null and terms_credit_days_after_cancel is null)
    or
    (terms_fixed_at is not null
     and terms_monthly_price_cents is not null
     and terms_monthly_credits is not null
     and terms_credit_ceiling_months is not null and terms_credit_days_after_cancel is not null)),
  -- The ranges of the plan's own columns (0049, 0050), as in 0058.
  add constraint person_badges_terms_ranges check (
    (terms_monthly_price_cents is null or terms_monthly_price_cents > 0)
    and (terms_monthly_credits is null or terms_monthly_credits >= 0)
    and (terms_teacher_lesson_credits is null or terms_teacher_lesson_credits > 0)
    and (terms_credit_ceiling_months is null or terms_credit_ceiling_months between 1 and 60)
    and (terms_credit_days_after_cancel is null or terms_credit_days_after_cancel between 0 and 365));

-- 0058's badge_grant without terms_annual_price_cents in the copy of the
-- inherited terms. Nothing else changes.
create or replace function public.badge_grant(p_person uuid, p_badge text, p_source text, p_granted_by uuid)
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
    terms_monthly_price_cents, terms_monthly_credits,
    terms_teacher_lesson_credits, terms_credit_ceiling_months,
    terms_credit_days_after_cancel, terms_fixed_at
  ) values (
    p_person, p_badge, p_source, p_granted_by,
    v_terms.terms_monthly_price_cents, v_terms.terms_monthly_credits,
    v_terms.terms_teacher_lesson_credits, v_terms.terms_credit_ceiling_months,
    v_terms.terms_credit_days_after_cancel, v_terms.terms_fixed_at
  ) returning id into v_id;
  return v_id;
end;
$$;

-- 0058's trigger function without the annual price. A founder subscription
-- is monthly now (billing_cycle_offered), so its value is the monthly price;
-- the case stays for a subscription of another cycle, which no founder plan
-- can open any more, and reads the plan's monthly price then, as before.
create or replace function public.person_badges_fix_terms()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    update public.person_badges b
       set terms_monthly_price_cents =
             case when new.cycle = 'monthly' then new.value_cents else p.monthly_price_cents end,
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

-- 3 · the annual cycle ---------------------------------------------------------------------

-- 0058's body with two changes, said in place: the annual cycle on a plan
-- without an annual price is refused (billing_cycle_offered), and a seal's
-- terms carry only the monthly price.
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

  -- New in 0062: a plan without an annual price has no annual cycle. Every
  -- founder and personal plan is one (plans_monthly_only_for_founders).
  if p_cycle = 'annual' and v_plan.annual_price_cents is null then
    raise exception 'billing_cycle_offered: plan % has no annual cycle', p_plan
      using errcode = 'check_violation', constraint = 'billing_cycle_offered';
  end if;

  -- A seal's terms belong to a founder plan, which the refusal above keeps
  -- monthly: only the monthly price is read from them (0062).
  if v_has_seal and v_seal.terms_fixed_at is not null then
    v_value := case p_cycle when 'monthly' then v_seal.terms_monthly_price_cents end;
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
  'Opens a subscription for a person with a billing row: pending when it waits at a checkout, trialing or active when the provider already holds it. Refuses a second trial (billing_one_trial_per_person), an inactive or GrifoAI plan (billing_plan_active), a plan outside her audience (billing_plan_audience: a founder plan without her live seal, a personal plan not bound to her), the annual cycle on a plan without an annual price (billing_cycle_offered: every founder and personal plan) and a value other than hers (billing_value_matches: her seal''s monthly terms on a founder plan once fixed, the plan''s price otherwise). Cancels a pending one of hers as replaced.';
