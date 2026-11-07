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
-- The list is read by a function, stable and not immutable: it is the
-- server's tzdata, and it changes when Supabase updates it.
--
-- A trigger on each table, `before insert or update of timezone`, and not a
-- check, by Luiz's decision after the code review (#219). A check runs on
-- every write of the row: once the tzdata drops a name, editing anything
-- else on that row (a profile's name), or a later migration that updates
-- every schedule, would be refused. And a check runs in a restore, where the
-- local Postgres lists fewer zones (487 against 597); the restore in
-- docs/commands.md runs with session_replication_role = replica, which skips
-- triggers. The trigger refuses as a check would, check_violation (23514),
-- under the name the rule had: profiles_timezone_known and
-- lesson_schedules_timezone_known. A row whose name left the list stays as it
-- is until its zone is written again. Every row passes today, so no data
-- changes.
--
-- Since 0047 a function is born executable by its owner alone. The trigger
-- function runs with the privileges of whoever writes the row, so
-- authenticated, which writes both tables (profiles_update_self,
-- lesson_schedules_write), executes is_known_time_zone. Nobody executes the
-- trigger function itself: execute is checked when a trigger is created, not
-- when it fires. The two triggers that make a profile on signup are security
-- definer, owned by postgres, so a signup needs no grant. anon writes
-- neither table.

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

-- Refused under <table>_timezone_known, the name verify-rls.sql and the
-- screen (scheduleWriteError) read.
create function public.a_time_zone_is_known()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_known_time_zone(new.timezone) then
    raise exception 'time zone not known: %', new.timezone
      using errcode = 'check_violation',
            constraint = tg_table_name || '_timezone_known',
            schema = tg_table_schema,
            table = tg_table_name,
            column = 'timezone';
  end if;
  return new;
end;
$$;

create trigger profiles_timezone_known
  before insert or update of timezone on public.profiles
  for each row execute function public.a_time_zone_is_known();

create trigger lesson_schedules_timezone_known
  before insert or update of timezone on public.lesson_schedules
  for each row execute function public.a_time_zone_is_known();
