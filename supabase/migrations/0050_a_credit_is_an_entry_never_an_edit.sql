-- A credit is an entry, never an edit (issue #273, ADR 0006).
--
-- Live voice, video and a lesson with a teacher are paid with credits; a plan
-- grants credits every month (#271). This migration holds the ledger the
-- balance is the sum of, the cost of each action, and the grants of the trial
-- and of the month. The organization's balance (#299), the packs (#298), the
-- refund button (#297), the padlock and the upgrade (#274), the booking
-- (#276) and the Founder seal (#292) build on it. Spec: docs/spec-creditos.md.
--
-- Measured through the MCP on 2026-11-12 before writing: migrations up to
-- 0049, and 0049 the highest on every branch; no table or function with
-- "credit" in its name (plans.monthly_credits, plans.trial_credits and
-- image_attempts.credits_spent are columns, the last one Freepik's); 0 rows in
-- plans, billing_customers, subscriptions, payments and billing_events, so
-- the columns added to plans and subscriptions are not null with nothing to
-- fill; three organizations, chelsea-st (brand chelsea-st), grifoai and
-- empresa-teste (brand grifoai). No row is touched.
--
-- The ledger (credit_entries) only takes new rows. A grant opens a lot: a row
-- with an amount (trial, plan, and a refund whose lot is gone). Every other
-- row points at its lot: a debit, the refund of a debit, the expire that
-- closes a lot past its end, the void of a lot whose charge was refunded,
-- charged back or deleted. The balance is the sum of the live lots' rows.
--
-- When a credit ends (Luiz, 12/11, after the first review of PR #304; it
-- replaces the end of the cycle and the capped carryover): while her
-- subscription is alive a month's credits never end, and a lot of the plan is
-- born without expires_at. The month grants only up to a ceiling, a number of
-- months of the plan's credits (credit_ceiling_months). Once she cancels,
-- her live lots end a number of days after the end of what she paid for
-- (credit_days_after_cancel); subscribing again before that brings back the
-- lots that remain, without an end. Both numbers are the plan's, copied onto
-- the subscription when it is born, as its monthly credits are (Q5; Luiz,
-- question 9 on PR #304): a plan changed later reaches new subscriptions
-- only. The trial's lot ends when the
-- trial does. Because a row is never edited, that end is not written on the
-- lot: it is read from her subscriptions (credit_deadline), so a lot past it
-- leaves the balance at once, whether the daily routine ran or not; the
-- routine then closes it with an expire, and a closed lot never comes back.
--
-- No number of the offer enters here (ADR 0006): what each action costs, the
-- credits of a plan, its ceiling and its days after a cancel are rows the
-- platform admin writes on /teacher/plans.
--
-- Who writes (as 0049): nobody through the API. The webhook and the routine
-- call three functions only service_role executes; the debit and the refund
-- are executed by nobody, and the function that needs them (the booking of
-- #276) is another security definer of postgres that calls them inside its
-- own transaction. A person reads her own rows and her own balance.
--
-- Every function that writes to the ledger first takes the person's advisory
-- lock, the pattern of accept_my_organization_invite (0040): two debits of
-- the same person wait for each other, and the second sees the balance the
-- first left.
--
-- A refusal raised here names its constraint twice: in the error, for
-- scripts/verify-rls.sql, and at the start of the message, because the API
-- passes the message on and not the constraint.


-- What a plan holds back, and what a subscription grants each month --------

-- The ceiling of the balance, in months of the plan's credits: the grant of
-- a month stops at it. And the days her credits still last once she
-- cancels, counted from the end of what she paid for. No default: each plan
-- says both, written by the platform admin. A subscription keeps the ones it
-- was born with (below).
alter table public.plans
  add column credit_ceiling_months smallint not null
    constraint plans_credit_ceiling_months_range check (credit_ceiling_months between 1 and 60),
  add column credit_days_after_cancel smallint not null
    constraint plans_credit_days_after_cancel_range check (credit_days_after_cancel between 0 and 365);

comment on column public.plans.credit_ceiling_months is
  'The most credits a person of this plan holds alive, in months of its monthly credits; a month grants only up to it. Written by the platform admin; copied onto each new subscription.';
comment on column public.plans.credit_days_after_cancel is
  'How many days after the end of what she paid for her credits still last once the subscription is canceled. Written by the platform admin; copied onto each new subscription.';

-- Q5, and question 9 on PR #304 (Luiz, 12/11): the credits of the month, the
-- ceiling and the days after a cancel are kept on the subscription, copied
-- from the plan when it is born, like value_cents. A plan changed later
-- applies to new subscriptions only: what she bought does not change under
-- her. The ranges are the plan's.
alter table public.subscriptions
  add column monthly_credits integer not null
    constraint subscriptions_monthly_credits_not_negative check (monthly_credits >= 0),
  add column credit_ceiling_months smallint not null
    constraint subscriptions_credit_ceiling_months_range check (credit_ceiling_months between 1 and 60),
  add column credit_days_after_cancel smallint not null
    constraint subscriptions_credit_days_after_cancel_range check (credit_days_after_cancel between 0 and 365);

comment on column public.subscriptions.monthly_credits is
  'The credits each month of this subscription grants, copied from its plan when the row is made (subscriptions_credits_from_plan). A change to the plan later does not reach it.';
comment on column public.subscriptions.credit_ceiling_months is
  'The ceiling of her balance in months of monthly_credits, copied from the plan when the row is made (subscriptions_credits_from_plan). A change to the plan later does not reach it.';
comment on column public.subscriptions.credit_days_after_cancel is
  'How many days after paid_through her credits last once this subscription is canceled, copied from the plan when the row is made (subscriptions_credits_from_plan). A change to the plan later does not reach it.';

create function public.credit_subscription_copies_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select p.monthly_credits, p.credit_ceiling_months, p.credit_days_after_cancel
    into new.monthly_credits, new.credit_ceiling_months, new.credit_days_after_cancel
    from public.plans p
   where p.id = new.plan_id;
  return new;
end;
$$;

create trigger subscriptions_credits_from_plan
  before insert on public.subscriptions
  for each row execute function public.credit_subscription_copies_plan();


-- The cost of each action ------------------------------------------------------

create table public.credit_costs (
  id uuid primary key default gen_random_uuid(),
  -- Common to every organization of its brand, like plans: the column every
  -- table carries (ADR 0004), always null.
  organization_id uuid references public.organizations on delete restrict
    constraint credit_costs_is_common check (organization_id is null),
  brand text not null
    constraint credit_costs_brand_known check (brand in ('chelsea-st', 'grifoai')),
  -- The same list as CREDIT_ACTIONS in src/lib/credits/actions.ts
  -- (actions.test.ts): a new action is a migration and a code change together.
  action text not null
    constraint credit_costs_action_known
      check (action in ('voice_minute', 'video_minute', 'teacher_lesson')),
  credits integer not null
    constraint credit_costs_credits_positive check (credits > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_costs_one_per_brand_action unique (brand, action)
);

comment on table public.credit_costs is
  'What one unit of an action costs in credits, per brand: a minute of voice, a minute of video, a lesson with a teacher. An action without a row in a brand is not sold there (credit_cost_known). Written by the platform admin on /teacher/plans, read by anyone: the cost is part of the public offer, like the price. Read through credit_cost alone, never by a constant.';

alter table public.credit_costs enable row level security;

-- Read by anyone; written by the platform admin. Two kinds of policy, so anon
-- never reaches is_platform_admin(), which it may not execute (0047).
create policy credit_costs_read on public.credit_costs
  for select to anon, authenticated
  using (true);
create policy credit_costs_insert on public.credit_costs
  for insert to authenticated
  with check ((select public.is_platform_admin()));
create policy credit_costs_update on public.credit_costs
  for update to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));

grant select on public.credit_costs to anon, authenticated;
grant insert, update on public.credit_costs to authenticated;


-- The ledger --------------------------------------------------------------------

create table public.credit_entries (
  id uuid primary key default gen_random_uuid(),
  -- The order rows were written in: among lots that end together (or never),
  -- the oldest is spent first.
  seq bigint generated always as identity
    constraint credit_entries_one_seq unique,
  -- The organization of the subscription that granted the lot (ADR 0004).
  organization_id uuid not null references public.organizations on delete restrict,
  person_id uuid not null references public.profiles on delete restrict,
  kind text not null
    constraint credit_entries_kind_known
      check (kind in ('trial', 'plan', 'refund', 'debit', 'expire', 'void')),
  amount integer not null,
  -- The lot a row belongs to; null on a lot itself.
  lot_id uuid references public.credit_entries on delete restrict,
  -- When a lot ends on its own: the trial's at its first charge, a refund's
  -- lot when she has no subscription alive. Null on a month's lot, which ends
  -- only after a cancel (credit_deadline), and on every row that is not a lot.
  expires_at timestamptz,
  -- A refund names the debit it gives back.
  refers_to uuid references public.credit_entries on delete restrict,
  -- On a debit and its refund: what was paid for, and the caller's key for it
  -- ('session:<id>:minute:<n>', a booking's id).
  action text,
  reference text
    constraint credit_entries_reference_length check (char_length(reference) between 1 and 200),
  -- On a month's lot: the charge that paid for it and which of its months
  -- (0 for a monthly charge, 0 to 11 for an annual one).
  asaas_payment_id text references public.payments on delete restrict,
  period smallint
    constraint credit_entries_period_range check (period between 0 and 11),
  -- On the trial's and the month's lot.
  subscription_id uuid references public.subscriptions on delete restrict,
  created_at timestamptz not null default now(),
  -- A month's lot may be 0: the month was decided at the ceiling, and is not
  -- granted again.
  constraint credit_entries_amount_sign check (
    (kind not in ('trial', 'refund') or amount > 0)
    and (kind <> 'plan' or amount >= 0)
    and (kind not in ('debit', 'void') or amount < 0)
    and (kind <> 'expire' or amount <= 0)),
  constraint credit_entries_lot_shape check (
    (kind <> 'trial' or (lot_id is null and expires_at is not null))
    and (kind <> 'plan' or (lot_id is null and expires_at is null))
    and (kind not in ('debit', 'expire', 'void') or (lot_id is not null and expires_at is null))
    and (kind <> 'refund' or lot_id is null or expires_at is null)),
  constraint credit_entries_source_shape check (
    (kind = 'plan') = (asaas_payment_id is not null)
    and (kind = 'plan') = (period is not null)
    and (kind in ('trial', 'plan')) = (subscription_id is not null)
    and (kind = 'refund') = (refers_to is not null)
    and (kind in ('debit', 'refund')) = (action is not null)
    and (kind in ('debit', 'refund')) = (reference is not null))
);

-- Once each, by a unique index the grant functions name in on conflict: a
-- webhook delivered again, or the routine and the webhook at once, find the
-- row already there.
create unique index credit_entries_one_grant_per_period
  on public.credit_entries (asaas_payment_id, period) where kind = 'plan';
create unique index credit_entries_one_trial_per_subscription
  on public.credit_entries (subscription_id) where kind = 'trial';
-- One refund per debit.
create unique index credit_entries_once_per_entry
  on public.credit_entries (kind, refers_to) where refers_to is not null;
-- A lot closes once when it ends, and is voided once.
create unique index credit_entries_one_close_per_lot
  on public.credit_entries (kind, lot_id) where kind in ('expire', 'void');

create index credit_entries_by_person on public.credit_entries (person_id, seq);
create index credit_entries_by_lot on public.credit_entries (lot_id);

comment on table public.credit_entries is
  'The credit ledger of a person: only new rows, never an edit (credit_entries_append_only). A lot (trial, plan, a refund whose lot is gone) has an amount; every other row (debit, refund, expire, void) points at its lot. A month''s lot has no end while her subscription is alive, and ends a number of days after a cancel (credit_deadline). The balance is the sum of the live lots'' rows (credits_balance). Written only by the credit functions of 0050.';

alter table public.credit_entries enable row level security;

create policy credit_entries_read on public.credit_entries
  for select to authenticated
  using (person_id = (select auth.uid()) or (select public.is_platform_admin()));

grant select on public.credit_entries to authenticated;

-- Only new rows, for every role, postgres included. A trigger and not a
-- revoke: the owner holds every privilege. An ordinary trigger, so a restore
-- (session_replication_role = replica, docs/commands.md) passes, as the
-- triggers of 0048 do.
create function public.credit_entries_refuse_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'credit_entries_append_only: a credit entry is never changed or removed (%); write a new entry instead', tg_op
    using errcode = 'restrict_violation',
          constraint = 'credit_entries_append_only',
          schema = tg_table_schema,
          table = tg_table_name;
end;
$$;

create trigger credit_entries_append_only
  before update or delete on public.credit_entries
  for each row execute function public.credit_entries_refuse_edit();

create trigger credit_entries_append_only_truncate
  before truncate on public.credit_entries
  for each statement execute function public.credit_entries_refuse_edit();

-- A row that points at a lot points at a lot of the same person and
-- organization, and never leaves it below zero. The second lock on the
-- balance: the first is the count inside credit_debit.
create function public.credit_entries_check_lot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lot public.credit_entries;
  v_left bigint;
begin
  if new.lot_id is null then
    return new;
  end if;
  select * into v_lot from public.credit_entries where id = new.lot_id;
  if v_lot.id is null or v_lot.lot_id is not null
     or v_lot.person_id <> new.person_id or v_lot.organization_id <> new.organization_id then
    raise exception 'credit_entries_lot_is_hers: % points at %, which is not a lot of the same person and organization', new.kind, new.lot_id
      using errcode = 'check_violation',
            constraint = 'credit_entries_lot_is_hers',
            schema = tg_table_schema,
            table = tg_table_name;
  end if;
  select coalesce(sum(e.amount), 0) into v_left
    from public.credit_entries e
   where e.id = new.lot_id or e.lot_id = new.lot_id;
  if v_left + new.amount < 0 then
    raise exception 'credit_entries_lot_not_negative: % of % would leave lot % at %', new.kind, new.amount, new.lot_id, v_left + new.amount
      using errcode = 'check_violation',
            constraint = 'credit_entries_lot_not_negative',
            schema = tg_table_schema,
            table = tg_table_name;
  end if;
  return new;
end;
$$;

create trigger credit_entries_lot_not_negative
  before insert on public.credit_entries
  for each row execute function public.credit_entries_check_lot();


-- The pieces the functions share --------------------------------------------------
--
-- Executed by nobody: called only by the functions below, all owned by
-- postgres (0047, a function is born closed).

create function public.credit_lock_person(p_person uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('credits:' || p_person::text, 0));
$$;

comment on function public.credit_lock_person(uuid) is
  'Takes the person''s credit lock until the end of the transaction. Every function that writes her ledger takes it first.';

-- Month k of a charge starts at midnight in São Paulo on due_on + k months,
-- counted from the original due day, so a shorter month holds the day
-- (31/01 is followed by 28/02 and then by 31/03), as paid_through does.
create function public.credit_month_starts(p_due_on date, p_month integer)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (p_due_on + make_interval(months => p_month)) at time zone 'America/Sao_Paulo';
$$;

comment on function public.credit_month_starts(date, integer) is
  'Midnight in São Paulo of the due day plus that many months: where month k of a charge starts.';

-- A charge that grants: paid, not deleted, nothing refunded. The paid
-- statuses are PAID_STATUSES in src/lib/billing/provider.ts
-- (src/lib/credits/actions.test.ts holds the two lists equal).
create function public.credit_payment_grants(p_payment public.payments)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_payment.kind = 'cycle'
     and not p_payment.deleted
     and p_payment.refunded_cents = 0
     and p_payment.asaas_status in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH');
$$;

comment on function public.credit_payment_grants(public.payments) is
  'Whether a charge grants its months: a cycle charge, paid, not deleted, nothing refunded.';

-- A charge whose money went back: deleted, refunded (a refund the provider
-- calls done), or charged back on the card. A chargeback the person wins
-- later does not bring the lots back (no adjustment exists yet).
create function public.credit_payment_taken_back(p_payment public.payments)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_payment.deleted
      or p_payment.refunded_cents > 0
      or p_payment.asaas_status in ('REFUNDED', 'CHARGEBACK_REQUESTED',
                                    'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL');
$$;

comment on function public.credit_payment_taken_back(public.payments) is
  'Whether a charge''s money went back: deleted, refunded, or charged back. Its lots are voided.';

-- Whether she has a subscription running (with or without a trial, paid,
-- or overdue but not canceled yet, Q6). A checkout not finished is not one.
create function public.credit_alive(p_person uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.subscriptions s
                  where s.person_id = p_person
                    and s.status in ('trialing', 'awaiting', 'active', 'past_due'));
$$;

comment on function public.credit_alive(uuid) is
  'Whether the person has a subscription running: trialing, awaiting, active or past_due.';

-- Where her credits end: never while a subscription of hers is alive (null).
-- Otherwise, the latest end any canceled subscription of hers paid for: at
-- midnight in São Paulo of the day after its paid_through, plus that
-- subscription's credit_days_after_cancel (copied from its plan at birth). The latest, so a short subscription after a
-- long one never cuts what the long one paid for; and only one that was
-- paid, so a subscription opened and never paid does not push the end
-- forward. When none of hers was paid (or a refund took its days back), the
-- day of the last cancel of one that ran counts instead. A checkout that
-- never ran (replaced, expired, a trial refused) moves nothing. Null too for
-- a person who never subscribed: only an end written on the lot applies.
create function public.credit_deadline(p_person uuid)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when public.credit_alive(p_person) then null
    else coalesce(
      (select max(((s.paid_through + 1 + s.credit_days_after_cancel)::timestamp)
                  at time zone 'America/Sao_Paulo')
         from public.subscriptions s
        where s.person_id = p_person
          and s.status = 'canceled'
          and s.paid_through is not null),
      (select (((s.canceled_at at time zone 'America/Sao_Paulo')::date
                + s.credit_days_after_cancel)::timestamp) at time zone 'America/Sao_Paulo'
         from public.subscriptions s
        where s.person_id = p_person
          and s.status = 'canceled'
          and s.cancel_reason not in ('replaced', 'checkout_expired', 'trial_used')
        order by s.canceled_at desc, s.created_at desc
        limit 1))
  end;
$$;

comment on function public.credit_deadline(uuid) is
  'When the person''s credits end: null while a subscription of hers is alive; after a cancel, the latest end a canceled subscription of hers paid for (midnight in São Paulo of the day after its paid_through, plus its credit_days_after_cancel), or the last cancel''s day plus those days when none was paid.';

-- Her live lots: not closed, and not past their end, which is the earlier of
-- the lot's own (the trial's) and hers (credit_deadline). The nearest end
-- first, the lots without an end last, the oldest first.
create function public.credit_lots_of(p_person uuid)
returns table (
  lot_id uuid, kind text, remaining integer, expires_at timestamptz,
  organization_id uuid, seq bigint)
language sql
stable
set search_path = ''
as $$
  with her as (select public.credit_deadline(p_person) as deadline)
  select l.id, l.kind,
         (select sum(e.amount) from public.credit_entries e
           where e.person_id = p_person and (e.id = l.id or e.lot_id = l.id))::integer,
         least(l.expires_at, her.deadline),
         l.organization_id, l.seq
    from public.credit_entries l
   cross join her
   where l.person_id = p_person
     and l.lot_id is null
     and not exists (select 1 from public.credit_entries x
                      where x.lot_id = l.id and x.kind = 'expire')
     and (least(l.expires_at, her.deadline) is null
          or least(l.expires_at, her.deadline) > now())
   order by least(l.expires_at, her.deadline) nulls last, l.seq;
$$;

comment on function public.credit_lots_of(uuid) is
  'The person''s live lots, each with what is left and when it ends (null: not while her subscription is alive), the nearest end first and the oldest first. Read by every credit function; the screen reads it through credit_live_lots.';

create function public.credit_balance_of(p_person uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(l.remaining), 0)::integer from public.credit_lots_of(p_person) l;
$$;

comment on function public.credit_balance_of(uuid) is
  'The person''s balance, the sum of her live lots. Read by the credit functions; the screen reads it through credits_balance.';

-- The lots a charge paid for that were neither closed nor voided, each with
-- what is left, alive or past her end: the void must reach a lot whose end
-- came with the same cancel that took the money back.
create function public.credit_payment_open_lots(p_payment_id text)
returns table (lot_id uuid, organization_id uuid, person_id uuid, remaining integer)
language sql
stable
set search_path = ''
as $$
  select g.id, g.organization_id, g.person_id,
         (select sum(e.amount) from public.credit_entries e
           where e.id = g.id or e.lot_id = g.id)::integer
    from public.credit_entries g
   where g.kind = 'plan'
     and g.asaas_payment_id = p_payment_id
     and not exists (select 1 from public.credit_entries x
                      where x.lot_id = g.id and x.kind in ('expire', 'void'));
$$;

comment on function public.credit_payment_open_lots(text) is
  'The lots a charge paid for that were neither closed nor voided, each with what is left, whether or not they are past the person''s end. Read by the void.';

-- The live lots a charge paid for, each with what is left.
create function public.credit_payment_lots(p_payment_id text)
returns table (lot_id uuid, organization_id uuid, person_id uuid, remaining integer)
language sql
stable
set search_path = ''
as $$
  select l.lot_id, l.organization_id, p.person_id, l.remaining
    from public.payments p
   cross join lateral public.credit_lots_of(p.person_id) l
    join public.credit_entries g on g.id = l.lot_id
   where p.asaas_payment_id = p_payment_id
     and g.asaas_payment_id = p_payment_id;
$$;

comment on function public.credit_payment_lots(text) is
  'The live lots a charge paid for (its months), each with what is left.';

-- A person reads her own credits; the platform admin and service_role
-- (no person signed in) read anyone's. Another person's is refused: with
-- the Founder seal (#292) a cost would say who is a founder, and a balance
-- is hers.
create function public.credit_check_reader(p_person uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and (select auth.uid()) <> p_person
     and not public.is_platform_admin() then
    raise exception 'the credits of another person are not yours to read'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

comment on function public.credit_check_reader(uuid) is
  'Refuses (42501) anyone signed in but the person herself and the platform admin.';


-- What she has ------------------------------------------------------------------
--
-- security definer: the end of her lots is read from her subscriptions and
-- from her plan, which she may no longer read once it is off sale. So each
-- refuses another person (credit_check_reader) instead of leaning on row
-- level security.

create function public.credit_live_lots(p_person uuid)
returns table (lot_id uuid, kind text, remaining integer, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.credit_check_reader(p_person);
  return query
    select l.lot_id, l.kind, l.remaining, l.expires_at
      from public.credit_lots_of(p_person) l
     order by l.expires_at nulls last, l.seq;
end;
$$;

comment on function public.credit_live_lots(uuid) is
  'Each live lot of the person, what is left in it and when it ends (null: not while her subscription is alive), the nearest end first. Refuses another person (42501) to anyone but the platform admin and service_role.';

create function public.credits_balance(p_person uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.credit_check_reader(p_person);
  return public.credit_balance_of(p_person);
end;
$$;

comment on function public.credits_balance(uuid) is
  'The person''s balance: the sum of her live lots. A lot past its end leaves it at once, whether the routine closed it or not. Refuses another person (42501) to anyone but the platform admin and service_role.';


-- What an action costs -------------------------------------------------------------

-- The one place the cost is decided: the action's row in the brand of her
-- organization (the one she is a student of first). #292 makes it read the
-- Founder seal here. Executed by nobody: credit_cost and credit_debit call it.
create function public.credit_price(p_person uuid, p_action text)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_brand text;
  v_credits integer;
begin
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
  'What one unit of the action costs the person, from credit_costs in the brand of her organization. Refuses an action without a cost there (credit_cost_known). Called by credit_cost and credit_debit only.';

create function public.credit_cost(p_person uuid, p_action text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.credit_check_reader(p_person);
  return public.credit_price(p_person, p_action);
end;
$$;

comment on function public.credit_cost(uuid, text) is
  'What one unit of the action costs the person, in credits. She reads her own; another person''s is refused (42501) to anyone but the platform admin and service_role. Refuses an action without a cost in her brand (credit_cost_known).';


-- Closing what ended ---------------------------------------------------------------

-- Closes each lot of the person past its end: an expire with what was left
-- (zero too, to mark it closed). A closed lot never comes back, not even when
-- she subscribes again. Its caller holds the person's lock.
create function public.credit_close_expired(p_person uuid, out closed integer)
language plpgsql
set search_path = ''
as $$
declare
  v_deadline timestamptz := public.credit_deadline(p_person);
  v_lot record;
  v_rows integer;
begin
  closed := 0;
  for v_lot in
    select l.id, l.organization_id,
           (select sum(e.amount) from public.credit_entries e
             where e.id = l.id or e.lot_id = l.id)::integer as remaining
      from public.credit_entries l
     where l.person_id = p_person
       and l.lot_id is null
       and least(l.expires_at, v_deadline) <= now()
       and not exists (select 1 from public.credit_entries x
                        where x.lot_id = l.id and x.kind = 'expire')
     order by l.seq
  loop
    insert into public.credit_entries (organization_id, person_id, kind, amount, lot_id)
      values (v_lot.organization_id, p_person, 'expire', -v_lot.remaining, v_lot.id)
      on conflict (kind, lot_id) where kind in ('expire', 'void') do nothing;
    get diagnostics v_rows = row_count;
    closed := closed + v_rows;
  end loop;
end;
$$;

comment on function public.credit_close_expired(uuid) is
  'Closes each lot of the person past its end (its own, or hers after a cancel) with an expire of what was left. Returns how many it closed. Its caller holds the person''s lock.';


-- Granting and taking back a charge's months --------------------------------------------

-- Every month of a paid charge that started, once
-- (credit_entries_one_grant_per_period), without an end: a Pix paid ahead
-- grants on its due day, so the next month never adds to the current one. The
-- credits come from the subscription (Q5), and stop at its ceiling (also kept on it):
-- what would pass it is not granted, and the month is decided (a lot of 0
-- when the ceiling is reached). A charge whose money went back has what is
-- left of its live lots voided: what was spent stays spent, and its later
-- months are never granted. Anything else (pending, overdue, a refund on its
-- way) does nothing. Takes the person's lock.
create function public.credit_settle(
  p_payment_id text, out granted integer, out granted_lots integer, out voided integer)
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_sub public.subscriptions;
  v_ceiling bigint;
  v_amount integer;
  v_month integer;
  v_lot record;
  v_rows integer;
begin
  granted := 0;
  granted_lots := 0;
  voided := 0;
  select * into v_payment from public.payments where asaas_payment_id = p_payment_id;
  if not found or v_payment.kind <> 'cycle' then
    return;
  end if;
  select * into v_sub from public.subscriptions where id = v_payment.subscription_id;
  perform public.credit_lock_person(v_sub.person_id);

  if public.credit_payment_grants(v_payment) then
    if v_sub.monthly_credits = 0 then
      return;
    end if;
    v_ceiling := v_sub.credit_ceiling_months::bigint * v_sub.monthly_credits;
    for v_month in 0 .. (case v_sub.cycle when 'annual' then 11 else 0 end) loop
      continue when public.credit_month_starts(v_payment.due_on, v_month) > now();
      continue when exists (select 1 from public.credit_entries g
                             where g.kind = 'plan' and g.asaas_payment_id = p_payment_id
                               and g.period = v_month);
      v_amount := greatest(0, least(v_sub.monthly_credits::bigint,
                                    v_ceiling - public.credit_balance_of(v_sub.person_id)));
      insert into public.credit_entries
        (organization_id, person_id, kind, amount, asaas_payment_id, period, subscription_id)
        values (v_sub.organization_id, v_sub.person_id, 'plan', v_amount,
                p_payment_id, v_month, v_sub.id)
        on conflict (asaas_payment_id, period) where kind = 'plan' do nothing;
      get diagnostics v_rows = row_count;
      granted := granted + v_rows * v_amount;
      -- A month decided at 0 by the ceiling granted nothing.
      granted_lots := granted_lots + case when v_amount > 0 then v_rows else 0 end;
    end loop;
  elsif public.credit_payment_taken_back(v_payment) then
    for v_lot in select * from public.credit_payment_open_lots(p_payment_id) loop
      continue when v_lot.remaining <= 0;
      insert into public.credit_entries (organization_id, person_id, kind, amount, lot_id)
        values (v_lot.organization_id, v_lot.person_id, 'void', -v_lot.remaining, v_lot.lot_id)
        on conflict (kind, lot_id) where kind in ('expire', 'void') do nothing;
      get diagnostics v_rows = row_count;
      voided := voided + v_rows * v_lot.remaining;
    end loop;
  end if;
end;
$$;

comment on function public.credit_settle(text) is
  'Grants every month a paid charge has started, once, up to the subscription''s ceiling, or voids what is left of the live lots of a charge whose money went back. Returns the credits and lots granted and the credits voided. Called by credit_settle_payment, credit_daily and credit_grant_started.';

-- For the webhook, after it wrote the charge as the provider has it now.
create function public.credit_settle_payment(p_payment_id text)
returns integer
language sql
security definer
set search_path = ''
as $$
  select s.granted - s.voided from public.credit_settle(p_payment_id) s;
$$;

comment on function public.credit_settle_payment(text) is
  'What a charge, as last read, means for the credits: grants the months it started (once by charge and month, up to the ceiling), or voids what is left of its lots when its money went back. Returns the credits granted minus the credits voided. For the webhook, executed by service_role.';

-- The months of her paid charges that already started, granted now rather
-- than at the routine: a month paid ahead starts at midnight, the routine
-- runs in the morning, and a debit in between must see it. Its caller holds
-- the person's lock.
create function public.credit_grant_started(p_person uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_payment_id text;
begin
  for v_payment_id in
    select p.asaas_payment_id
      from public.payments p
     where p.person_id = p_person
       and p.due_on > (now() at time zone 'America/Sao_Paulo')::date - 400
       and p.due_on <= (now() at time zone 'America/Sao_Paulo')::date
       and public.credit_payment_grants(p)
     order by p.due_on, p.asaas_payment_id
  loop
    perform public.credit_settle(v_payment_id);
  end loop;
end;
$$;

comment on function public.credit_grant_started(uuid) is
  'Grants the months of the person''s paid charges that already started and were not granted yet (a charge paid ahead, before the routine runs). Called by credit_debit and credit_refund, which hold her lock.';

-- The daily routine: every paid charge of the last 400 days (an annual one
-- month by month, and anything the webhook missed) and every charge whose
-- money went back with a lot still open is settled; then every lot past its
-- end is closed. One transaction: each person's lock is held until it ends,
-- which is short at this size.
create function public.credit_daily(out granted integer, out closed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id text;
  v_person uuid;
  v_settled record;
  v_closed record;
begin
  granted := 0;
  closed := 0;
  for v_payment_id in
    select p.asaas_payment_id
      from public.payments p
     where (public.credit_payment_grants(p)
            and p.due_on > (now() at time zone 'America/Sao_Paulo')::date - 400
            and p.due_on <= (now() at time zone 'America/Sao_Paulo')::date)
        or (public.credit_payment_taken_back(p)
            and exists (select 1 from public.credit_payment_open_lots(p.asaas_payment_id) o
                         where o.remaining > 0))
     order by p.due_on, p.asaas_payment_id
  loop
    select * into v_settled from public.credit_settle(v_payment_id);
    granted := granted + v_settled.granted_lots;
  end loop;

  for v_person in
    with holders as (
      select distinct l.person_id
        from public.credit_entries l
       where l.lot_id is null
         and not exists (select 1 from public.credit_entries x
                          where x.lot_id = l.id and x.kind = 'expire'))
    select o.person_id
      from holders o
     cross join lateral (select public.credit_deadline(o.person_id) as deadline) d
     where exists (select 1 from public.credit_entries l
                    where l.person_id = o.person_id
                      and l.lot_id is null
                      and least(l.expires_at, d.deadline) <= now()
                      and not exists (select 1 from public.credit_entries x
                                       where x.lot_id = l.id and x.kind = 'expire'))
  loop
    perform public.credit_lock_person(v_person);
    select * into v_closed from public.credit_close_expired(v_person);
    closed := closed + v_closed.closed;
  end loop;
end;
$$;

comment on function public.credit_daily() is
  'The daily step of the credits: grants the months that started (an annual charge month by month, and any grant the webhook missed), voids what a charge whose money went back left, and closes every lot past its end. Returns how many lots it granted and closed. Executed by service_role.';


-- Spending and giving back ------------------------------------------------------------------

-- The debit, server side only (Q3: whole credits; the live session debits a
-- minute at its start and checks every 10 s). Takes the person's lock,
-- grants her months that started and closes what ended, and writes one row
-- per lot it touches: the lot that ends first first, the lots without an end
-- last, the oldest first. Executed by nobody: the security definer function
-- that needs it (the booking of #276) calls it in its transaction.
create function public.credit_debit(
  p_person uuid, p_action text, p_quantity integer, p_reference text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost integer;
  v_total bigint;
  v_balance integer;
  v_left bigint;
  v_take integer;
  v_lot record;
begin
  perform public.credit_lock_person(p_person);
  perform public.credit_grant_started(p_person);
  perform public.credit_close_expired(p_person);

  if p_quantity is null or p_quantity < 1 then
    raise exception 'credit_debit_quantity_positive: a debit takes one unit or more, got %', p_quantity
      using errcode = 'check_violation', constraint = 'credit_debit_quantity_positive';
  end if;
  v_cost := public.credit_price(p_person, p_action);
  if exists (select 1 from public.credit_entries
              where person_id = p_person and kind = 'debit' and reference = p_reference) then
    raise exception 'credit_debit_reference_used: % was already debited for person %', p_reference, p_person
      using errcode = 'unique_violation', constraint = 'credit_debit_reference_used';
  end if;

  v_total := v_cost::bigint * p_quantity;
  v_balance := public.credit_balance_of(p_person);
  if v_balance < v_total then
    raise exception 'credits_not_negative: % costs %, and person % has %', p_action, v_total, p_person, v_balance
      using errcode = 'check_violation', constraint = 'credits_not_negative';
  end if;

  v_left := v_total;
  for v_lot in
    select l.lot_id, l.remaining, l.organization_id
      from public.credit_lots_of(p_person) l
     where l.remaining > 0
     order by l.expires_at nulls last, l.seq
  loop
    exit when v_left = 0;
    v_take := least(v_lot.remaining, v_left);
    insert into public.credit_entries
      (organization_id, person_id, kind, amount, lot_id, action, reference)
      values (v_lot.organization_id, p_person, 'debit', -v_take, v_lot.lot_id, p_action, p_reference);
    v_left := v_left - v_take;
  end loop;
  return public.credit_balance_of(p_person);
end;
$$;

comment on function public.credit_debit(uuid, text, integer, text) is
  'Spends the cost of p_quantity units of the action from the person''s live lots (the nearest end first, the lots without an end last, the oldest first) and returns her balance. Refuses a reference already debited (credit_debit_reference_used), an action without a cost in her brand (credit_cost_known) and a balance that does not cover it (credits_not_negative). Takes her lock first, so two debits of hers wait for each other. Executed by nobody: called by other security definer functions.';

-- The refund of a debit (a lesson canceled, #276), once per debit row. It
-- goes back to the lot it came from while that lot is alive. Once that lot
-- is gone (closed), it opens a lot of its own (Q8): without an end while
-- she has a subscription alive, ending in a month otherwise (and never after
-- her own end). A debit from a lot that was voided, or whose charge's money
-- went back (even if the lot ended first), is not given back: those credits
-- left with the money. Executed by
-- nobody, like the debit.
create function public.credit_refund(p_person uuid, p_reference text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debit record;
  v_rows integer;
  v_back integer := 0;
begin
  perform public.credit_lock_person(p_person);
  perform public.credit_grant_started(p_person);
  perform public.credit_close_expired(p_person);
  for v_debit in
    select d.id, d.organization_id, d.amount, d.lot_id, d.action, d.reference,
           (exists (select 1 from public.credit_entries v
                     where v.lot_id = d.lot_id and v.kind = 'void')
            or exists (select 1 from public.credit_entries g
                         join public.payments p on p.asaas_payment_id = g.asaas_payment_id
                        where g.id = d.lot_id and public.credit_payment_taken_back(p)))
             as lot_voided,
           exists (select 1 from public.credit_lots_of(p_person) l
                    where l.lot_id = d.lot_id) as lot_alive
      from public.credit_entries d
     where d.person_id = p_person and d.kind = 'debit' and d.reference = p_reference
     order by d.seq
  loop
    continue when v_debit.lot_voided;
    if v_debit.lot_alive then
      insert into public.credit_entries
        (organization_id, person_id, kind, amount, lot_id, refers_to, action, reference)
        values (v_debit.organization_id, p_person, 'refund', -v_debit.amount, v_debit.lot_id,
                v_debit.id, v_debit.action, v_debit.reference)
        on conflict (kind, refers_to) where refers_to is not null do nothing;
    else
      insert into public.credit_entries
        (organization_id, person_id, kind, amount, expires_at, refers_to, action, reference)
        values (v_debit.organization_id, p_person, 'refund', -v_debit.amount,
                case when public.credit_alive(p_person) then null
                     else now() + interval '1 month' end,
                v_debit.id, v_debit.action, v_debit.reference)
        on conflict (kind, refers_to) where refers_to is not null do nothing;
    end if;
    get diagnostics v_rows = row_count;
    v_back := v_back - v_rows * v_debit.amount;
  end loop;
  return v_back;
end;
$$;

comment on function public.credit_refund(uuid, text) is
  'Gives back every debit of the person under the reference, once each (credit_entries_once_per_entry): to its lot while it is alive, as a new lot once it is gone (without an end while her subscription is alive, in a month otherwise). A debit from a voided lot is not given back. Returns the credits given back, 0 when there is nothing to give. Executed by nobody: called by other security definer functions.';


-- The proportional refund (CDC art. 49) ------------------------------------------------------

-- What a charge paid for and did not use: what is left in its live lots,
-- what the ceiling cut from its months, plus its months not granted yet (an
-- annual charge's months ahead). The
-- value back is rounded up to the cent, never against the person. A charge
-- whose plan grants no credits had nothing to use: all of it. A charge that
-- does not grant (not paid, refunded, deleted) is worth 0. Q7: who triggers
-- the refund is #297.
create function public.credit_refund_quote(
  p_payment_id text,
  out payment_credits integer,
  out unused_credits integer,
  out refund_cents integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_sub public.subscriptions;
  v_months integer;
  v_month integer;
begin
  payment_credits := 0;
  unused_credits := 0;
  refund_cents := 0;
  select * into v_payment from public.payments where asaas_payment_id = p_payment_id;
  if not found or not public.credit_payment_grants(v_payment) then
    return;
  end if;
  select * into v_sub from public.subscriptions where id = v_payment.subscription_id;
  v_months := case v_sub.cycle when 'annual' then 12 else 1 end;
  payment_credits := v_sub.monthly_credits * v_months;
  if payment_credits = 0 then
    refund_cents := v_payment.value_cents;
    return;
  end if;

  select coalesce(sum(l.remaining), 0) into unused_credits
    from public.credit_payment_lots(p_payment_id) l;
  -- What the ceiling cut from a month was paid for and never received.
  unused_credits := unused_credits
    + coalesce((select sum(v_sub.monthly_credits - e.amount) from public.credit_entries e
                 where e.kind = 'plan' and e.asaas_payment_id = p_payment_id), 0);
  for v_month in 0 .. v_months - 1 loop
    if not exists (select 1 from public.credit_entries e
                    where e.kind = 'plan' and e.asaas_payment_id = p_payment_id
                      and e.period = v_month) then
      unused_credits := unused_credits + v_sub.monthly_credits;
    end if;
  end loop;
  unused_credits := least(unused_credits, payment_credits);
  refund_cents := ((v_payment.value_cents::bigint * unused_credits + payment_credits - 1)
                   / payment_credits)::integer;
end;
$$;

comment on function public.credit_refund_quote(text) is
  'The proportional refund of a paid charge: the credits it paid for, the ones not used (left in its live lots, plus its months not granted yet), and the value back in cents, rounded up. 0 for a charge that does not grant. Executed by service_role.';


-- The subscription's side ----------------------------------------------------------------------

-- When a subscription with a trial starts running (as 0049 marks the trial
-- used), its plan's trial_credits open a lot that ends at midnight in São
-- Paulo of first_due_on, the day of the first charge. Once per subscription
-- (credit_entries_one_trial_per_subscription). A first_due_on already passed
-- (events that came late) grants nothing. The billing functions of 0049 do
-- not change.
create function public.credit_grant_trial()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_credits integer;
  v_until timestamptz;
begin
  if not new.with_trial
     or new.status not in ('trialing', 'awaiting', 'active', 'past_due')
     or (tg_op = 'UPDATE' and old.status = new.status) then
    return null;
  end if;
  v_until := new.first_due_on::timestamp at time zone 'America/Sao_Paulo';
  if v_until <= now() then
    return null;
  end if;
  select p.trial_credits into v_credits from public.plans p where p.id = new.plan_id;
  if coalesce(v_credits, 0) = 0 then
    return null;
  end if;
  perform public.credit_lock_person(new.person_id);
  insert into public.credit_entries
    (organization_id, person_id, kind, amount, expires_at, subscription_id)
    values (new.organization_id, new.person_id, 'trial', v_credits, v_until, new.id)
    on conflict (subscription_id) where kind = 'trial' do nothing;
  return null;
end;
$$;

create trigger subscriptions_grant_trial_credits
  after insert or update of status on public.subscriptions
  for each row execute function public.credit_grant_trial();

-- Before a subscription of hers starts running, the lots that already ended
-- are closed: once it runs, her lots have no end again, and one that ended
-- must not come back with them. Before, so the end is still read from the
-- subscriptions as they were.
create function public.credit_close_before_alive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('trialing', 'awaiting', 'active', 'past_due')
     and (tg_op = 'INSERT' or old.status not in ('trialing', 'awaiting', 'active', 'past_due')) then
    perform public.credit_lock_person(new.person_id);
    perform public.credit_close_expired(new.person_id);
  end if;
  return new;
end;
$$;

create trigger subscriptions_close_ended_credits
  before insert or update of status on public.subscriptions
  for each row execute function public.credit_close_before_alive();


-- Who executes what ----------------------------------------------------------------------------

revoke all on function public.credit_subscription_copies_plan() from public, anon, authenticated;
revoke all on function public.credit_entries_refuse_edit() from public, anon, authenticated;
revoke all on function public.credit_entries_check_lot() from public, anon, authenticated;
revoke all on function public.credit_grant_trial() from public, anon, authenticated;
revoke all on function public.credit_close_before_alive() from public, anon, authenticated;
revoke all on function public.credit_lock_person(uuid) from public, anon, authenticated;
revoke all on function public.credit_month_starts(date, integer) from public, anon, authenticated;
revoke all on function public.credit_payment_grants(public.payments) from public, anon, authenticated;
revoke all on function public.credit_payment_taken_back(public.payments) from public, anon, authenticated;
revoke all on function public.credit_alive(uuid) from public, anon, authenticated;
revoke all on function public.credit_deadline(uuid) from public, anon, authenticated;
revoke all on function public.credit_lots_of(uuid) from public, anon, authenticated;
revoke all on function public.credit_balance_of(uuid) from public, anon, authenticated;
revoke all on function public.credit_payment_lots(text) from public, anon, authenticated;
revoke all on function public.credit_payment_open_lots(text) from public, anon, authenticated;
revoke all on function public.credit_check_reader(uuid) from public, anon, authenticated;
revoke all on function public.credit_live_lots(uuid) from public, anon, authenticated;
revoke all on function public.credits_balance(uuid) from public, anon, authenticated;
revoke all on function public.credit_price(uuid, text) from public, anon, authenticated;
revoke all on function public.credit_cost(uuid, text) from public, anon, authenticated;
revoke all on function public.credit_close_expired(uuid) from public, anon, authenticated;
revoke all on function public.credit_settle(text) from public, anon, authenticated;
revoke all on function public.credit_settle_payment(text) from public, anon, authenticated;
revoke all on function public.credit_grant_started(uuid) from public, anon, authenticated;
revoke all on function public.credit_daily() from public, anon, authenticated;
revoke all on function public.credit_debit(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.credit_refund(uuid, text) from public, anon, authenticated;
revoke all on function public.credit_refund_quote(text) from public, anon, authenticated;

-- Her screen reads her lots, her balance and her costs; service_role too.
grant execute on function public.credit_live_lots(uuid) to authenticated, service_role;
grant execute on function public.credits_balance(uuid) to authenticated, service_role;
grant execute on function public.credit_cost(uuid, text) to authenticated, service_role;
-- The webhook and the daily routine (as the billing functions of 0049).
grant execute on function public.credit_settle_payment(text) to service_role;
grant execute on function public.credit_daily() to service_role;
grant execute on function public.credit_refund_quote(text) to service_role;
