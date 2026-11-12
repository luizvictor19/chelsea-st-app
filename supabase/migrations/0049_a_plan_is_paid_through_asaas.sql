-- A plan is paid through Asaas (issue #72, ADR 0006).
--
-- Chelsea St sells plans to people; GrifoAI companies are billed outside the
-- app (#274) and nothing here applies to them. This migration holds what the
-- billing needs and nothing of the credits (#273), the padlock and the
-- upgrade (#274) or the direct sign-up (#275), which build on it.
--
-- Measured on 2026-11-12 through the MCP before writing: migrations up to
-- 0048; no table, type or function named plan, subscription, payment or
-- billing; three organizations, chelsea-st (brand chelsea-st, with a teacher),
-- grifoai and empresa-teste (brand grifoai, without). No row is touched.
--
-- Who writes (Luiz, question Q2 of the #72 plan, 12/11): the provider's
-- webhook and the daily overdue routine run with no person signed in, so the
-- billing state is written only by the security definer functions below, and
-- only service_role executes them. No table here gives service_role any
-- privilege: the functions are its only door, and each one writes one thing
-- under its own checks. A person reads her own rows through row level
-- security; she writes none of them.
--
-- The catalog (Q3): plans holds every number the offer is made of (price,
-- credits, minutes, doors, trial), written by the platform admin on
-- /teacher/plans. The numbers never enter this public repository (ADR 0006):
-- no row is inserted here.
--
-- The state comes from the provider, read back by the app after every event,
-- never from the body of the event (#72 plan). These tables keep what the app
-- last read; subscriptions.status is the app's reading of it.


-- The catalog ----------------------------------------------------------------

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  -- Common to every organization of its brand, like the content since 0043:
  -- the column every table carries (ADR 0004), always null.
  organization_id uuid references public.organizations on delete restrict
    constraint plans_is_common check (organization_id is null),
  brand text not null
    constraint plans_brand_known check (brand in ('chelsea-st', 'grifoai')),
  key text not null
    constraint plans_key_shape check (key ~ '^[a-z][a-z0-9-]{0,39}$'),
  name text not null
    constraint plans_name_length check (char_length(btrim(name)) between 1 and 40),
  position smallint not null default 0,
  monthly_price_cents integer not null
    constraint plans_monthly_price_positive check (monthly_price_cents > 0),
  annual_price_cents integer not null
    constraint plans_annual_price_positive check (annual_price_cents > 0),
  monthly_credits integer not null
    constraint plans_monthly_credits_not_negative check (monthly_credits >= 0),
  trail_minutes_per_day smallint not null
    constraint plans_trail_minutes_range check (trail_minutes_per_day between 1 and 240),
  opens_voice_question boolean not null,
  opens_free_conversation boolean not null,
  opens_video boolean not null,
  trial_days smallint not null
    constraint plans_trial_days_range check (trial_days between 0 and 60),
  trial_credits integer not null
    constraint plans_trial_credits_not_negative check (trial_credits >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_brand_key unique (brand, key)
);

comment on table public.plans is
  'The plans a brand sells, one row each, written by the platform admin on /teacher/plans. Every number of the offer lives here and never in the repository (ADR 0006). A price changed here applies to new subscriptions only: an existing one keeps the value the provider holds. A plan is deactivated, never deleted.';

alter table public.plans enable row level security;

-- The price is public on the site, so an active plan is read by anyone,
-- signed in or not. Two policies and not one: anon must never reach
-- is_platform_admin(), which it may not execute (0047).
create policy plans_read_active on public.plans
  for select to anon, authenticated
  using (is_active);
create policy plans_read_admin on public.plans
  for select to authenticated
  using ((select public.is_platform_admin()));
create policy plans_insert on public.plans
  for insert to authenticated
  with check ((select public.is_platform_admin()));
create policy plans_update on public.plans
  for update to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));

grant select on public.plans to anon, authenticated;
grant insert, update on public.plans to authenticated;


-- The person who pays ---------------------------------------------------------

create table public.billing_customers (
  person_id uuid primary key references public.profiles on delete restrict,
  organization_id uuid not null references public.organizations on delete restrict,
  -- HMAC-SHA256 of the CPF's eleven digits, keyed by BILLING_CPF_KEY, in hex.
  -- The CPF itself stays with the provider. Not a plain hash: a CPF has few
  -- enough combinations to be undone by brute force (Q4).
  cpf_hmac text not null
    constraint billing_customers_cpf_hmac_shape check (cpf_hmac ~ '^[0-9a-f]{64}$')
    constraint billing_customers_one_person_per_cpf unique,
  -- When her free trial started. One trial per CPF (Q4): the CPF belongs to
  -- one person, and the person has one trial.
  trial_used_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.billing_customers is
  'A Chelsea St person who started paying: the HMAC of her CPF (one person per CPF) and when her one free trial started. Written only by billing_customer, executed by service_role.';

alter table public.billing_customers enable row level security;

create policy billing_customers_read on public.billing_customers
  for select to authenticated
  using (person_id = (select auth.uid()) or (select public.is_platform_admin()));

grant select on public.billing_customers to authenticated;


-- The subscription --------------------------------------------------------------

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.billing_customers on delete restrict,
  organization_id uuid not null references public.organizations on delete restrict,
  plan_id uuid not null references public.plans on delete restrict,
  cycle text not null
    constraint subscriptions_cycle_known check (cycle in ('monthly', 'annual')),
  billing_type text not null
    constraint subscriptions_billing_type_known check (billing_type in ('card', 'pix')),
  -- What the provider charges each cycle, as it was when the row was made.
  value_cents integer not null
    constraint subscriptions_value_positive check (value_cents > 0),
  with_trial boolean not null,
  -- The first charge: the day of the subscription plus the plan's trial days,
  -- in São Paulo; the day itself when there is no trial.
  first_due_on date not null,
  -- A card subscription starts at the provider's hosted checkout (Q1) and is
  -- known by the checkout until the provider creates it; a Pix one is created
  -- by the app at once.
  asaas_checkout_id text
    constraint subscriptions_one_checkout unique,
  asaas_customer_id text,
  asaas_subscription_id text
    constraint subscriptions_one_asaas_subscription unique,
  status text not null
    constraint subscriptions_status_known
      check (status in ('pending', 'trialing', 'active', 'past_due', 'canceled')),
  -- The last day the paid cycle covers; null until a charge is confirmed.
  paid_through date,
  -- The due day of the oldest charge left unpaid; null when none is.
  past_due_since date,
  canceled_at timestamptz,
  cancel_reason text
    constraint subscriptions_cancel_reason_known
      check (cancel_reason in ('person', 'overdue', 'replaced', 'checkout_expired', 'trial_used', 'provider')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_known_at_the_provider
    check (asaas_checkout_id is not null or asaas_subscription_id is not null),
  constraint subscriptions_checkout_is_card
    check (asaas_checkout_id is null or billing_type = 'card'),
  constraint subscriptions_pending_has_no_subscription
    check (status <> 'pending' or asaas_subscription_id is null),
  constraint subscriptions_canceled_says_when
    check ((status = 'canceled') = (canceled_at is not null)
           and (status = 'canceled') = (cancel_reason is not null)),
  constraint subscriptions_past_due_says_since
    check ((status = 'past_due') = (past_due_since is not null))
);

-- One subscription alive per person: a second one is refused, not merged.
create unique index subscriptions_one_alive_per_person
  on public.subscriptions (person_id) where status <> 'canceled';

comment on table public.subscriptions is
  'A Chelsea St subscription and the app''s last reading of it at the provider: pending (checkout not finished), trialing, active, past_due, canceled. At most one alive per person. Written only by the billing functions, executed by service_role.';

alter table public.subscriptions enable row level security;

create policy subscriptions_read on public.subscriptions
  for select to authenticated
  using (person_id = (select auth.uid()) or (select public.is_platform_admin()));

grant select on public.subscriptions to authenticated;


-- The charges ---------------------------------------------------------------------

create table public.payments (
  asaas_payment_id text primary key,
  subscription_id uuid references public.subscriptions on delete restrict,
  person_id uuid not null references public.billing_customers on delete restrict,
  organization_id uuid not null references public.organizations on delete restrict,
  -- cycle: a charge of the subscription; upgrade and pack come with #274 and
  -- #273, and their own column of credits granted lives there.
  kind text not null
    constraint payments_kind_known check (kind in ('cycle', 'upgrade', 'pack')),
  value_cents integer not null
    constraint payments_value_positive check (value_cents > 0),
  -- The provider's status as last read, verbatim (PENDING, CONFIRMED,
  -- RECEIVED, OVERDUE, REFUNDED...). A list of its own would fall behind the
  -- provider's; the app reads the few it acts on.
  asaas_status text not null
    constraint payments_asaas_status_shape check (asaas_status ~ '^[A-Z_]{3,40}$'),
  deleted boolean not null default false,
  due_on date not null,
  paid_at timestamptz,
  refunded_cents integer not null default 0
    constraint payments_refund_within_value check (refunded_cents between 0 and value_cents),
  invoice_url text
    constraint payments_invoice_url_https check (invoice_url ~ '^https://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_cycle_has_subscription
    check (kind <> 'cycle' or subscription_id is not null)
);

create index payments_by_subscription on public.payments (subscription_id);

comment on table public.payments is
  'Every charge of a Chelsea St person at the provider, as the app last read it. asaas_payment_id is what #273 grants credits by, once. Written only by the billing functions, executed by service_role.';

alter table public.payments enable row level security;

create policy payments_read on public.payments
  for select to authenticated
  using (person_id = (select auth.uid()) or (select public.is_platform_admin()));

grant select on public.payments to authenticated;


-- The provider's events ----------------------------------------------------------

-- An inbox, like leads it has no organization: an event names the provider's
-- ids, not a person, until the app reads it. Nobody reads it through the API.
create table public.billing_events (
  event_id text primary key
    constraint billing_events_id_shape check (char_length(event_id) between 1 and 100),
  event_type text not null
    constraint billing_events_type_shape check (event_type ~ '^[A-Z_]{3,60}$'),
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

comment on table public.billing_events is
  'Each webhook event of the provider, once, by its id: a redelivery finds its row. processed_at says it was handled; error keeps why an event could not be. Read by postgres only.';

alter table public.billing_events enable row level security;


-- The overdue steps ----------------------------------------------------------------

-- Luiz, Q5 of the #72 plan (12/11): seven days overdue, a new charge and an
-- email on days 1, 3, 5 and 7, cancel on day 7. One row per charge and day,
-- so a routine that runs twice on a day neither charges nor writes twice.
create table public.overdue_steps (
  asaas_payment_id text not null references public.payments on delete restrict,
  day smallint not null
    constraint overdue_steps_day_known check (day in (1, 3, 5, 7)),
  outcome text
    constraint overdue_steps_outcome_known
      check (outcome in ('paid', 'refused', 'pix_reminder', 'canceled', 'already_paid', 'error')),
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (asaas_payment_id, day)
);

comment on table public.overdue_steps is
  'The steps the daily routine took on an overdue charge: day 1, 3, 5 or 7, what came of the new charge, when the email went. Read by postgres only.';

alter table public.overdue_steps enable row level security;


-- The functions -----------------------------------------------------------------------
--
-- Each one security definer, owned by postgres, search_path empty, and
-- executable by service_role alone (0047: a function is born closed).

-- Her organization for billing: the Chelsea St organization she is a student
-- of. Never a company: a person who is not a student of a chelsea-st
-- organization is refused, which is what keeps billing on the B2C line.
create function public.billing_customer(p_person uuid, p_cpf_hmac text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization uuid;
  v_hmac text;
  v_trial timestamptz;
begin
  select m.organization_id into v_organization
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
   where m.user_id = p_person and m.role = 'student' and o.brand = 'chelsea-st'
   limit 1;
  if v_organization is null then
    raise exception 'person % is not a student of a Chelsea St organization', p_person
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.billing_customers (person_id, organization_id, cpf_hmac)
    values (p_person, v_organization, p_cpf_hmac)
    on conflict (person_id) do nothing;

  select cpf_hmac, trial_used_at into v_hmac, v_trial
    from public.billing_customers where person_id = p_person;
  if v_hmac <> p_cpf_hmac then
    raise exception 'person % already pays with another CPF', p_person
      using errcode = 'check_violation', constraint = 'billing_customers_one_cpf_per_person';
  end if;
  return v_trial;
end;
$$;

comment on function public.billing_customer(uuid, text) is
  'Makes or finds the billing row of a Chelsea St student and returns when her trial started (null: never). Refuses a person who is not a student of a chelsea-st organization, a CPF of another person (billing_customers_one_person_per_cpf) and a second CPF for the same person.';

-- A new subscription, pending at a checkout (card) or trialing or active at
-- once (Pix). A pending one of hers left behind is canceled as replaced; any
-- other alive is refused by subscriptions_one_alive_per_person.
create function public.billing_open_subscription(
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
  v_status text;
  v_id uuid;
begin
  select * into v_customer from public.billing_customers where person_id = p_person;
  if not found then
    raise exception 'person % has no billing row', p_person
      using errcode = 'foreign_key_violation';
  end if;
  if p_with_trial and v_customer.trial_used_at is not null then
    raise exception 'person % already had her trial', p_person
      using errcode = 'check_violation', constraint = 'billing_one_trial_per_person';
  end if;
  if not exists (select 1 from public.plans
                  where id = p_plan and is_active and brand = 'chelsea-st') then
    raise exception 'plan % is not an active Chelsea St plan', p_plan
      using errcode = 'check_violation', constraint = 'billing_plan_active';
  end if;

  update public.subscriptions
     set status = 'canceled', canceled_at = now(), cancel_reason = 'replaced', updated_at = now()
   where person_id = p_person and status = 'pending';

  v_status := case
    when p_checkout_id is not null then 'pending'
    when p_with_trial then 'trialing'
    else 'active'
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
  'Opens a subscription for a person with a billing row: pending when it waits at a checkout, trialing or active when the provider already holds it. Refuses a second trial (billing_one_trial_per_person) and an inactive or GrifoAI plan (billing_plan_active). Cancels a pending one of hers as replaced.';

-- The app's reading of the provider, written over the row. A pending
-- subscription learns its provider ids here; a trialing one marks the trial
-- as used. A canceled one stays canceled.
create function public.billing_apply_subscription(
  p_id uuid,
  p_subscription_id text,
  p_customer_id text,
  p_status text,
  p_paid_through date,
  p_past_due_since date,
  p_cancel_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.subscriptions;
begin
  select * into v_row from public.subscriptions where id = p_id for update;
  if not found then
    raise exception 'no subscription %', p_id using errcode = 'no_data_found';
  end if;
  if v_row.status = 'canceled' then
    return;
  end if;

  update public.subscriptions
     set asaas_subscription_id = coalesce(p_subscription_id, asaas_subscription_id),
         asaas_customer_id = coalesce(p_customer_id, asaas_customer_id),
         status = p_status,
         paid_through = coalesce(p_paid_through, paid_through),
         past_due_since = case when p_status = 'past_due' then p_past_due_since end,
         canceled_at = case when p_status = 'canceled' then now() end,
         cancel_reason = case when p_status = 'canceled' then p_cancel_reason end,
         updated_at = now()
   where id = p_id;

  if p_status = 'trialing' and v_row.with_trial then
    update public.billing_customers
       set trial_used_at = coalesce(trial_used_at, now())
     where person_id = v_row.person_id;
  end if;
end;
$$;

comment on function public.billing_apply_subscription(uuid, text, text, text, date, date, text) is
  'Writes the app''s reading of a subscription at the provider: ids, status, paid_through, past_due_since, and the reason when it is canceled. A canceled row never comes back. Trialing marks the person''s trial as used.';

-- The subscription the provider's ids point at, for the webhook and the
-- routine, which read nothing else.
create function public.billing_find_subscription(p_subscription_id text, p_checkout_id text)
returns setof public.subscriptions
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.subscriptions
   where (p_subscription_id is not null and asaas_subscription_id = p_subscription_id)
      or (p_checkout_id is not null and asaas_checkout_id = p_checkout_id)
   limit 1;
$$;

comment on function public.billing_find_subscription(text, text) is
  'The subscription with this provider subscription id, or with this checkout id. For the webhook and the overdue routine, which read the billing tables through functions only.';

-- A charge as the app last read it.
create function public.billing_save_payment(
  p_payment_id text,
  p_subscription uuid,
  p_kind text,
  p_value_cents integer,
  p_asaas_status text,
  p_deleted boolean,
  p_due_on date,
  p_paid_at timestamptz,
  p_refunded_cents integer,
  p_invoice_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
begin
  select * into v_sub from public.subscriptions where id = p_subscription;
  if not found then
    raise exception 'no subscription %', p_subscription using errcode = 'foreign_key_violation';
  end if;
  insert into public.payments (
    asaas_payment_id, subscription_id, person_id, organization_id, kind, value_cents,
    asaas_status, deleted, due_on, paid_at, refunded_cents, invoice_url
  ) values (
    p_payment_id, v_sub.id, v_sub.person_id, v_sub.organization_id, p_kind, p_value_cents,
    p_asaas_status, p_deleted, p_due_on, p_paid_at, p_refunded_cents, p_invoice_url
  )
  on conflict (asaas_payment_id) do update
     set value_cents = excluded.value_cents,
         asaas_status = excluded.asaas_status,
         deleted = excluded.deleted,
         due_on = excluded.due_on,
         paid_at = excluded.paid_at,
         refunded_cents = excluded.refunded_cents,
         invoice_url = excluded.invoice_url,
         updated_at = now()
   where payments.subscription_id = excluded.subscription_id;
  if not found then
    raise exception 'payment % belongs to another subscription', p_payment_id
      using errcode = 'check_violation', constraint = 'billing_payment_keeps_its_subscription';
  end if;
end;
$$;

comment on function public.billing_save_payment(text, uuid, text, integer, text, boolean, date, timestamptz, integer, text) is
  'Writes a charge of a subscription as the app last read it at the provider, made or updated by its provider id. A charge never moves to another subscription (billing_payment_keeps_its_subscription).';

-- The provider's event, once. True when it still has to be handled: new, or
-- received before and not finished (a redelivery after a failure).
create function public.billing_record_event(p_event_id text, p_event_type text, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.billing_events (event_id, event_type, payload)
    values (p_event_id, p_event_type, p_payload)
    on conflict (event_id) do nothing;
  return exists (select 1 from public.billing_events
                  where event_id = p_event_id and processed_at is null);
end;
$$;

create function public.billing_finish_event(p_event_id text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.billing_events
     set processed_at = now(), error = p_error
   where event_id = p_event_id;
$$;

comment on function public.billing_record_event(text, text, jsonb) is
  'Keeps a provider event by its id and says whether it still has to be handled: false for a redelivery of one already finished.';
comment on function public.billing_finish_event(text, text) is
  'Marks a provider event as handled, with the reason when it could not be.';

-- The charges the overdue routine works on: unpaid, past their due day, of a
-- subscription that is alive. Overdue days are counted in São Paulo.
create function public.billing_overdue_payments()
returns table (
  asaas_payment_id text,
  subscription_id uuid,
  person_id uuid,
  billing_type text,
  due_on date,
  invoice_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.asaas_payment_id, s.id, s.person_id, s.billing_type, p.due_on, p.invoice_url
    from public.payments p
    join public.subscriptions s on s.id = p.subscription_id
   where p.asaas_status = 'OVERDUE'
     and not p.deleted
     and s.status in ('trialing', 'active', 'past_due')
   order by p.due_on, p.asaas_payment_id;
$$;

comment on function public.billing_overdue_payments() is
  'The unpaid charges past due of an alive subscription, for the daily overdue routine.';

-- One step of the routine on a charge and day: true the first time, false
-- when the routine already took it, so nothing is charged or sent twice.
create function public.billing_take_overdue_step(p_payment_id text, p_day smallint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.overdue_steps (asaas_payment_id, day)
    values (p_payment_id, p_day)
    on conflict do nothing;
  return found;
end;
$$;

create function public.billing_finish_overdue_step(
  p_payment_id text, p_day smallint, p_outcome text, p_emailed boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.overdue_steps
     set outcome = p_outcome,
         emailed_at = case when p_emailed then now() else emailed_at end
   where asaas_payment_id = p_payment_id and day = p_day;
$$;

comment on function public.billing_take_overdue_step(text, smallint) is
  'Claims the overdue step of a charge for a day (1, 3, 5 or 7): true the first time only.';
comment on function public.billing_finish_overdue_step(text, smallint, text, boolean) is
  'Writes what came of an overdue step and whether its email went.';

revoke all on function public.billing_customer(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_open_subscription(uuid, uuid, text, text, integer, boolean, date, text, text, text) from public, anon, authenticated;
revoke all on function public.billing_apply_subscription(uuid, text, text, text, date, date, text) from public, anon, authenticated;
revoke all on function public.billing_find_subscription(text, text) from public, anon, authenticated;
revoke all on function public.billing_save_payment(text, uuid, text, integer, text, boolean, date, timestamptz, integer, text) from public, anon, authenticated;
revoke all on function public.billing_record_event(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.billing_finish_event(text, text) from public, anon, authenticated;
revoke all on function public.billing_overdue_payments() from public, anon, authenticated;
revoke all on function public.billing_take_overdue_step(text, smallint) from public, anon, authenticated;
revoke all on function public.billing_finish_overdue_step(text, smallint, text, boolean) from public, anon, authenticated;

grant execute on function public.billing_customer(uuid, text) to service_role;
grant execute on function public.billing_open_subscription(uuid, uuid, text, text, integer, boolean, date, text, text, text) to service_role;
grant execute on function public.billing_apply_subscription(uuid, text, text, text, date, date, text) to service_role;
grant execute on function public.billing_find_subscription(text, text) to service_role;
grant execute on function public.billing_save_payment(text, uuid, text, integer, text, boolean, date, timestamptz, integer, text) to service_role;
grant execute on function public.billing_record_event(text, text, jsonb) to service_role;
grant execute on function public.billing_finish_event(text, text) to service_role;
grant execute on function public.billing_overdue_payments() to service_role;
grant execute on function public.billing_take_overdue_step(text, smallint) to service_role;
grant execute on function public.billing_finish_overdue_step(text, smallint, text, boolean) to service_role;
