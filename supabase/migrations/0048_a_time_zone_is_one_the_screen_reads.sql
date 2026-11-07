-- A time zone is one the screen reads (#219).
--
-- profiles.timezone and lesson_schedules.timezone took any text.
-- profiles_update_self (0001) lets a person write her whole row through the
-- API, so `update profiles set timezone = 'x'` passed, and every use of the
-- zone broke on it: `at time zone` in materialize_lessons refuses it with
-- 22023, and Intl.DateTimeFormat on the screen throws a RangeError. 0044
-- guards only the team panel (team_practice falls back to São Paulo).
--
-- Measured through the MCP on 2026-11-07: 7 profiles and 1 schedule, every
-- one 'America/Sao_Paulo'; no check on either column. pg_timezone_names on
-- the project (Postgres 17.6) lists 1196 names, 598 of them under posix/.
-- Node 24's Intl.DateTimeFormat, which the app shows times with, refuses
-- every posix/ name and 'Factory', and accepts the other 597. Postgres also
-- accepts zones that are not in the list at all (offsets, abbreviations), so a
-- rule made of `at time zone` alone would let through names that break the
-- screen. The rule is the list, without those two.
--
-- A check cannot hold a subquery, so the list is read by a function. Stable,
-- not immutable: the list is the server's tzdata, and it changes when
-- Supabase updates it. A check runs only on a write, so a name that left the
-- list keeps the rows that hold it; the next write to such a row is refused.
-- Every row passes today, so no data changes.
--
-- Since 0047 a function is born executable by its owner alone. A check runs
-- with the privileges of whoever writes the row, so authenticated, which
-- writes both tables (profiles_update_self, lesson_schedules_write), executes
-- it. The two triggers that make a profile on signup are security definer,
-- owned by postgres, so a signup needs no grant. anon writes neither table.

create function public.is_known_time_zone(p_zone text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from pg_catalog.pg_timezone_names
     where name = p_zone
       and name not like 'posix/%'
       and name <> 'Factory'
  );
$$;

comment on function public.is_known_time_zone(text) is
  'A zone both Postgres and the screen read: in pg_timezone_names, not posix/, not Factory (0048, #219).';

grant execute on function public.is_known_time_zone(text) to authenticated;

alter table public.profiles
  add constraint profiles_timezone_known
  check (public.is_known_time_zone(timezone));

alter table public.lesson_schedules
  add constraint lesson_schedules_timezone_known
  check (public.is_known_time_zone(timezone));
