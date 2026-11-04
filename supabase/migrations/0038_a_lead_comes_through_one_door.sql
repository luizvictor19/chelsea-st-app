-- A lead comes through one door. Issue #146, number 0038 approved by Luiz on
-- 2026-11-04.
--
-- Until now the form on chelsea-st.com (repo luizvictor19/chelsea-st-site,
-- api/lead.js) inserted into leads with the service role key, a key that
-- passes every policy of every table. From here the site calls submit_lead
-- with the publishable key, as anon, and the service role loses the insert it
-- had on leads. The site stops holding the service role key.
--
-- A number sent twice is kept twice: each send is a row, so the second send
-- (a trial after a place on the waitlist, say) loses nothing of the first, nor
-- the campaign that brought the person first. The latest send of each number
-- is in the view leads_latest.
--
-- The number stored is always the one the site normalizes, with the 55: a call
-- made straight to the API with the publishable key skips the site, and
-- without the check 11980797516 and 5511980797516 would be two people.
--
-- Measured through the MCP on 2026-11-04, before this migration (0001 to 0037
-- applied):
--   leads: 0 rows (2 inserted and 2 deleted since 0036, the test leads), so 0
--     numbers repeated and 0 outside ^55[0-9]{10,11}$; 11 constraints, the key
--     and the 10 checks of 0036, leads_whatsapp_digits among them; 0 policies;
--     relacl {postgres=arwdDxtm/postgres,service_role=a/postgres}.
--   No submit_lead and no leads_latest yet.
--   Default ACL of postgres in public: tables {postgres=arwdDxtm/postgres}
--     (0037), functions {postgres=X/postgres}. A schema's default ACL adds to
--     the built-in one and cannot take from it, so a function postgres
--     creates here is still born executable by PUBLIC: the 15 functions of
--     public with a null proacl, the built-in default, are all executable by
--     anon. Hence the revoke from public below.
-- Should a row outside the new check appear before the push, the alter table
-- fails on it, out loud; nothing is rewritten.

alter table public.leads
  drop constraint leads_whatsapp_digits,
  add constraint leads_whatsapp_br check (whatsapp ~ '^55[0-9]{10,11}$');

comment on column public.leads.whatsapp is
  'WhatsApp number as the site normalizes it: 55, then the area code and the number, 12 or 13 digits; no mask, no plus sign.';

comment on table public.leads is
  'One send of the chelsea-st.com form: waitlist or trial. Written only through submit_lead, by anon, from the site''s function; nobody reads it through the API. A number sent twice is two rows; leads_latest has the latest of each.';

-- The door ----------------------------------------------------------------------------
--
-- Security definer, so anon writes a row without holding insert on the table,
-- and without select or update: it cannot read back, list or change any lead.
-- It returns nothing, not even the id. The parameters carry the names of the
-- columns, so the JSON the site already sends is the body of the call, and
-- inside they are qualified with the function's name. Every check of leads
-- holds through it as it holds straight into the table.
--
-- created_at is clock_timestamp(), not the default now(): two sends in one
-- transaction get two instants, in order, so leads_latest never has to choose
-- between equal times among the rows written here. Each call through the API
-- is a transaction of its own, where the two are the same. The column default
-- stays now(): only a row written some other way (by postgres, in the
-- dashboard) takes it, and two of those in one transaction would tie.
--
-- An empty search_path: every name below is qualified, and nothing the caller
-- sets can stand in for public.leads.

create function public.submit_lead(
  nome text,
  whatsapp text,
  interesse text,
  objetivo text default null,
  nivel text default null,
  utm_source text default null,
  utm_medium text default null,
  utm_campaign text default null,
  codigo_origem text default null,
  user_agent text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.leads (
    created_at, nome, whatsapp, interesse, objetivo, nivel,
    utm_source, utm_medium, utm_campaign, codigo_origem, user_agent
  ) values (
    pg_catalog.clock_timestamp(), submit_lead.nome, submit_lead.whatsapp,
    submit_lead.interesse, submit_lead.objetivo, submit_lead.nivel,
    submit_lead.utm_source, submit_lead.utm_medium, submit_lead.utm_campaign,
    submit_lead.codigo_origem, submit_lead.user_agent
  );
$$;

comment on function public.submit_lead(text, text, text, text, text, text, text, text, text, text) is
  'The only way a lead is written: called by anon from the chelsea-st.com function with the publishable key. Security definer and executable by anon on purpose (Supabase advisor 0028): it writes one row of leads under its checks and returns nothing, so it reads no lead back.';

-- Executed by anon and nobody else. PUBLIC goes first: authenticated would
-- otherwise call it through PUBLIC.
revoke all on function public.submit_lead(text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_lead(text, text, text, text, text, text, text, text, text, text)
  to anon;

-- The service role inserted straight into leads until today; it no longer
-- does, and holds nothing on the table.
revoke insert on public.leads from service_role;

-- The latest send of each number --------------------------------------------------------
--
-- Derived from created_at, so it never disagrees with the table; the id only
-- breaks a tie, which clock_timestamp() leaves no room for among the rows
-- submit_lead writes. Security invoker:
-- it reads leads as whoever queries it, so it opens nothing the table keeps
-- closed. Nobody of the API holds any privilege on it; postgres reads it in
-- the dashboard. The revoke all stands even with the default ACL of 0037,
-- which the dashboard can change.

create view public.leads_latest
  with (security_invoker = true)
as
  select distinct on (whatsapp) *
    from public.leads
   order by whatsapp, created_at desc, id desc;

comment on view public.leads_latest is
  'The latest send of each WhatsApp number in leads, one row per number. Read only by postgres, in the dashboard.';

revoke all on public.leads_latest from anon, authenticated, service_role;
