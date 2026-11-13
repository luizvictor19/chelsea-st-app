-- A proposed lesson waits for a yes (issue #319, on the booking of #276).
--
-- A teacher proposes a lesson, or a series of lessons, to a student of hers;
-- a student proposes a time outside her teacher's free hours. Nothing is
-- debited and no slot is held while the other side has not answered. On the
-- yes, each lesson is born as a booked lesson is, through the same piece as
-- book_lesson (lesson_write_paid): one debit per lesson, under lesson:<id>,
-- the calendar invites of 0056, "Parei aqui", and cancel_lesson with its
-- refund up to 1 hour before, unchanged. Spec: docs/spec-f1.md, "Proposta de
-- aula (#319)". Plan approved by Luiz on 13/11 with option A for Q1 to Q9
-- and a validity of 3 days.
--
-- Measured through the MCP on 2026-11-13 before writing: migrations up to
-- 0056 applied (0053 and 0055 unused), no branch holds a 0053, 0055 or 0057
-- or above; no relation and no function of public has "propos" in its name,
-- and no lesson_write_paid; book_lesson in production is the body of 0052
-- (md5 of its source equal to the file's); lessons has 11 rows, none
-- scheduled ahead of now; credit_entries 0 rows; credit_costs 1 row; teachers
-- 1 row; calendar_invites 24 rows; students has students_organization_id_id_key.
-- The rows touched are none: this creates tables and functions, and recreates
-- book_lesson with the same signature and the same effect.
--
-- Who does what (Q7): nobody writes the three new tables through the API.
-- Six security definer functions of postgres, executed by authenticated and
-- always for auth.uid(), propose, answer, withdraw and read; three executed by
-- service_role alone send the e-mail (as 0056); the pieces they share and the
-- trigger function by nobody. Every refusal names its rule at the start of its
-- message, for src/lib/lessons/refusals.ts, and in the error, for
-- scripts/verify-rls.sql (the convention of 0050 and 0052).


-- The rules of a proposal ---------------------------------------------------------------
--
-- Q4: a proposal is open for 3 days, and closes earlier, 1 hour before its
-- first lesson (lesson_rules().refund_until_before): every lesson accepted can
-- still be cancelled with its credits back at the moment of the yes. Each
-- lesson starts more than that hour from now and at most book_opens_ahead
-- (8 weeks) ahead when proposed. Changed by a migration.
create function public.lesson_proposal_rules(out valid_for interval)
language sql
immutable
set search_path = ''
as $$
  select interval '3 days';
$$;

comment on function public.lesson_proposal_rules() is
  'How long a lesson proposal stays open (#319). It closes earlier, refund_until_before of lesson_rules() before its first lesson. One place; changed by a migration.';


-- The proposal and its lessons (Q6) ------------------------------------------------------
--
-- The rule of a series is not stored: the server expands it into instants in
-- the proposer's zone, and the database keeps instants, as lessons does. An
-- open proposal never changes: editing one is withdrawing it and proposing
-- again. expires_at is when it stops being open, written once: the validity
-- or 1 hour before its first lesson, the sooner. Its state is read against
-- the clock (open and expires_at ahead); the function that meets one past
-- that time writes expired, and no routine is needed.
create table public.lesson_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete restrict,
  teacher_id uuid not null,
  student_id uuid not null,
  proposed_by text not null
    constraint lesson_proposals_proposed_by_known check (proposed_by in ('teacher', 'student')),
  status text not null default 'open'
    constraint lesson_proposals_status_known
      check (status in ('open', 'accepted', 'declined', 'withdrawn', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- When it stopped being open, and who closed it: the other side's yes or
  -- no, the proposer's withdrawal; nobody for an expired one.
  answered_at timestamptz,
  answered_by uuid references public.profiles on delete set null,
  -- The teacher and the student are of the proposal's organization, never of
  -- another (as lessons_teacher_fkey).
  constraint lesson_proposals_teacher_fkey foreign key (organization_id, teacher_id)
    references public.teachers (organization_id, id) on delete restrict,
  constraint lesson_proposals_student_fkey foreign key (organization_id, student_id)
    references public.students (organization_id, id) on delete restrict,
  constraint lesson_proposals_expires_after_creation check (expires_at > created_at),
  constraint lesson_proposals_answered_when_closed check ((status = 'open') = (answered_at is null)),
  constraint lesson_proposals_answered_by_a_side
    check (status in ('accepted', 'declined', 'withdrawn') or answered_by is null)
);

comment on table public.lesson_proposals is
  'A lesson or a series proposed by a teacher to her student, or by a student to her teacher, waiting for the other side''s yes (#319). Nothing is debited and no slot is held until the yes. Written only through the proposal functions; read by its student, its teacher, the organization''s admin and the platform admin.';

create index lesson_proposals_by_student on public.lesson_proposals (student_id, created_at);
create index lesson_proposals_by_teacher on public.lesson_proposals (teacher_id, created_at);

-- A student has at most one open proposal per teacher, so she does not flood
-- the teacher's agenda; a teacher has no limit. An expired one still open in
-- the table is closed by propose_lessons_to_teacher before it writes.
create unique index lesson_proposal_one_open on public.lesson_proposals (teacher_id, student_id)
  where status = 'open' and proposed_by = 'student';

create table public.lesson_proposal_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete restrict,
  proposal_id uuid not null references public.lesson_proposals on delete cascade,
  starts_at timestamptz not null,
  duration_minutes integer not null
    constraint lesson_proposal_items_duration_positive check (duration_minutes > 0),
  -- The lesson it became, on the yes; null until then.
  lesson_id uuid references public.lessons on delete set null
    constraint lesson_proposal_items_lesson_once unique,
  -- A whole minute: extract(epoch) is immutable, a date_trunc on timestamptz
  -- is not.
  constraint lesson_proposal_items_whole_minute check (mod(extract(epoch from starts_at), 60) = 0),
  -- Two lessons of one proposal never cross. A range of timestamp read in
  -- UTC, as the exclusions of lessons (0052).
  constraint lesson_proposal_items_no_overlap exclude using gist (
    proposal_id with =,
    tsrange(starts_at at time zone 'UTC',
            (starts_at at time zone 'UTC') + make_interval(mins => duration_minutes)) with &&)
);

comment on table public.lesson_proposal_items is
  'One lesson of a proposal: its start, its length and, after the yes, the lesson it became (#319). Read as its proposal is.';

create index lesson_proposal_items_by_proposal on public.lesson_proposal_items (proposal_id, starts_at);

-- The organization of the proposal, filled on insert and refused if another
-- (organization_follows_parents, 0029).
create trigger lesson_proposal_items_organization
  before insert or update on public.lesson_proposal_items
  for each row execute function public.organization_follows_parents('proposal_id', 'lesson_proposals');

alter table public.lesson_proposals enable row level security;
alter table public.lesson_proposal_items enable row level security;

-- Its student, its teacher (her row of teachers), the organization's admin
-- and the platform admin read it. The admin reads and does not answer.
create policy lesson_proposals_read on public.lesson_proposals
  for select to authenticated
  using (student_id = (select auth.uid())
         or exists (select 1 from public.teachers t
                     where t.id = teacher_id and t.user_id = (select auth.uid()))
         or public.is_organization_member(organization_id, '{admin}')
         or (select public.is_platform_admin()));

-- An item is read as its proposal is: the subquery runs under the policy
-- above.
create policy lesson_proposal_items_read on public.lesson_proposal_items
  for select to authenticated
  using (exists (select 1 from public.lesson_proposals p where p.id = proposal_id));

-- Select only, for the policies above. No role writes them through the API.
grant select on public.lesson_proposals to authenticated;
grant select on public.lesson_proposal_items to authenticated;


-- The e-mail of a proposal (Q9) ----------------------------------------------------------
--
-- One row per proposal, for the other side, written by a trigger in the
-- transaction that proposes and sent by the app after the commit (after()
-- and the daily routine), in the mould of calendar_invites (0056). A row
-- whose proposal is no longer open is skipped: by the trigger when the
-- proposal closes, by lesson_proposal_mails_due when it expired by the clock.
create table public.lesson_proposal_mails (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete restrict,
  proposal_id uuid not null references public.lesson_proposals on delete cascade
    constraint lesson_proposal_mails_one_per_proposal unique,
  recipient text not null
    constraint lesson_proposal_mails_recipient_known check (recipient in ('student', 'teacher')),
  status text not null default 'pending'
    constraint lesson_proposal_mails_status_known
      check (status in ('pending', 'sent', 'skipped', 'abandoned')),
  attempts integer not null default 0
    constraint lesson_proposal_mails_attempts_not_negative check (attempts >= 0),
  -- A code, never an address or a name.
  last_error text
    constraint lesson_proposal_mails_last_error_short check (char_length(last_error) <= 200),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint lesson_proposal_mails_sent_has_time check ((status = 'sent') = (sent_at is not null))
);

comment on table public.lesson_proposal_mails is
  'The e-mail that tells the other side of a proposal (#319): one row per proposal, written by the trigger lesson_proposals_queue_mail and sent by the app after the commit. Written only by lesson_proposal_mail_sent, lesson_proposal_mail_failed and lesson_proposal_mails_due, executed by service_role; read by whoever teaches in the organization. Holds no address.';

create index lesson_proposal_mails_pending on public.lesson_proposal_mails (created_at) where status = 'pending';

alter table public.lesson_proposal_mails enable row level security;

create policy lesson_proposal_mails_read on public.lesson_proposal_mails
  for select to authenticated
  using ((select public.is_platform_admin()) or public.teaches_in(organization_id));

grant select on public.lesson_proposal_mails to authenticated;

-- security definer, owned by postgres, as lessons_invite_calendar: it writes
-- the queue whoever wrote the proposal.
create function public.lesson_proposals_queue_mail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lesson_proposal_mails (organization_id, proposal_id, recipient)
      values (new.organization_id, new.id,
              case new.proposed_by when 'teacher' then 'student' else 'teacher' end)
      on conflict (proposal_id) do nothing;
    return null;
  end if;

  if new.status <> 'open' and old.status = 'open' then
    update public.lesson_proposal_mails m
       set status = 'skipped'
     where m.proposal_id = new.id and m.status = 'pending';
  end if;
  return null;
end;
$$;

comment on function public.lesson_proposals_queue_mail() is
  'After a proposal is written, queues the e-mail to the other side; after it stops being open, skips that e-mail if it has not gone (#319). Executed by nobody: a trigger.';

create trigger lesson_proposals_queue_mail
  after insert or update of status on public.lesson_proposals
  for each row execute function public.lesson_proposals_queue_mail();


-- One way for a lesson to be written and paid (Q8) ---------------------------------------
--
-- What book_lesson did after its checks, taken out so the yes to a proposal
-- writes and pays a lesson the same way: the lesson first, so the debit names
-- it; credit_debit(student, 'teacher_lesson', 1, 'lesson:<id>'), at what
-- credit_price says at that moment; credits_debited read back from the
-- ledger. A balance that does not cover it refuses the debit
-- (credits_not_negative) and the lesson goes back with it. Executed by
-- nobody: its callers are security definer functions of postgres, so the
-- insert passes lessons_booked_through_functions as the owner.
create function public.lesson_write_paid(
  p_organization uuid, p_student uuid, p_teacher uuid, p_starts_at timestamptz)
returns table (lesson_id uuid, credits_debited integer, balance integer)
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_reference text := 'lesson:' || v_id::text;
  v_balance integer;
  v_debited integer;
begin
  insert into public.lessons
    (id, organization_id, student_id, teacher_id, scheduled_at, duration_minutes)
    values (v_id, p_organization, p_student, p_teacher, p_starts_at,
            (select r.lesson_minutes from public.lesson_rules() r));

  v_balance := public.credit_debit(p_student, 'teacher_lesson', 1, v_reference);

  select coalesce(-sum(e.amount), 0)::integer into v_debited
    from public.credit_entries e
   where e.person_id = p_student and e.kind = 'debit' and e.reference = v_reference;
  update public.lessons l set credits_debited = v_debited where l.id = v_id;

  return query select v_id, v_debited, v_balance;
end;
$$;

comment on function public.lesson_write_paid(uuid, uuid, uuid, timestamptz) is
  'Writes a scheduled lesson and debits what a lesson costs the student (credit_debit, reference lesson:<id>), reading the debit back onto the lesson (#319). The one way a lesson is born, for book_lesson and accept_lesson_proposal. Executed by nobody.';

-- book_lesson, the same signature and the same effect: its checks, then the
-- piece above. The body of 0052 up to the insert is kept line for line.
create or replace function public.book_lesson(p_teacher uuid, p_starts_at timestamptz)
returns table (lesson_id uuid, credits_debited integer, balance integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_org uuid;
begin
  v_org := public.lesson_booker_organization(p_teacher);
  -- Every row of the person who teaches, in any organization: a lesson with
  -- her in one takes the slot in the others (lesson_open_slots), and the
  -- exclusion constraint holds one row of teachers only.
  perform 1 from public.teachers t
   where t.user_id = (select o.user_id from public.teachers o where o.id = p_teacher)
   order by t.id
   for update;

  if p_starts_at is null or not exists (
       select 1 from public.lesson_open_slots(p_teacher, v_me, p_starts_at, p_starts_at) s
        where s.starts_at = p_starts_at) then
    raise exception 'lesson_slot_bookable: % is not a free slot of this teacher', p_starts_at
      using errcode = 'check_violation', constraint = 'lesson_slot_bookable';
  end if;

  return query
    select w.lesson_id, w.credits_debited, w.balance
      from public.lesson_write_paid(v_org, v_me, p_teacher, p_starts_at) w;
end;
$$;

comment on function public.book_lesson(uuid, timestamptz) is
  'Books the slot of the teacher for the caller and debits what a lesson costs her (lesson_write_paid: credit_debit, reference lesson:<id>), in one transaction. Refuses by name: not a student or another organization (lesson_booker_organization), a start that is not a free slot (lesson_slot_bookable), a balance that does not cover it (credits_not_negative), a lesson without a cost (credit_cost_known); two lessons that cross are refused by lessons_teacher_no_overlap and lessons_student_no_overlap. Returns the lesson, the credits debited and her balance.';


-- The pieces the proposal functions share --------------------------------------------------
--
-- Executed by nobody: called only by the security definer functions below.

-- Refuses lesson_proposal_slot_taken when one of the starts crosses a
-- scheduled lesson of the teacher, in any of her organizations (every row of
-- teachers of the same person), or of the student. A lesson of the proposal
-- crossing another of it is the items' own exclusion.
create function public.lesson_proposal_check_free(
  p_teacher uuid, p_student uuid, p_starts timestamptz[])
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_minutes integer := (select r.lesson_minutes from public.lesson_rules() r);
  v_taken timestamptz;
begin
  select s.starts_at into v_taken
    from unnest(p_starts) s (starts_at)
   where exists (
           select 1
             from public.lessons l
            where l.status = 'scheduled'
              and (l.student_id = p_student
                   or l.teacher_id in (select o.id from public.teachers o
                                        where o.user_id = (select t.user_id from public.teachers t
                                                            where t.id = p_teacher)))
              and tstzrange(l.scheduled_at, l.scheduled_at + make_interval(mins => l.duration_minutes))
                  && tstzrange(s.starts_at, s.starts_at + make_interval(mins => v_minutes)))
   order by s.starts_at
   limit 1;
  if v_taken is not null then
    raise exception 'lesson_proposal_slot_taken: the lesson at % crosses another lesson of the teacher or of the student', v_taken
      using errcode = 'check_violation', constraint = 'lesson_proposal_slot_taken';
  end if;
end;
$$;

comment on function public.lesson_proposal_check_free(uuid, uuid, timestamptz[]) is
  'Refuses (lesson_proposal_slot_taken) a start that crosses a scheduled lesson of the teacher, in any of her organizations, or of the student (#319). Called by the proposal functions only.';

-- Writes an open proposal and its lessons after checking each start: at least
-- one; each more than refund_until_before from now and at most
-- book_opens_ahead ahead (lesson_proposal_window); none crossing a lesson
-- (lesson_proposal_check_free); none crossing another of the proposal (the
-- items' exclusion). The teacher's windows and time off are not checked: a
-- proposal exists to fall outside them. Returns the proposal.
create function public.lesson_proposal_write(
  p_organization uuid, p_teacher uuid, p_student uuid, p_proposed_by text, p_starts timestamptz[])
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_rules record;
  v_id uuid := gen_random_uuid();
begin
  select * into v_rules from public.lesson_rules();
  if coalesce(cardinality(p_starts), 0) = 0 or array_position(p_starts, null) is not null then
    raise exception 'lesson_proposal_has_lessons: a proposal holds one lesson or more'
      using errcode = 'check_violation', constraint = 'lesson_proposal_has_lessons';
  end if;
  if exists (select 1 from unnest(p_starts) s (starts_at)
              where s.starts_at <= now() + v_rules.refund_until_before
                 or s.starts_at > now() + v_rules.book_opens_ahead) then
    raise exception 'lesson_proposal_window: every lesson starts more than % from now and at most % ahead',
      v_rules.refund_until_before, v_rules.book_opens_ahead
      using errcode = 'check_violation', constraint = 'lesson_proposal_window';
  end if;
  perform public.lesson_proposal_check_free(p_teacher, p_student, p_starts);

  insert into public.lesson_proposals
    (id, organization_id, teacher_id, student_id, proposed_by, expires_at)
    select v_id, p_organization, p_teacher, p_student, p_proposed_by,
           least(now() + (select r.valid_for from public.lesson_proposal_rules() r),
                 min(s.starts_at) - v_rules.refund_until_before)
      from unnest(p_starts) s (starts_at);
  insert into public.lesson_proposal_items (proposal_id, starts_at, duration_minutes)
    select v_id, s.starts_at, v_rules.lesson_minutes
      from unnest(p_starts) s (starts_at)
     order by s.starts_at;
  return v_id;
end;
$$;

comment on function public.lesson_proposal_write(uuid, uuid, uuid, text, timestamptz[]) is
  'Writes an open proposal and its lessons, refusing by name an empty one (lesson_proposal_has_lessons), a start too close or too far (lesson_proposal_window), one crossing a lesson (lesson_proposal_slot_taken) or another of the proposal (lesson_proposal_items_no_overlap) (#319). Called by the two propose functions only.';

-- What a lesson costs the student now, null while it is not on sale: the cost
-- the screens show beside a proposal.
create function public.lesson_proposal_cost(p_student uuid)
returns integer
language plpgsql
stable
set search_path = ''
as $$
begin
  return public.credit_price(p_student, 'teacher_lesson');
exception when check_violation then
  return null;
end;
$$;

comment on function public.lesson_proposal_cost(uuid) is
  'What a lesson costs the student now, through credit_price, or null when it has no cost in her brand (#319). Called by my_lesson_proposals only.';


-- Proposing ---------------------------------------------------------------------------------

-- The teacher proposes to an active student of the organization where she has
-- her row of teachers, active. Only the teacher herself, by her own row: the
-- organization's admin and the platform admin read and do not propose.
create function public.propose_lessons_to_student(p_student uuid, p_starts timestamptz[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_teacher public.teachers;
  v_student_active boolean;
begin
  select t.* into v_teacher
    from public.teachers t
    join public.students s on s.organization_id = t.organization_id
   where t.user_id = v_me and s.id = p_student;
  if v_teacher.id is null then
    raise exception 'lesson_proposal_same_organization: the student is not of an organization you teach in'
      using errcode = 'insufficient_privilege', constraint = 'lesson_proposal_same_organization';
  end if;
  if not v_teacher.is_active then
    raise exception 'lesson_proposal_teacher_active: the teacher takes no lesson now'
      using errcode = 'check_violation', constraint = 'lesson_proposal_teacher_active';
  end if;
  select s.is_active into v_student_active from public.students s where s.id = p_student;
  if not v_student_active then
    raise exception 'lesson_proposal_student_active: the student is not active'
      using errcode = 'check_violation', constraint = 'lesson_proposal_student_active';
  end if;

  return public.lesson_proposal_write(v_teacher.organization_id, v_teacher.id, p_student, 'teacher', p_starts);
end;
$$;

comment on function public.propose_lessons_to_student(uuid, timestamptz[]) is
  'The caller, as the teacher of the student''s organization, proposes the lessons at these starts (#319). Nothing is debited. Refuses by name: a student of no organization she teaches in (lesson_proposal_same_organization), her row not active (lesson_proposal_teacher_active), the student not active (lesson_proposal_student_active), and the refusals of lesson_proposal_write. Returns the proposal.';

-- The student proposes to a teacher she could book (lesson_booker_organization:
-- an active student, a teacher of her organization who takes bookings). Q3:
-- nothing is held, but a balance that does not cover the proposal now is
-- refused early (credits_not_negative), and an action without a cost too
-- (credit_cost_known). One open proposal per teacher (lesson_proposal_one_open):
-- one past its time is closed as expired first.
create function public.propose_lessons_to_teacher(p_teacher uuid, p_starts timestamptz[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_org uuid;
  v_total bigint;
  v_balance integer;
begin
  -- lesson_booker_organization checks a teacher only when one is named.
  if p_teacher is null then
    raise exception 'lesson_booking_same_organization: the teacher is not of your organization'
      using errcode = 'insufficient_privilege', constraint = 'lesson_booking_same_organization';
  end if;
  v_org := public.lesson_booker_organization(p_teacher);

  update public.lesson_proposals p
     set status = 'expired', answered_at = p.expires_at
   where p.teacher_id = p_teacher and p.student_id = v_me
     and p.status = 'open' and p.expires_at <= now();

  v_total := public.credit_price(v_me, 'teacher_lesson')::bigint * coalesce(cardinality(p_starts), 0);
  v_balance := public.credit_balance_of(v_me);
  if v_balance < v_total then
    raise exception 'credits_not_negative: the proposal costs %, and person % has %', v_total, v_me, v_balance
      using errcode = 'check_violation', constraint = 'credits_not_negative';
  end if;

  return public.lesson_proposal_write(v_org, p_teacher, v_me, 'student', p_starts);
end;
$$;

comment on function public.propose_lessons_to_teacher(uuid, timestamptz[]) is
  'The caller, an active student, proposes the lessons at these starts to a teacher of her organization who takes bookings (#319). Nothing is debited or held. Refuses by name: as lesson_booker_organization does, a balance that does not cover the proposal now (credits_not_negative), a lesson without a cost (credit_cost_known), a second open proposal to the same teacher (lesson_proposal_one_open), and the refusals of lesson_proposal_write. Returns the proposal.';


-- Answering ---------------------------------------------------------------------------------
--
-- Only the other side answers: the student, a proposal of her teacher; the
-- teacher of that row, a proposal of her student. Anyone else, the proposer
-- included, reads as someone the proposal is not for
-- (lesson_proposal_answer_allowed). An answer needs the proposal open and
-- ahead of expires_at (lesson_proposal_open).

-- The proposal, locked, for its other side; refuses otherwise.
create function public.lesson_proposal_for_answer(p_proposal uuid)
returns public.lesson_proposals
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_proposal public.lesson_proposals;
begin
  select * into v_proposal from public.lesson_proposals p where p.id = p_proposal for update;
  if v_me is null or v_proposal.id is null
     or not ((v_proposal.proposed_by = 'teacher' and v_proposal.student_id = v_me)
             or (v_proposal.proposed_by = 'student'
                 and exists (select 1 from public.teachers t
                              where t.id = v_proposal.teacher_id and t.user_id = v_me))) then
    raise exception 'lesson_proposal_answer_allowed: no such proposal for you to answer'
      using errcode = 'insufficient_privilege', constraint = 'lesson_proposal_answer_allowed';
  end if;
  if v_proposal.status <> 'open' or v_proposal.expires_at <= now() then
    raise exception 'lesson_proposal_open: the proposal is not open any more'
      using errcode = 'check_violation', constraint = 'lesson_proposal_open';
  end if;
  return v_proposal;
end;
$$;

comment on function public.lesson_proposal_for_answer(uuid) is
  'Locks the proposal and returns it when the caller is its other side and it is still open; refuses lesson_proposal_answer_allowed or lesson_proposal_open (#319). Called by accept_lesson_proposal and decline_lesson_proposal only.';

-- The yes, in one transaction (Q1, Q2, Q5): the teacher's rows locked as
-- book_lesson locks them; the teacher and the student still active; each
-- lesson checked again against the lessons booked meanwhile; then each one
-- written and paid by lesson_write_paid, soonest first, and tied to its item.
-- A balance that does not cover the whole series refuses all of it
-- (credits_not_negative) and the proposal stays open. Returns how many
-- lessons were born, what was debited in all and her balance.
create function public.accept_lesson_proposal(p_proposal uuid)
returns table (lesson_count integer, credits_debited integer, balance integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_proposal public.lesson_proposals;
  v_item record;
  v_written record;
  v_count integer := 0;
  v_debited integer := 0;
  v_balance integer;
begin
  v_proposal := public.lesson_proposal_for_answer(p_proposal);

  perform 1 from public.teachers t
   where t.user_id = (select o.user_id from public.teachers o where o.id = v_proposal.teacher_id)
   order by t.id
   for update;
  if not exists (select 1 from public.teachers t where t.id = v_proposal.teacher_id and t.is_active) then
    raise exception 'lesson_proposal_teacher_active: the teacher takes no lesson now'
      using errcode = 'check_violation', constraint = 'lesson_proposal_teacher_active';
  end if;
  if not exists (select 1 from public.students s where s.id = v_proposal.student_id and s.is_active) then
    raise exception 'lesson_proposal_student_active: the student is not active'
      using errcode = 'check_violation', constraint = 'lesson_proposal_student_active';
  end if;

  perform public.lesson_proposal_check_free(
    v_proposal.teacher_id, v_proposal.student_id,
    array(select i.starts_at from public.lesson_proposal_items i where i.proposal_id = v_proposal.id));

  for v_item in
    select i.id, i.starts_at from public.lesson_proposal_items i
     where i.proposal_id = v_proposal.id
     order by i.starts_at
  loop
    select * into v_written
      from public.lesson_write_paid(v_proposal.organization_id, v_proposal.student_id,
                                    v_proposal.teacher_id, v_item.starts_at);
    update public.lesson_proposal_items i set lesson_id = v_written.lesson_id where i.id = v_item.id;
    v_count := v_count + 1;
    v_debited := v_debited + v_written.credits_debited;
    v_balance := v_written.balance;
  end loop;

  update public.lesson_proposals p
     set status = 'accepted', answered_at = now(), answered_by = v_me
   where p.id = v_proposal.id;

  return query select v_count, v_debited, v_balance;
end;
$$;

comment on function public.accept_lesson_proposal(uuid) is
  'The other side''s yes to a proposal (#319): every lesson written and paid as book_lesson does (lesson_write_paid), in one transaction, and the proposal accepted. Refuses by name: lesson_proposal_answer_allowed, lesson_proposal_open, lesson_proposal_teacher_active, lesson_proposal_student_active, lesson_proposal_slot_taken, credits_not_negative (the whole series or nothing). Returns the lessons born, the credits debited and the student''s balance.';

create function public.decline_lesson_proposal(p_proposal uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.lesson_proposals;
begin
  v_proposal := public.lesson_proposal_for_answer(p_proposal);
  update public.lesson_proposals p
     set status = 'declined', answered_at = now(), answered_by = (select auth.uid())
   where p.id = v_proposal.id;
end;
$$;

comment on function public.decline_lesson_proposal(uuid) is
  'The other side''s no to a proposal (#319). Nothing is debited and no lesson is written. Refuses lesson_proposal_answer_allowed and lesson_proposal_open.';

-- Only whoever proposed withdraws it, while it is open; the organization's
-- admin does not (lesson_proposal_withdraw_allowed).
create function public.withdraw_lesson_proposal(p_proposal uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_proposal public.lesson_proposals;
begin
  select * into v_proposal from public.lesson_proposals p where p.id = p_proposal for update;
  if v_me is null or v_proposal.id is null
     or not ((v_proposal.proposed_by = 'student' and v_proposal.student_id = v_me)
             or (v_proposal.proposed_by = 'teacher'
                 and exists (select 1 from public.teachers t
                              where t.id = v_proposal.teacher_id and t.user_id = v_me))) then
    raise exception 'lesson_proposal_withdraw_allowed: no such proposal of yours to withdraw'
      using errcode = 'insufficient_privilege', constraint = 'lesson_proposal_withdraw_allowed';
  end if;
  if v_proposal.status <> 'open' or v_proposal.expires_at <= now() then
    raise exception 'lesson_proposal_open: the proposal is not open any more'
      using errcode = 'check_violation', constraint = 'lesson_proposal_open';
  end if;
  update public.lesson_proposals p
     set status = 'withdrawn', answered_at = now(), answered_by = v_me
   where p.id = v_proposal.id;
end;
$$;

comment on function public.withdraw_lesson_proposal(uuid) is
  'Whoever proposed takes an open proposal back (#319). Refuses lesson_proposal_withdraw_allowed and lesson_proposal_open.';


-- What each side reads ------------------------------------------------------------------------
--
-- The caller's proposals, as the student and as the teacher (any of her rows
-- of teachers): the open ones, and the closed ones for 7 days after they
-- closed. The state is read against the clock: open past expires_at is
-- expired here. Gives the student the teacher's name, which she does not
-- read in profiles, and both sides what a lesson costs the student now.
create function public.my_lesson_proposals()
returns table (
  proposal_id uuid,
  my_side text,
  proposed_by text,
  status text,
  organization_id uuid,
  teacher_id uuid,
  teacher_name text,
  student_id uuid,
  student_name text,
  created_at timestamptz,
  expires_at timestamptz,
  answered_at timestamptz,
  starts_at timestamptz[],
  duration_minutes integer,
  lesson_credits integer)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select p.*, 'student'::text as my_side
      from public.lesson_proposals p
     where p.student_id = (select auth.uid())
    union all
    select p.*, 'teacher'::text
      from public.lesson_proposals p
      join public.teachers t on t.id = p.teacher_id
     where t.user_id = (select auth.uid())
  )
  select m.id, m.my_side, m.proposed_by,
         case when m.status = 'open' and m.expires_at <= now() then 'expired' else m.status end,
         m.organization_id, m.teacher_id, tp.full_name, m.student_id, sp.full_name,
         m.created_at, m.expires_at,
         coalesce(m.answered_at, case when m.status = 'open' and m.expires_at <= now() then m.expires_at end),
         array(select i.starts_at from public.lesson_proposal_items i
                where i.proposal_id = m.id order by i.starts_at),
         (select min(i.duration_minutes) from public.lesson_proposal_items i where i.proposal_id = m.id),
         public.lesson_proposal_cost(m.student_id)
    from mine m
    join public.teachers t on t.id = m.teacher_id
    join public.profiles tp on tp.id = t.user_id
    join public.profiles sp on sp.id = m.student_id
   where (m.status = 'open' and m.expires_at > now())
      or coalesce(m.answered_at, m.expires_at) > now() - interval '7 days'
   order by m.created_at desc, m.id;
$$;

comment on function public.my_lesson_proposals() is
  'The caller''s lesson proposals, as student and as teacher (#319): the open ones and those closed in the last 7 days, the state read against the clock, with both names, the starts, the length and what a lesson costs the student now (null: not on sale).';


-- What the app calls, as service_role (Q9) -------------------------------------------------
--
-- Each one security definer, owned by postgres, search_path empty, and
-- executable by service_role alone (0047, as the three of 0056).

-- The e-mails to send, oldest first, of one proposal (right after the
-- action) or of any (null: the daily routine), with what the e-mail needs:
-- the recipient's address (the student's account e-mail, or the teacher's
-- calendar e-mail), her name and zone, the proposer's name, the starts and
-- the length. Volatile: a pending row whose proposal is no longer open by the
-- clock turns skipped first. A row tried less than 30 minutes ago waits.
create function public.lesson_proposal_mails_due(p_limit integer, p_proposal uuid default null)
returns table (
  id uuid,
  proposal_id uuid,
  recipient text,
  attempts integer,
  created_at timestamptz,
  proposed_by text,
  recipient_email text,
  recipient_name text,
  recipient_timezone text,
  proposer_name text,
  starts_at timestamptz[],
  duration_minutes integer,
  expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.lesson_proposal_mails m
     set status = 'skipped'
    from public.lesson_proposals p
   where p.id = m.proposal_id and m.status = 'pending'
     and (p.status <> 'open' or p.expires_at <= now());

  return query
    select m.id, m.proposal_id, m.recipient, m.attempts, m.created_at, p.proposed_by,
           case m.recipient when 'student' then u.email else t.calendar_email end,
           case m.recipient when 'student' then sp.full_name else tp.full_name end,
           case m.recipient when 'student' then sp.timezone else tp.timezone end,
           case m.recipient when 'student' then tp.full_name else sp.full_name end,
           array(select i.starts_at from public.lesson_proposal_items i
                  where i.proposal_id = p.id order by i.starts_at),
           (select min(i.duration_minutes) from public.lesson_proposal_items i where i.proposal_id = p.id),
           p.expires_at
      from public.lesson_proposal_mails m
      join public.lesson_proposals p on p.id = m.proposal_id
      join public.teachers t on t.id = p.teacher_id
      join public.profiles sp on sp.id = p.student_id
      join public.profiles tp on tp.id = t.user_id
      left join auth.users u on u.id = p.student_id
     where m.status = 'pending'
       and (m.last_attempt_at is null or m.last_attempt_at <= now() - interval '30 minutes')
       and (p_proposal is null or m.proposal_id = p_proposal)
     order by m.created_at, m.id
     limit greatest(coalesce(p_limit, 0), 0);
end;
$$;

comment on function public.lesson_proposal_mails_due(integer, uuid) is
  'The pending proposal e-mails not tried in the last 30 minutes, oldest first, of one proposal or (null) of any, at most p_limit, with the recipient''s address, name and zone, the proposer''s name, the starts and the length (#319). Skips first the pending rows of a proposal no longer open. Executed by service_role alone.';

create function public.lesson_proposal_mail_sent(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.lesson_proposal_mails m
     set status = 'sent', sent_at = now(), last_attempt_at = now(),
         attempts = m.attempts + 1, last_error = null
   where m.id = p_id and m.status <> 'sent';
$$;

comment on function public.lesson_proposal_mail_sent(uuid) is
  'Marks a proposal e-mail sent, once (#319). Executed by service_role alone.';

create function public.lesson_proposal_mail_failed(
  p_id uuid, p_error text, p_give_up boolean, p_tried boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.lesson_proposal_mails m
     set attempts = m.attempts + case when p_tried then 1 else 0 end,
         last_error = left(p_error, 200),
         last_attempt_at = now(),
         status = case when p_give_up then 'abandoned' else m.status end
   where m.id = p_id and m.status = 'pending';
$$;

comment on function public.lesson_proposal_mail_failed(uuid, text, boolean, boolean) is
  'Records a failed proposal e-mail: its code (never an address), one attempt more when it was handed to the mail provider, and abandoned when the app gives up (#319). Executed by service_role alone.';


-- Who executes what (0047) ------------------------------------------------------------------

revoke all on function public.lesson_proposal_rules() from public, anon, authenticated, service_role;
revoke all on function public.lesson_proposals_queue_mail() from public, anon, authenticated, service_role;
revoke all on function public.lesson_write_paid(uuid, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.lesson_proposal_check_free(uuid, uuid, timestamptz[]) from public, anon, authenticated, service_role;
revoke all on function public.lesson_proposal_write(uuid, uuid, uuid, text, timestamptz[]) from public, anon, authenticated, service_role;
revoke all on function public.lesson_proposal_cost(uuid) from public, anon, authenticated, service_role;
revoke all on function public.lesson_proposal_for_answer(uuid) from public, anon, authenticated, service_role;
revoke all on function public.propose_lessons_to_student(uuid, timestamptz[]) from public, anon, service_role;
revoke all on function public.propose_lessons_to_teacher(uuid, timestamptz[]) from public, anon, service_role;
revoke all on function public.accept_lesson_proposal(uuid) from public, anon, service_role;
revoke all on function public.decline_lesson_proposal(uuid) from public, anon, service_role;
revoke all on function public.withdraw_lesson_proposal(uuid) from public, anon, service_role;
revoke all on function public.my_lesson_proposals() from public, anon, service_role;
revoke all on function public.lesson_proposal_mails_due(integer, uuid) from public, anon, authenticated;
revoke all on function public.lesson_proposal_mail_sent(uuid) from public, anon, authenticated;
revoke all on function public.lesson_proposal_mail_failed(uuid, text, boolean, boolean) from public, anon, authenticated;

-- The two screens call these six, always for auth.uid().
grant execute on function public.propose_lessons_to_student(uuid, timestamptz[]) to authenticated;
grant execute on function public.propose_lessons_to_teacher(uuid, timestamptz[]) to authenticated;
grant execute on function public.accept_lesson_proposal(uuid) to authenticated;
grant execute on function public.decline_lesson_proposal(uuid) to authenticated;
grant execute on function public.withdraw_lesson_proposal(uuid) to authenticated;
grant execute on function public.my_lesson_proposals() to authenticated;

-- The e-mail, sent by the app with the service role.
grant execute on function public.lesson_proposal_mails_due(integer, uuid) to service_role;
grant execute on function public.lesson_proposal_mail_sent(uuid) to service_role;
grant execute on function public.lesson_proposal_mail_failed(uuid, text, boolean, boolean) to service_role;
