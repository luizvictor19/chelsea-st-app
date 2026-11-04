-- A point she stopped at is named (#131).
--
-- Since 0035 a point a lesson stopped at cannot be deleted
-- (lessons_stopped_at_point_fkey, on delete restrict). materialize_points
-- checked only content and lessons of content before deleting the points
-- outside a narrower range, so narrowing past a marked point reached the
-- foreign key: 23503, in its own words, after the checks said yes. Now it
-- counts those points with the others, before anything is written, and the
-- refusal names them as a third reason.
--
-- Measured against the project on 2026-11-04, before this was written:
-- migrations applied through 0038; materialize_points(uuid, integer, integer)
-- is the text of 0029, line by line, security invoker, execute held by postgres
-- and authenticated only. lessons 11 rows, 1 with stopped_at_point_id: point 5
-- of the common book at position 1, whose range is 1..52. points 128.
--
-- What changes for a caller: a narrowing that went through before still goes
-- through. The new count refuses exactly what the foreign key refused, with
-- P0001 and a sentence instead of 23503, and before the delete instead of
-- during it.
--
-- Same signature, so create or replace keeps the grants of 0006. Still
-- security invoker: whoever may configure a book reads every lesson that can
-- mark one of its points (a common book only by a platform admin, who reads
-- every lesson; a school's book only by its admin or teacher, and
-- lessons_stop_in_school keeps marks on it to lessons of that school).
--
-- The sentence of the refusal is read by src/app/teacher/content/range-refusal.ts,
-- which translates it for the teacher, and asserted word for word by
-- scripts/verify-rls.sql. A change to it is made in the three places.

create or replace function materialize_points(p_book_id uuid, p_first_point integer, p_last_point integer)
returns integer
language plpgsql
as $$
declare
  v_inserted integer;
  v_blocked_points integer;
  v_blocked_lessons integer;
  v_stopped_points integer;
begin
  if not can_write_content((select school_id from books where id = p_book_id)) then
    raise exception 'only a teacher of the book''s school may configure it';
  end if;

  if p_first_point is null or p_first_point < 1 then
    raise exception 'p_first_point must be at least 1, got %', p_first_point;
  end if;

  if p_last_point is null or p_last_point < p_first_point then
    raise exception
      'p_last_point must be at least p_first_point, got % and %',
      p_last_point, p_first_point;
  end if;

  if not exists (select 1 from books where id = p_book_id) then
    raise exception 'no such book: %', p_book_id;
  end if;

  -- All three checked before anything is written, so a refusal leaves the
  -- book exactly as it was.
  select count(*) into v_blocked_points
  from points p
  where p.book_id = p_book_id
    and (p.number < p_first_point or p.number > p_last_point)
    and (
      exists (select 1 from blocks b where b.point_id = p.id)
      or exists (select 1 from questions q where q.point_id = p.id)
      or exists (select 1 from vocabulary_items v where v.first_point_id = p.id)
    );

  select count(*) into v_blocked_lessons
  from lessons_content lc
  where lc.book_id = p_book_id
    and (lc.first_point < p_first_point or lc.last_point > p_last_point);

  -- A point a lesson stopped at is restricted by lessons_stopped_at_point_fkey
  -- (0035). Counted apart from content: the teacher has to know the reason is
  -- a lesson, to know where to look. A point with content and a mark counts in
  -- both.
  select count(*) into v_stopped_points
  from points p
  where p.book_id = p_book_id
    and (p.number < p_first_point or p.number > p_last_point)
    and exists (select 1 from lessons l where l.stopped_at_point_id = p.id);

  if v_blocked_points > 0 or v_blocked_lessons > 0 or v_stopped_points > 0 then
    raise exception
      'cannot narrow book % to %..%: % point(s) outside carry content, % lesson(s) reach outside, % point(s) outside are where a lesson stopped',
      p_book_id, p_first_point, p_last_point, v_blocked_points, v_blocked_lessons, v_stopped_points;
  end if;

  delete from points
  where book_id = p_book_id
    and (number < p_first_point or number > p_last_point);

  update books
  set first_point = p_first_point, last_point = p_last_point
  where id = p_book_id;

  insert into points (book_id, number)
  select p_book_id, n
  from generate_series(p_first_point, p_last_point) as n
  where not exists (
    select 1 from points p where p.book_id = p_book_id and p.number = n
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
