-- A booked lesson reaches the calendar (issue #294, on the booking of #276).
--
-- Every booking e-mails a calendar invite (.ics, METHOD:REQUEST) to the
-- student and to the teacher's calendar e-mail, and every cancel the cancel
-- of the same event (METHOD:CANCEL, same UID). The e-mail goes after the
-- commit, outside the transaction that books: a send that fails never undoes
-- the lesson. What must still go out is kept here, in a queue, so a failed
-- send is tried again (Q1 of the #294 plan, Luiz 12/11).
--
-- Measured through the MCP on 2026-11-13 before writing: migrations up to
-- 0052 applied, 0056 reserved for #294 (0053 #292, 0054 #295, 0055 #296);
-- no table calendar_invites and no function calendar_*; lessons has 11 rows
-- (10 scheduled, 6 of them ahead of now, 1 cancelled), none with a teacher;
-- teachers has 0 rows; lessons has the triggers lessons_booked_through_functions,
-- lessons_organization and lessons_stop_in_organization. The backfill below
-- finds no lesson today: it finds the lessons #295 (0054) gives a teacher,
-- which is why 0054 is applied before this one.
--
-- How it works:
--   1. The trigger lessons_invite_calendar, after a lesson is inserted or its
--      status changes, in the same transaction as book_lesson or
--      cancel_lesson, writes one row per person: two requests for a lesson
--      born scheduled with a teacher, two cancels for one that turns
--      cancelled. A booking that rolls back leaves no row.
--   2. The app sends them right after its answer (after() in the action) and
--      once a day (Vercel Cron), reading them through calendar_invites_due
--      and marking each through calendar_invite_sent or calendar_invite_failed.
--      How many attempts before giving up is the app's (outbox.ts).
--   3. A cancel goes only where the request went: a request not sent yet is
--      skipped, and so is the cancel, since there is no event to take out.
--
-- Who reads and writes (Q1, as 0049): nobody writes the queue through the
-- API. The three functions are executed by service_role alone, the trigger
-- function by nobody. Whoever teaches in the organization reads its rows
-- (the state, never an address: the queue holds none) to see on her agenda
-- an invite that did not go; the student reads none.


-- The queue -------------------------------------------------------------------------

create table public.calendar_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete restrict,
  -- A lesson removed (only postgres removes a booked one) takes its rows.
  lesson_id uuid not null references public.lessons on delete cascade,
  method text not null
    constraint calendar_invites_method_known check (method in ('request', 'cancel')),
  recipient text not null
    constraint calendar_invites_recipient_known check (recipient in ('student', 'teacher')),
  status text not null default 'pending'
    constraint calendar_invites_status_known
      check (status in ('pending', 'sent', 'skipped', 'abandoned')),
  attempts integer not null default 0
    constraint calendar_invites_attempts_not_negative check (attempts >= 0),
  -- A code (resend_422_validation_error, no_address, lesson_started), never
  -- an address or a name.
  last_error text
    constraint calendar_invites_last_error_short check (char_length(last_error) <= 200),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint calendar_invites_one_per_person unique (lesson_id, method, recipient),
  constraint calendar_invites_sent_has_time check ((status = 'sent') = (sent_at is not null))
);

comment on table public.calendar_invites is
  'The calendar e-mails of a booked lesson (#294): one row per lesson, kind (request or cancel) and person (student or teacher), written by the trigger lessons_invite_calendar and sent by the app after the commit. Written only by calendar_invite_sent and calendar_invite_failed, executed by service_role; read by whoever teaches in the organization, never by the student. Holds no address.';

create index calendar_invites_pending on public.calendar_invites (created_at) where status = 'pending';

-- The organization of the lesson, filled on insert and refused if another
-- (organization_follows_parents, 0029).
create trigger calendar_invites_organization
  before insert or update on public.calendar_invites
  for each row execute function public.organization_follows_parents('lesson_id', 'lessons');

alter table public.calendar_invites enable row level security;

create policy calendar_invites_read on public.calendar_invites
  for select to authenticated
  using ((select public.is_platform_admin()) or public.teaches_in(organization_id));

-- Select only, for the policy above. No role writes it through the API.
grant select on public.calendar_invites to authenticated;


-- The trigger on lessons ---------------------------------------------------------------
--
-- security definer, owned by postgres: it writes the queue whoever changed
-- the lesson (book_lesson and cancel_lesson are postgres's already; a cancel
-- written another way reaches the queue all the same).
create function public.lessons_invite_calendar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.teacher_id is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'scheduled' and new.scheduled_at > now() then
      insert into public.calendar_invites (lesson_id, method, recipient)
        values (new.id, 'request', 'student'), (new.id, 'request', 'teacher')
        on conflict (lesson_id, method, recipient) do nothing;
    end if;
    return null;
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    -- A cancel goes where the request went. A request still waiting is not
    -- sent any more, and its cancel is skipped with it.
    insert into public.calendar_invites (lesson_id, method, recipient, status)
      select new.id, 'cancel', r.recipient,
             case when exists (select 1 from public.calendar_invites i
                                where i.lesson_id = new.id and i.method = 'request'
                                  and i.recipient = r.recipient and i.status = 'sent')
                  then 'pending' else 'skipped' end
        from (values ('student'), ('teacher')) r (recipient)
        on conflict (lesson_id, method, recipient) do nothing;
    update public.calendar_invites i
       set status = 'skipped'
     where i.lesson_id = new.id and i.method = 'request' and i.status = 'pending';
  end if;
  return null;
end;
$$;

comment on function public.lessons_invite_calendar() is
  'After a lesson with a teacher is inserted scheduled and ahead, queues two calendar requests (student, teacher); after it turns cancelled, two cancels, pending where the request was sent and skipped otherwise, and skips the requests not sent yet (#294). Executed by nobody: a trigger.';

create trigger lessons_invite_calendar
  after insert or update of status on public.lessons
  for each row execute function public.lessons_invite_calendar();


-- What the app calls, as service_role ---------------------------------------------------
--
-- Each one security definer, owned by postgres, search_path empty, and
-- executable by service_role alone (0047: a function is born closed).

-- The rows to send, oldest first, of one lesson (right after the action) or
-- of any (p_lesson null: the daily routine), with everything the e-mail
-- needs: the student's account e-mail (auth.users), the teacher's calendar
-- e-mail (teachers), both names, the zone of the person the row goes to
-- (profiles), the Meet and the time. An address that is null is the app's to
-- give up on.
create function public.calendar_invites_due(p_lesson uuid, p_limit integer)
returns table (
  id uuid,
  lesson_id uuid,
  method text,
  recipient text,
  attempts integer,
  scheduled_at timestamptz,
  duration_minutes integer,
  student_name text,
  student_email text,
  teacher_name text,
  teacher_email text,
  meet_url text,
  recipient_timezone text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.lesson_id, i.method, i.recipient, i.attempts,
         l.scheduled_at, l.duration_minutes,
         sp.full_name, u.email,
         tp.full_name, t.calendar_email,
         t.meet_url,
         case i.recipient when 'student' then sp.timezone else tp.timezone end
    from public.calendar_invites i
    join public.lessons l on l.id = i.lesson_id
    join public.teachers t on t.id = l.teacher_id
    join public.profiles sp on sp.id = l.student_id
    join public.profiles tp on tp.id = t.user_id
    left join auth.users u on u.id = l.student_id
   where i.status = 'pending'
     and (p_lesson is null or i.lesson_id = p_lesson)
   order by i.created_at, i.lesson_id, i.method desc, i.recipient
   limit greatest(coalesce(p_limit, 0), 0);
$$;

comment on function public.calendar_invites_due(uuid, integer) is
  'The pending calendar e-mails, oldest first, of one lesson or (null) of any, at most p_limit, with the addresses, names, zone of the recipient, Meet and time the e-mail needs (#294). Executed by service_role alone.';

-- The e-mail went. Marks the row sent once (the first sender to finish
-- wins); a request that a cancel skipped meanwhile had in fact gone, so its
-- skipped cancel waits to go too.
create function public.calendar_invite_sent(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.calendar_invites;
begin
  update public.calendar_invites i
     set status = 'sent', sent_at = now(), last_attempt_at = now(),
         attempts = i.attempts + 1, last_error = null
   where i.id = p_id and i.status <> 'sent'
  returning * into v_row;
  if v_row.method = 'request' then
    update public.calendar_invites i
       set status = 'pending'
     where i.lesson_id = v_row.lesson_id and i.method = 'cancel'
       and i.recipient = v_row.recipient and i.status = 'skipped';
  end if;
end;
$$;

comment on function public.calendar_invite_sent(uuid) is
  'Marks a calendar e-mail sent, once; when a request goes after its lesson was cancelled, its skipped cancel turns pending (#294). Executed by service_role alone.';

-- The e-mail did not go: one attempt more and its code; abandoned when the
-- app gives up (attempts spent, no address, the lesson started). Only a
-- pending row changes: one another sender marked sent stays sent.
create function public.calendar_invite_failed(p_id uuid, p_error text, p_give_up boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.calendar_invites i
     set attempts = i.attempts + 1,
         last_error = left(p_error, 200),
         last_attempt_at = now(),
         status = case when p_give_up then 'abandoned' else i.status end
   where i.id = p_id and i.status = 'pending';
$$;

comment on function public.calendar_invite_failed(uuid, text, boolean) is
  'Records a failed calendar e-mail: one attempt more, its code (never an address), and abandoned when the app gives up (#294). Executed by service_role alone.';


-- Who executes what (0047) --------------------------------------------------------------

revoke all on function public.lessons_invite_calendar() from public, anon, authenticated, service_role;
revoke all on function public.calendar_invites_due(uuid, integer) from public, anon, authenticated;
revoke all on function public.calendar_invite_sent(uuid) from public, anon, authenticated;
revoke all on function public.calendar_invite_failed(uuid, text, boolean) from public, anon, authenticated;

grant execute on function public.calendar_invites_due(uuid, integer) to service_role;
grant execute on function public.calendar_invite_sent(uuid) to service_role;
grant execute on function public.calendar_invite_failed(uuid, text, boolean) to service_role;


-- The lessons already booked (Q2) --------------------------------------------------------
--
-- Every lesson ahead, scheduled, with a teacher when this is applied gets
-- its two requests: those #295 moved to the new agenda reach the student and
-- the teacher on the first send after the deploy. 0 rows on 2026-11-13
-- before 0054.
insert into public.calendar_invites (lesson_id, method, recipient)
  select l.id, 'request', r.recipient
    from public.lessons l
    cross join (values ('student'), ('teacher')) r (recipient)
   where l.teacher_id is not null
     and l.status = 'scheduled'
     and l.scheduled_at > now()
  on conflict (lesson_id, method, recipient) do nothing;
