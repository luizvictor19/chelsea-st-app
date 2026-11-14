-- A withdrawal gives back what was not used (issue #297, CDC art. 49, ADR 0006).
--
-- 0050 (#273, Q7) gave the proportional refund its value
-- (credit_refund_quote) and the void of a charge's lots once the provider
-- says its money went back. This migration gives the person the way to ask
-- for it, as the plan approved by Luiz on 14/11 says (Q1 B, Q2 A, Q4 A, Q5 A):
--
--   1. refund_requests: one row per request, reserved in the database before
--      the provider is called, as overdue_steps reserves a step (Q4): a second
--      click, or an answer lost on the way, never asks for two refunds. One
--      open (requested or sent) per person (refund_requests_one_open), one
--      not failed per charge (refund_requests_once_per_payment). The value is
--      the database's, from credit_refund_quote (Q2 A), kept on the row.
--   2. The window (Q1 B): the first charge paid of a subscription, until the
--      end (23h59 in São Paulo) of the 7th day after the day it was paid. A
--      renewal opens none. billing_refund_window says which charge, if any.
--   3. No lesson ahead (Q5 A): while she has a scheduled lesson that has not
--      ended, the request is refused (billing_refund_lessons_ahead). She
--      cancels it first, by cancel_lesson and its own rules; a lesson canceled
--      after the value was computed would give its credits back to a lot the
--      void then takes, against her.
--   4. Nothing is spent while a request is open (Q4 A): credit_debit, the one
--      way credits are spent, is recreated on 0050's body with one refusal
--      more, credit_refund_open. Done or failed lets it spend again.
--
-- The functions are security definer, owned by postgres, search_path empty,
-- and executed by service_role alone, the exception of the billing functions
-- of 0049 (docs/context.md): billing_refund_quote (what the screen shows),
-- billing_open_refund, billing_refund_sent, billing_refund_failed,
-- billing_refund_reading (what the provider says of the refund, at every
-- reading of the charge) and billing_refunds_open (the daily routine).
-- billing_refund_window is executed by nobody.
--
-- The provider's refund status is read verbatim: a request is done only when
-- a refund of its value is DONE ("Considere o estorno concluído somente
-- quando o campo status retornar DONE", docs.asaas.com/docs/estornos, read on
-- 14/11), failed when every refund of its value is CANCELLED. The void of the
-- lots stays 0050's: it follows payments.refunded_cents, which counts DONE
-- refunds only.
--
-- One function is recreated with its name and its ACL (executable by
-- nobody): credit_debit, 0050's body, and before its first check the open
-- request. scripts/restore-outside-public.sql does not change.
--
-- Measured on 2026-11-14 04:25 UTC through the MCP, read only, before this
-- was written: migrations applied through 0059; plans, subscriptions,
-- payments, credit_entries, billing_events and person_badges hold 0 rows; no
-- lesson has a debit; no table named like refund or withdrawal. No existing
-- row changes here.
--
-- A refusal raised here names its constraint twice: in the error, for
-- scripts/verify-rls.sql, and at the start of the message, because the API
-- passes the message on and not the constraint. No message carries a value.


-- The requests --------------------------------------------------------------------

create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.billing_customers on delete restrict,
  organization_id uuid not null references public.organizations on delete restrict,
  subscription_id uuid not null references public.subscriptions on delete restrict,
  asaas_payment_id text not null references public.payments on delete restrict,
  -- What credit_refund_quote said when the request was reserved.
  payment_credits integer not null
    constraint refund_requests_payment_credits_not_negative check (payment_credits >= 0),
  unused_credits integer not null,
  refund_cents integer not null
    constraint refund_requests_cents_positive check (refund_cents > 0),
  status text not null default 'requested'
    constraint refund_requests_status_known
      check (status in ('requested', 'sent', 'done', 'failed')),
  -- The provider's refunds[].status as last read, verbatim.
  asaas_refund_status text
    constraint refund_requests_asaas_status_shape check (asaas_refund_status ~ '^[A-Z_]{3,60}$'),
  error text
    constraint refund_requests_error_length check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  done_at timestamptz,
  failed_at timestamptz,
  constraint refund_requests_unused_within_payment
    check (unused_credits between 0 and payment_credits),
  constraint refund_requests_status_says_when
    check ((status in ('sent', 'done')) <= (sent_at is not null)
           and (status = 'done') = (done_at is not null)
           and (status = 'failed') = (failed_at is not null))
);

create unique index refund_requests_one_open
  on public.refund_requests (person_id) where status in ('requested', 'sent');
create unique index refund_requests_once_per_payment
  on public.refund_requests (asaas_payment_id) where status <> 'failed';

comment on table public.refund_requests is
  'A proportional refund a person asked for under CDC art. 49: the charge, the value computed by credit_refund_quote when it was reserved, and how it went at the provider (requested, sent, done, failed). One open per person, one not failed per charge. While one is open, credit_debit spends nothing of hers. Written only by the billing_refund functions, executed by service_role.';

alter table public.refund_requests enable row level security;

create policy refund_requests_read on public.refund_requests
  for select to authenticated
  using (person_id = (select auth.uid()) or (select public.is_platform_admin()));

grant select on public.refund_requests to authenticated;


-- The window (Q1 B) ------------------------------------------------------------------

-- The charge she may still withdraw from: the first charge paid of a
-- subscription of hers that still grants (paid, not deleted, nothing
-- refunded), until midnight in São Paulo that starts the 8th day after the
-- day it was paid, with no request of it that did not fail. paid_at keeps the
-- provider's payment day, a São Paulo calendar day the app sends as a date
-- (billing_save_payment), which the database keeps as midnight UTC; read as a
-- UTC date it is that day, and an instant read so is never earlier than its
-- São Paulo day: the window never ends before the person's 7th day. The
-- latest such charge when there are two.
create function public.billing_refund_window(p_person uuid)
returns table (asaas_payment_id text, subscription_id uuid, ends_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select w.asaas_payment_id, w.subscription_id, w.ends_at
    from (select p.asaas_payment_id, p.subscription_id, p.paid_at, p.due_on,
                 (((p.paid_at at time zone 'UTC')::date + 8)::timestamp
                   at time zone 'America/Sao_Paulo') as ends_at
            from public.payments p
           where p.person_id = p_person
             and p.paid_at is not null
             and public.credit_payment_grants(p)
             -- A renewal opens no window: an earlier charge of the same
             -- subscription was already paid.
             and not exists (select 1 from public.payments q
                              where q.subscription_id = p.subscription_id
                                and q.paid_at is not null
                                and (q.due_on, q.asaas_payment_id) < (p.due_on, p.asaas_payment_id))
             and not exists (select 1 from public.refund_requests r
                              where r.asaas_payment_id = p.asaas_payment_id
                                and r.status <> 'failed')) w
   where w.ends_at > now()
   order by w.paid_at desc, w.due_on desc
   limit 1;
$$;

comment on function public.billing_refund_window(uuid) is
  'The charge the person may still withdraw from (CDC art. 49, Q1 B of #297): the first charge paid of a subscription of hers that still grants, until the end of the 7th day in São Paulo after the day it was paid, with no request of it that did not fail. Executed by nobody: the billing_refund functions read it.';


-- What the screen shows -------------------------------------------------------------

-- The charge in her window and what would come back now, or no row. The
-- screen reads her open or finished request from refund_requests itself.
create function public.billing_refund_quote(p_person uuid)
returns table (
  asaas_payment_id text, ends_at timestamptz, payment_credits integer,
  unused_credits integer, refund_cents integer, lessons_ahead integer)
language sql
stable
security definer
set search_path = ''
as $$
  select w.asaas_payment_id, w.ends_at, q.payment_credits, q.unused_credits, q.refund_cents,
         (select count(*) from public.lessons l
           where l.student_id = p_person
             and l.status = 'scheduled'
             and l.scheduled_at + make_interval(mins => l.duration_minutes) > now())::integer
    from public.billing_refund_window(p_person) w
   cross join lateral public.credit_refund_quote(w.asaas_payment_id) q;
$$;

comment on function public.billing_refund_quote(uuid) is
  'What the plan screen shows of a withdrawal: the charge in her window (billing_refund_window), when the window ends, the credits it paid for and the ones not used, the value that would come back now (credit_refund_quote), and how many scheduled lessons of hers have not ended. No row when no charge is in the window. Executed by service_role.';


-- The request ------------------------------------------------------------------------

-- Reserved before the provider is called. Takes her credit lock, so no debit
-- of hers runs between the value and the row. Refuses an open request
-- (refund_requests_one_open), no charge in the window
-- (billing_refund_window), a scheduled lesson not ended
-- (billing_refund_lessons_ahead) and a value of 0 (billing_refund_nothing).
create function public.billing_open_refund(p_person uuid)
returns public.refund_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window record;
  v_quote record;
  v_sub public.subscriptions;
  v_row public.refund_requests;
begin
  perform public.credit_lock_person(p_person);

  if exists (select 1 from public.refund_requests
              where person_id = p_person and status in ('requested', 'sent')) then
    raise exception 'refund_requests_one_open: person % has a refund request open', p_person
      using errcode = 'unique_violation', constraint = 'refund_requests_one_open';
  end if;

  select * into v_window from public.billing_refund_window(p_person);
  if not found then
    raise exception 'billing_refund_window: person % has no charge within the 7 days', p_person
      using errcode = 'check_violation', constraint = 'billing_refund_window';
  end if;

  if exists (select 1 from public.lessons l
              where l.student_id = p_person
                and l.status = 'scheduled'
                and l.scheduled_at + make_interval(mins => l.duration_minutes) > now()) then
    raise exception 'billing_refund_lessons_ahead: person % has a scheduled lesson not ended', p_person
      using errcode = 'check_violation', constraint = 'billing_refund_lessons_ahead';
  end if;

  select * into v_quote from public.credit_refund_quote(v_window.asaas_payment_id);
  if coalesce(v_quote.refund_cents, 0) <= 0 then
    raise exception 'billing_refund_nothing: charge % gives nothing back', v_window.asaas_payment_id
      using errcode = 'check_violation', constraint = 'billing_refund_nothing';
  end if;

  select * into v_sub from public.subscriptions where id = v_window.subscription_id;
  insert into public.refund_requests (
    person_id, organization_id, subscription_id, asaas_payment_id,
    payment_credits, unused_credits, refund_cents
  ) values (
    p_person, v_sub.organization_id, v_sub.id, v_window.asaas_payment_id,
    v_quote.payment_credits, v_quote.unused_credits, v_quote.refund_cents
  )
  returning * into v_row;
  return v_row;
end;
$$;

comment on function public.billing_open_refund(uuid) is
  'Reserves the person''s withdrawal before the provider is called: the charge in her window and the value credit_refund_quote gives now, as requested. Takes her credit lock. Refuses an open request (refund_requests_one_open), no charge within the 7 days (billing_refund_window), a scheduled lesson not ended (billing_refund_lessons_ahead) and a value of 0 (billing_refund_nothing). Executed by service_role.';

-- The provider took the request: it waits there (PENDING, or the critical
-- event's authorization in the panel, Q3 A) until a refund of its value is
-- DONE or CANCELLED. Only a requested row moves.
create function public.billing_refund_sent(p_id uuid, p_asaas_refund_status text)
returns text
language sql
security definer
set search_path = ''
as $$
  with moved as (
    update public.refund_requests
       set status = 'sent', sent_at = now(),
           asaas_refund_status = coalesce(p_asaas_refund_status, asaas_refund_status)
     where id = p_id and status = 'requested'
    returning status)
  select coalesce((select status from moved),
                  (select status from public.refund_requests where id = p_id));
$$;

comment on function public.billing_refund_sent(uuid, text) is
  'Marks a requested withdrawal as taken by the provider, with the refund status it answered. Returns the request''s status after. Executed by service_role.';

-- The provider refused, or never had it: the request ends and she may spend
-- and ask again. A done one never fails.
create function public.billing_refund_failed(p_id uuid, p_error text)
returns text
language sql
security definer
set search_path = ''
as $$
  with moved as (
    update public.refund_requests
       set status = 'failed', failed_at = now(), error = left(coalesce(p_error, 'failed'), 500)
     where id = p_id and status in ('requested', 'sent')
    returning status)
  select coalesce((select status from moved),
                  (select status from public.refund_requests where id = p_id));
$$;

comment on function public.billing_refund_failed(uuid, text) is
  'Ends a requested or sent withdrawal as failed, with the reason: her credits are spendable again and she may ask again. Returns the request''s status after. Executed by service_role.';

-- What the provider holds of the charge's refunds now ([{status, value_cents}]),
-- at every reading of the charge: a refund of the request's value DONE makes
-- it done; one of any other status but CANCELLED makes a requested one sent;
-- refunds of its value all CANCELLED make it failed. A requested one with no
-- refund of its value stays as it is: its call may still be on the way, and
-- the daily routine decides after a while. Returns the status of the
-- charge's open request after, or null when it has none.
create function public.billing_refund_reading(p_payment_id text, p_refunds jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.refund_requests;
  v_statuses text[];
  v_live text;
begin
  select * into v_row from public.refund_requests
   where asaas_payment_id = p_payment_id and status in ('requested', 'sent')
   for update;
  if not found then
    return null;
  end if;

  select coalesce(array_agg(e->>'status'), '{}') into v_statuses
    from jsonb_array_elements(coalesce(p_refunds, '[]'::jsonb)) e
   where (e->>'value_cents')::integer = v_row.refund_cents;

  if 'DONE' = any (v_statuses) then
    update public.refund_requests
       set status = 'done', done_at = now(), sent_at = coalesce(sent_at, now()),
           asaas_refund_status = 'DONE'
     where id = v_row.id;
    return 'done';
  end if;

  select s into v_live from unnest(v_statuses) s where s <> 'CANCELLED' limit 1;
  if v_live is not null then
    update public.refund_requests
       set status = 'sent', sent_at = coalesce(sent_at, now()), asaas_refund_status = v_live
     where id = v_row.id;
    return 'sent';
  end if;

  if cardinality(v_statuses) > 0 then
    update public.refund_requests
       set status = 'failed', failed_at = now(), asaas_refund_status = 'CANCELLED',
           error = 'the provider canceled the refund'
     where id = v_row.id;
    return 'failed';
  end if;

  return v_row.status;
end;
$$;

comment on function public.billing_refund_reading(text, jsonb) is
  'Writes what the provider holds of a charge''s refunds over its open withdrawal: a refund of its value DONE makes it done, one waiting makes it sent, all of its value CANCELLED make it failed; a requested one with none stays. Returns the status after, or null when the charge has no open request. Executed by service_role.';

-- The open requests, for the daily routine: each with the provider's ids of
-- its charge and subscription.
create function public.billing_refunds_open()
returns table (
  id uuid, person_id uuid, status text, created_at timestamptz,
  asaas_payment_id text, asaas_subscription_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.person_id, r.status, r.created_at, r.asaas_payment_id, s.asaas_subscription_id
    from public.refund_requests r
    join public.subscriptions s on s.id = r.subscription_id
   where r.status in ('requested', 'sent')
   order by r.created_at;
$$;

comment on function public.billing_refunds_open() is
  'Every withdrawal requested or sent, oldest first, with the provider ids of its charge and subscription. For the daily routine. Executed by service_role.';


-- Nothing is spent while a request is open (Q4 A) ----------------------------------------

-- 0050's body, and right after the lock the open request: the value was
-- computed from what she had then, so nothing of hers is spent until the
-- provider says done or failed.
create or replace function public.credit_debit(
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

  if exists (select 1 from public.refund_requests
              where person_id = p_person and status in ('requested', 'sent')) then
    raise exception 'credit_refund_open: person % has a refund request open', p_person
      using errcode = 'check_violation', constraint = 'credit_refund_open';
  end if;

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
  'Spends the cost of p_quantity units of the action from the person''s live lots (the nearest end first, the lots without an end last, the oldest first) and returns her balance. Refuses while she has a refund request open (credit_refund_open, 0060), a reference already debited (credit_debit_reference_used), an action without a cost in her brand (credit_cost_known) and a balance that does not cover it (credits_not_negative). Takes her lock first, so two debits of hers wait for each other. Executed by nobody: called by other security definer functions.';


-- Who executes what ---------------------------------------------------------------

revoke all on function public.billing_refund_window(uuid) from public, anon, authenticated, service_role;
revoke all on function public.billing_refund_quote(uuid) from public, anon, authenticated;
revoke all on function public.billing_open_refund(uuid) from public, anon, authenticated;
revoke all on function public.billing_refund_sent(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_refund_failed(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_refund_reading(text, jsonb) from public, anon, authenticated;
revoke all on function public.billing_refunds_open() from public, anon, authenticated;

grant execute on function public.billing_refund_quote(uuid) to service_role;
grant execute on function public.billing_open_refund(uuid) to service_role;
grant execute on function public.billing_refund_sent(uuid, text) to service_role;
grant execute on function public.billing_refund_failed(uuid, text) to service_role;
grant execute on function public.billing_refund_reading(text, jsonb) to service_role;
grant execute on function public.billing_refunds_open() to service_role;
