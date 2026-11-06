-- The admin sees how often, not what (issue #198, ADR 0005).
--
-- The admin of an organization without a teacher follows her team's
-- practice. attempts holds what a person said (audio, transcript, verdict,
-- the teacher's note), and since 0042 that admin reads no row of it. This
-- function is her only view of practice: for each person of her
-- organization, the day of the last practice, how many days she practised in
-- each of the last weeks, and how many minutes she practised this month.
-- How often and how long, never what. A day is the person's own
-- (profiles.timezone); a week starts on Monday; the month is the calendar
-- month where she lives.
--
-- Robin v1 (#71) records the practice. Until it does, the days come from
-- attempts, the table 0001 made for one spoken answer, and the minutes are 0:
-- nothing records how long a session lasted yet. #71 rewrites this body
-- (create or replace) to read its sessions, with their start and end, and
-- keeps the signature, which is what the screen reads. The daily cap that
-- bounds the minutes lives in the app (src/lib/tutor/daily-cap.ts).
--
-- Measured on 2026-11-06 through the MCP, after 0042: attempts 0 rows,
-- review_schedule 0, students 2, every profile in America/Sao_Paulo; no
-- function named team_practice; no table of sessions. Nothing in src writes
-- attempts yet.
--
-- Security definer, so it reads attempts past their policies: the check of
-- the caller at the top is the only guard, and a caller who is not an admin
-- of the organization is refused with an error, not given an empty list.

create function team_practice(p_organization uuid, p_weeks integer)
returns table (
  person_id uuid,
  last_practised_on date,
  days_by_week integer[],
  minutes_this_month integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not ((select is_platform_admin())
          or is_organization_member(p_organization, '{admin}'::organization_role[])) then
    raise exception 'only an admin of organization % sees its practice', p_organization
      using errcode = 'insufficient_privilege';
  end if;
  if p_weeks is null or p_weeks not between 1 and 12 then
    raise exception 'weeks must be between 1 and 12, got %', p_weeks
      using errcode = 'invalid_parameter_value';
  end if;

  return query
  with person as (
    select s.id, p.timezone,
           date_trunc('week', now() at time zone p.timezone)::date as this_week
      from students s
      join profiles p on p.id = s.id
     where s.organization_id = p_organization
  ),
  -- An attempt belongs to its student's organization (attempts_organization,
  -- 0029), so the people above already keep out every other organization's.
  practised as (
    select distinct a.student_id, (a.created_at at time zone person.timezone)::date as day
      from attempts a
      join person on person.id = a.student_id
  )
  select person.id,
         (select max(d.day) from practised d where d.student_id = person.id),
         -- Oldest week first; the last element is this week.
         array(
           select (select count(*) from practised d
                    where d.student_id = person.id
                      and d.day >= person.this_week - 7 * w
                      and d.day <  person.this_week - 7 * w + 7)::integer
             from generate_series(p_weeks - 1, 0, -1) as w),
         -- Until #71 records sessions with a start and an end.
         0
    from person;
end;
$$;

revoke execute on function team_practice(uuid, integer) from public, anon;
grant execute on function team_practice(uuid, integer) to authenticated;
