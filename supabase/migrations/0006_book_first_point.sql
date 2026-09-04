-- The book's first point, alongside its last.
--
-- Only the ceiling was asked for, on the assumption that books would be filled
-- in order and the floor would follow from the previous book's ceiling. That is
-- an invisible coupling: it breaks the day book 5 goes up before book 4, and it
-- breaks quietly, by validating margin readings against a floor that is wrong.
--
-- Both numbers are read off the book itself, the first page and the last, and
-- neither depends on any other book.
-- No backfill, on purpose.
--
-- A book already holding points has no first_point after this, and shows as not
-- configured until someone types the range. That is deliberate: only the
-- teacher knows where a book really starts, and it is read off the book's first
-- page. Guessing it from the lowest point already uploaded would be wrong
-- whenever the upload began part way in, and would be wrong silently, which is
-- the failure this column exists to prevent.
--
-- The cost is typing the range once per book that was already populated. If
-- that ever becomes more than a handful, the answer is a screen that asks,
-- never a default that invents.
alter table books add column first_point integer check (first_point > 0);

alter table books
  add constraint books_point_range_check
  check (
    first_point is null
    or last_point is null
    or last_point >= first_point
  );

drop function materialize_points(uuid, integer);

/*
 * Creates the empty points of a book across its range, and records the range.
 *
 * Idempotent: widening the range adds only the numbers that are missing.
 *
 * Narrowing it, from either end, is a typo correction rather than a way to
 * discard work, so it refuses whenever a point that would be removed already
 * carries something. The ceiling had this guard from the start; the floor needs
 * exactly the same one, since raising it discards points just as surely as
 * lowering the ceiling does.
 *
 * "Carries something" means a block, a question, or a vocabulary item
 * introduced there. Vocabulary counts because first_point_id is restrict:
 * without the check the delete would fail as a raw foreign key error instead of
 * a message saying how many points are in the way. A lesson whose range falls
 * outside the new one stops it too, because lessons_content holds its range as
 * plain integers with no foreign key into points.
 *
 * Security invoker, like the others: the writes are checked by the policies on
 * these tables, and the guard below only turns a policy violation into a
 * message worth reading.
 */
create function materialize_points(
  p_book_id uuid,
  p_first_point integer,
  p_last_point integer
)
returns integer
language plpgsql
as $$
declare
  v_inserted integer;
  v_blocked_points integer;
  v_blocked_lessons integer;
begin
  if not is_teacher() then
    raise exception 'only a teacher may configure a book';
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

  -- Both checked before anything is written, so a refusal leaves the book
  -- exactly as it was.
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

  if v_blocked_points > 0 or v_blocked_lessons > 0 then
    raise exception
      'cannot narrow book % to %..%: % point(s) outside carry content, % lesson(s) reach outside',
      p_book_id, p_first_point, p_last_point, v_blocked_points, v_blocked_lessons;
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

revoke all on function materialize_points(uuid, integer, integer) from public;
grant execute on function materialize_points(uuid, integer, integer) to authenticated;
