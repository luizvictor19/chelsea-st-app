-- A lesson marks where she stopped (#127). Design approved by Luiz on
-- 2026-10-30 in #70.
--
-- Where a student stopped is one fact per lesson: the point the teacher was on
-- when she pressed "Parei aqui". The points seen in a lesson are the ones
-- between the previous lesson's mark and this one, so they are not written one
-- by one, and there is no second record that could disagree with the first.
-- The reference is points.id, as spec-ingestao.md planned for this marker; the
-- point and not the slide, because a slide's index moves when a word is added
-- and the point's number does not.
--
-- Measured against the project on 2026-10-30, before this was written: lessons
-- 1 row (a test one, 2026-09-03); points 128 rows, all common (school_id null).
-- The column is born null, so no existing row changes value.

alter table lessons
  add column stopped_at_point_id uuid
    constraint lessons_stopped_at_point_fkey references points (id) on delete restrict;

comment on column lessons.stopped_at_point_id is
  'The point the teacher marked as where this lesson stopped (#127); null until marked.';

-- On delete restrict, and neither of the others. Raising a book's range
-- discards points (materialize_points, 0006): set null would erase a student's
-- mark without a word, and cascade would take her lesson with it. A point
-- someone stopped at refuses to go, and the refusal is what gets said.

-- A mark names a point of the lesson's school ---------------------------------------
--
-- The point is common or the lesson's school's own. RLS hides another school's
-- points from a teacher's reads, but a foreign key accepts any id typed into
-- it, so the rule is written here. Refused as a check, named by the trigger,
-- as school_follows_parents is (0030).
--
-- One side is enough: a lesson's school_id never changes once written
-- (school_follows_parents refuses it), and neither does a point's.
--
-- Named so it runs after lessons_school: triggers of the same event fire in
-- name order, and on insert that one is what fills new.school_id.
--
-- Security definer: the check has to see the point whatever the writer's
-- policies let her read.
create function lesson_stop_in_school()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stopped_at_point_id is not null
     and not exists (
       select 1
         from points p
        where p.id = new.stopped_at_point_id
          and (p.school_id is null or p.school_id = new.school_id)
     ) then
    raise exception 'lesson %: point % is not common nor of the lesson''s school',
      new.id, new.stopped_at_point_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

create trigger lessons_stop_in_school
  before insert or update of stopped_at_point_id on lessons
  for each row execute function lesson_stop_in_school();
