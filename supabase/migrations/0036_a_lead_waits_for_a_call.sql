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
    constraint leads_nome_length check (char_length(nome) between 2 and 80),
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
  utm_source text,
  utm_medium text,
  utm_campaign text,
  codigo_origem text,
  user_agent text
);

comment on table public.leads is
  'One request from the chelsea-st.com form: waitlist or trial. Written and read only with the service role.';
comment on column public.leads.nome is
  'Name as the person typed it, 2 to 80 characters.';
comment on column public.leads.whatsapp is
  'WhatsApp number, digits only, 10 to 13 of them (area code, optionally country code); no mask, no plus sign.';
comment on column public.leads.objetivo is
  'Why they want English, when they said: trabalho, viagem, destravar_fala or outro.';
comment on column public.leads.nivel is
  'Level they declare, when they said: zero, basico or intermediario.';
comment on column public.leads.interesse is
  'What they asked for: waitlist (a place when one opens) or trial (a trial lesson).';
comment on column public.leads.utm_source is 'utm_source of the visit that sent the form, if any.';
comment on column public.leads.utm_medium is 'utm_medium of the visit that sent the form, if any.';
comment on column public.leads.utm_campaign is 'utm_campaign of the visit that sent the form, if any.';
comment on column public.leads.codigo_origem is
  'Origin code carried by the link the person came from, if any.';
comment on column public.leads.user_agent is
  'User-Agent of the browser that sent the form, if the function recorded it.';

-- Row level security on, and deliberately no policy. With RLS enabled and no
-- policy, anon and authenticated see no row and can write none; the service
-- role bypasses RLS, so the site's function is the only reader and writer.
-- A policy added later is a decision about who may read a stranger's phone
-- number, and belongs in its own migration.
alter table public.leads enable row level security;

-- And the privileges go too, so the table is closed twice. Supabase's default
-- privileges grant every new table in public to anon and authenticated; the
-- revoke in 0001 covered only the tables that existed then.
revoke all on public.leads from anon, authenticated;
