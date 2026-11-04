-- A lead waits for a call. Number 0036 approved by Luiz on 2026-11-04.
--
-- The form on chelsea-st.com (repo luizvictor19/chelsea-st-site) writes one row
-- here per person who asks for a place on the waitlist or for a trial lesson.
-- The writer is a Vercel Function holding the service role key; nothing in this
-- app reads or writes the table yet.
--
-- The column names are Portuguese and stay exactly as they are: the site
-- already sends them under these names, and a rename here would break its
-- insert in silence.
--
-- A new table, so no existing row changes and there was nothing to measure.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null
    constraint leads_nome_length
      check (char_length(btrim(nome, E' \t\r\n')) >= 2 and char_length(nome) <= 80),
  whatsapp text not null
    constraint leads_whatsapp_digits check (whatsapp ~ '^[0-9]{10,13}$'),
  objetivo text
    constraint leads_objetivo_known
      check (objetivo in ('trabalho', 'viagem', 'destravar_fala', 'outro')),
  nivel text
    constraint leads_nivel_known
      check (nivel in ('zero', 'basico', 'intermediario')),
  interesse text not null
    constraint leads_interesse_known check (interesse in ('waitlist', 'trial')),
  utm_source text
    constraint leads_utm_source_length check (char_length(utm_source) <= 200),
  utm_medium text
    constraint leads_utm_medium_length check (char_length(utm_medium) <= 200),
  utm_campaign text
    constraint leads_utm_campaign_length check (char_length(utm_campaign) <= 200),
  codigo_origem text
    constraint leads_codigo_origem_length check (char_length(codigo_origem) <= 200),
  user_agent text
    constraint leads_user_agent_length check (char_length(user_agent) <= 512)
);

comment on table public.leads is
  'One request from the chelsea-st.com form: waitlist or trial. Inserted by the service role, which cannot read it back.';
comment on column public.leads.nome is
  'Name exactly as the person typed it: at most 80 characters as stored, and at least 2 once the spaces, tabs and line breaks at either end are left out.';
comment on column public.leads.whatsapp is
  'WhatsApp number, digits only, 10 to 13 of them (area code, optionally country code); no mask, no plus sign.';
comment on column public.leads.objetivo is
  'Why they want English, when they said: trabalho, viagem, destravar_fala or outro.';
comment on column public.leads.nivel is
  'Level they declare, when they said: zero, basico or intermediario.';
comment on column public.leads.interesse is
  'What they asked for: waitlist (a place when one opens) or trial (a trial lesson).';
comment on column public.leads.utm_source is
  'utm_source of the visit that sent the form, if any; at most 200 characters.';
comment on column public.leads.utm_medium is
  'utm_medium of the visit that sent the form, if any; at most 200 characters.';
comment on column public.leads.utm_campaign is
  'utm_campaign of the visit that sent the form, if any; at most 200 characters.';
comment on column public.leads.codigo_origem is
  'Origin code carried by the link the person came from, if any; at most 200 characters.';
comment on column public.leads.user_agent is
  'User-Agent of the browser that sent the form, if the function recorded it; at most 512 characters.';

-- Row level security on, and deliberately no policy. With RLS enabled and no
-- policy, anon and authenticated see no row and can write none; the service
-- role bypasses RLS, so the site's function is the only writer.
-- A policy added later is a decision about who may read a stranger's phone
-- number, and belongs in its own migration.
alter table public.leads enable row level security;

-- Privileges. "Automatically expose new tables" is off (0001), which keeps
-- select, insert, update and delete off a new table, but it does not leave the
-- table bare: in production the default ACL of the postgres role in schema
-- public still grants Dxtm (truncate, references, trigger, maintain) on every
-- new table to anon, authenticated and service_role. RLS does not filter
-- truncate, and none of the four is needed by anyone here. The revoke all
-- clears them for all three roles; it is required, not extra.
-- Then service_role gets insert and nothing more: api/lead.js on the site
-- sends Prefer: return=minimal and never reads a row back, so it has no use
-- for select, and a leaked key cannot list the phone numbers stored here.
revoke all on public.leads from anon, authenticated, service_role;
grant insert on public.leads to service_role;
