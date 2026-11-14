-- A platform admin is not a student (#364).
--
-- Luiz's request of 14/11: the account he runs the platform with stops
-- being a student of Chelsea St, and the lessons it had with itself go. It
-- was a student since the tests of September; 0029 (24/10) gave it both roles
-- in Chelsea St, admin and student. So it showed as a student on
-- /teacher/students and on the repair of /teacher/founders, and the teacher's
-- menu offered "Ver como aluna".
--
-- The rule is written as "a platform admin", never by address or id: the
-- repository is public. Measured in production on 14/11 (MCP, read only):
-- 2 platform admins, one of them a student: 1 student membership, 1 row of
-- students, 10 lessons as the student (3 scheduled in the past, 7 cancelled),
-- 24 rows of calendar_invites of those lessons; 0 lesson proposals, 0 paid
-- lessons, 0 lessons with a stop marked, 0 credit entries, 0 attempts,
-- 0 assignments, 0 review rows.
--
-- No new rule: only the cleaning asked for. The teacher profile of the same
-- account, its admin membership and everything it teaches stay.

-- What the measurement said was not there stops the migration whole, named:
-- a proposal (whose foreign key restricts), a lesson paid in credits or with
-- a stop marked, a credit entry. None is deleted by guess.
do $$
begin
  if exists (select 1 from public.lesson_proposals p
               join public.platform_admins a on a.user_id = p.student_id) then
    raise exception '0062: a platform admin has a lesson proposal as a student; decide it before this migration';
  end if;
  if exists (select 1 from public.lessons l
               join public.platform_admins a on a.user_id = l.student_id
              where l.credits_debited > 0 or l.stopped_at_point_id is not null) then
    raise exception '0062: a platform admin has a paid or marked lesson as a student; decide it before this migration';
  end if;
  if exists (select 1 from public.credit_entries e
               join public.platform_admins a on a.user_id = e.person_id) then
    raise exception '0062: a platform admin has credit entries; decide it before this migration';
  end if;
end;
$$;

-- The lessons first (their calendar_invites go by cascade), then the rows of
-- students, then the student memberships those rows point at. Run as the
-- owner of lessons, so lessons_booked_through_functions lets the delete of a
-- lesson with a teacher through, as it does for every owner's write.
delete from public.lessons l
 using public.platform_admins a
 where a.user_id = l.student_id;

delete from public.students s
 using public.platform_admins a
 where a.user_id = s.id;

delete from public.organization_members m
 using public.platform_admins a
 where a.user_id = m.user_id
   and m.role = 'student';
