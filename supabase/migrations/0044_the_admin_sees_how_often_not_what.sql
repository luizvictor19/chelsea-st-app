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
  -- The people: whoever has her row in students in the organization. That
  -- row cannot outlive her membership as a student there
  -- (students_membership_fkey, 0029), so someone who left is not among them.
  -- A zone Postgres does not know falls back to the column's default:
  -- profiles_update_self lets her write any text there, and one bad zone must
  -- not refuse the whole team.
  with person as (
    select s.id, coalesce(z.name, 'America/Sao_Paulo') as zone
      from students s
      join profiles p on p.id = s.id
      left join pg_timezone_names z on z.name = p.timezone
     where s.organization_id = p_organization
  ),
  week as (
    select person.id, person.zone,
           date_trunc('week', now() at time zone person.zone)::date as this_week
      from person
  ),
  -- The days she practised inside the weeks asked, in her zone. The lower
  -- bound only spares reading older attempts; no result depends on it.
  -- An attempt belongs to its student's organization (attempts_organization,
  -- 0029), so the people above already keep out every other organization's.
  practised as (
    select distinct a.student_id, (a.created_at at time zone week.zone)::date as day
      from week
      join attempts a on a.student_id = week.id
     where a.created_at >= ((week.this_week - 7 * (p_weeks - 1))::timestamp at time zone week.zone)
  ),
  -- How many weeks back each day is: 0 this week.
  weekly as (
    select d.student_id,
           (week.this_week - date_trunc('week', d.day::timestamp)::date) / 7 as back,
           count(*)::integer as days
      from practised d
      join week on week.id = d.student_id
     group by 1, 2
  )
  select week.id,
         -- Any attempt, however old: the last instant, as her day.
         (select (max(a.created_at) at time zone week.zone)::date
            from attempts a where a.student_id = week.id),
         -- Oldest week first; the last element is this week.
         array(
           select coalesce((select w.days from weekly w
                             where w.student_id = week.id and w.back = g), 0)
             from generate_series(p_weeks - 1, 0, -1) as g),
         -- Until #71 records sessions with a start and an end.
         0
    from week;
end;
$$;

revoke execute on function team_practice(uuid, integer) from public, anon;
grant execute on function team_practice(uuid, integer) to authenticated;
