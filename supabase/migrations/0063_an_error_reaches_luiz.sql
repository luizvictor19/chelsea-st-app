-- An error reaches Luiz (issue #69, P1 option A of the plan of 14/11).
--
-- Until now an error that escaped (a render, an action, a route) went only
-- to the Vercel runtime log, which Hobby keeps 1 hour, and the failures the
-- app handles (the Asaas webhook setting an event aside, the daily routines)
-- only to the same log. Nobody heard of them unless someone told Luiz. This
-- keeps every error, already scrubbed by the app (src/lib/monitoring/
-- scrub.ts), for 30 days, and says which ones the app e-mails him about.
--
-- Measured through the MCP on 2026-11-14 before writing: migrations up to
-- 0059 applied; no table app_errors and no function app_error_*; the
-- database at 16 MB. 0060 to 0062 are not on main nor on any branch (#297
-- and #306 reserved 0060 and 0061). The migration touches no existing row.
--
--   1. app_errors: one row per error per day (UTC), by a fingerprint the
--      app computes (the sha256 of the kind, the route, the scrubbed message
--      without digits and the first frame). A repeat only counts. Every text
--      has a ceiling, the app cuts below it. No person: no user, no header,
--      no cookie, no IP, no body, no query (the app's type does not even
--      take them). No organization_id: an error is the platform's, as the
--      row of founder_program.
--   2. app_error_record: the one writer, executed by service_role alone. It
--      counts the repeat of the day, or writes the new row and says whether
--      to e-mail: a new row asks for an alert while the day has had fewer
--      than 20 (Resend Free sends 100 a day, shared with the invites and
--      billing). Past 200 new rows in a day the rest only count on one
--      overflow row, so a flood of made-up errors through /api/errors costs
--      at most 200 rows a day. Rows older than 30 days go in the same call.
--      The overflow row asks for no e-mail (the first 20 rows of such a day
--      spent them). Worst case 200 rows x 31 days x about 5 KB, 31 MB.
--   3. app_errors_recent: the last 30 days, for the platform admin alone
--      (/teacher/monitoring), empty for anyone else; executed by
--      authenticated.
--
-- Who reads and writes: nobody through the API. RLS on, no policy, and no
-- privilege on the table for anon, authenticated or service_role.


-- The rows --------------------------------------------------------------------------

create table public.app_errors (
  id bigint generated always as identity primary key,
  day date not null,
  -- The sha256 of the app, or 'overflow' for the one row of a day past 200.
  fingerprint text not null
    constraint app_errors_fingerprint_shape check (fingerprint ~ '^([0-9a-f]{64}|overflow)$'),
  kind text not null
    constraint app_errors_kind_known check (kind in ('server', 'client', 'job', 'overflow')),
  route text not null
    constraint app_errors_route_short check (char_length(route) between 1 and 200),
  message text not null
    constraint app_errors_message_short check (char_length(message) between 1 and 500),
  stack text
    constraint app_errors_stack_short check (char_length(stack) <= 4000),
  -- Next's hash of a server error, shown to the person on the error screen.
  digest text
    constraint app_errors_digest_shape check (digest ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- The first 7 characters of the commit deployed (VERCEL_GIT_COMMIT_SHA).
  release text
    constraint app_errors_release_shape check (release ~ '^[0-9a-f]{7}$'),
  count integer not null default 1
    constraint app_errors_count_positive check (count >= 1),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  -- Whether the app was told to e-mail Luiz about this row.
  alerted boolean not null default false,
  constraint app_errors_once_a_day unique (fingerprint, day),
  constraint app_errors_overflow_row check ((kind = 'overflow') = (fingerprint = 'overflow'))
);

comment on table public.app_errors is
  'The errors of the app (#69), already scrubbed of any person by the app: one row per error per day (UTC), a repeat only counts. Written only by app_error_record, executed by service_role; read only through app_errors_recent, by the platform admin. Kept 30 days.';

create index app_errors_recent_first on public.app_errors (last_at desc);
-- Every call reads the day's rows and removes the old days: by day.
create index app_errors_by_day on public.app_errors (day);

alter table public.app_errors enable row level security;
-- No policy: nobody reads or writes the rows through the API.
revoke all on public.app_errors from anon, authenticated, service_role;


-- The writer ------------------------------------------------------------------------

-- security definer, owned by postgres, search_path empty: the service role
-- holds no privilege on the table. One call at a time (an advisory lock),
-- so the day's counts of rows and alerts are read and written together.
create function public.app_error_record(
  p_fingerprint text,
  p_kind text,
  p_route text,
  p_message text,
  p_stack text,
  p_digest text,
  p_release text
)
returns table (alert boolean, day date, count integer, first_at timestamptz, overflow boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_alerts_a_day constant integer := 20;
  c_rows_a_day constant integer := 200;
  c_days_kept constant integer := 30;
  v_day date := (now() at time zone 'UTC')::date;
  v_row public.app_errors;
  v_alert boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('app_errors', 0));

  delete from public.app_errors e where e.day < v_day - c_days_kept;

  update public.app_errors e
     set count = e.count + 1, last_at = now()
   where e.fingerprint = p_fingerprint and e.day = v_day
  returning * into v_row;
  if found then
    return query select false, v_row.day, v_row.count, v_row.first_at, false;
    return;
  end if;

  -- The overflow row asks for no alert: by the 201st row of a day the first
  -- 20 have spent the day's alerts.
  if (select count(*) from public.app_errors e
       where e.day = v_day and e.fingerprint <> 'overflow') >= c_rows_a_day then
    insert into public.app_errors as e (day, fingerprint, kind, route, message)
    values (v_day, 'overflow', 'overflow', '-',
            format('more than %s different errors today: the rest are only counted here', c_rows_a_day))
    on conflict on constraint app_errors_once_a_day
      do update set count = e.count + 1, last_at = now()
    returning * into v_row;
    return query select false, v_row.day, v_row.count, v_row.first_at, true;
    return;
  end if;

  v_alert := (select count(*) from public.app_errors e where e.day = v_day and e.alerted)
             < c_alerts_a_day;

  insert into public.app_errors (day, fingerprint, kind, route, message, stack, digest, release, alerted)
  values (v_day, p_fingerprint, p_kind, p_route, p_message, p_stack, p_digest, p_release, v_alert)
  returning * into v_row;
  return query select v_row.alerted, v_row.day, v_row.count, v_row.first_at, false;
end;
$$;

comment on function public.app_error_record(text, text, text, text, text, text, text) is
  'Records one error of the app (#69), already scrubbed: counts the repeat of the day or writes the new row; a new row asks for an alert while the day has had fewer than 20; past 200 new rows a day the rest count on the overflow row; removes rows older than 30 days. Executed by service_role alone.';


-- The reader ------------------------------------------------------------------------

create function public.app_errors_recent()
returns table (
  day date,
  fingerprint text,
  kind text,
  route text,
  message text,
  stack text,
  digest text,
  release text,
  count integer,
  first_at timestamptz,
  last_at timestamptz,
  alerted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.day, e.fingerprint, e.kind, e.route, e.message, e.stack, e.digest, e.release,
         e.count, e.first_at, e.last_at, e.alerted
    from public.app_errors e
   where public.is_platform_admin()
     and e.day >= (now() at time zone 'UTC')::date - 30
   order by e.last_at desc
   limit 500;
$$;

comment on function public.app_errors_recent() is
  'The errors of the last 30 days, the latest first, at most 500 (#69): for the platform admin alone (/teacher/monitoring), no row for anyone else. Executed by authenticated.';


-- Who executes ----------------------------------------------------------------------

revoke all on function public.app_error_record(text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.app_errors_recent() from public, anon, service_role;

grant execute on function public.app_error_record(text, text, text, text, text, text, text)
  to service_role;
grant execute on function public.app_errors_recent() to authenticated;
