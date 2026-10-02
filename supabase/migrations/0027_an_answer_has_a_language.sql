-- An answer has a language, and the order of a point's questions is written
-- whole.
--
-- The teacher now writes the questions of a lesson by hand, on a screen of
-- their own. Two things that screen does have nowhere to stand in the schema
-- as 0004 left it.
--
-- Measured against the project on 2026-10-01, before this was written:
--
--   select count(*) from questions;          ->  0
--   select count(*) from assignment_items;   ->  0
--   select count(*) from attempts;           ->  0
--   select count(*) from review_schedule;    ->  0
--   select condeferrable from pg_constraint
--    where conname = 'questions_point_id_position_key';   ->  false
--
-- No question exists yet, so nothing below touches a row: the default
-- backfills nothing and the functions have nothing to renumber.
--
-- 1. THE LANGUAGE OF THE ANSWER.
--
-- The book's translation questions expect the answer in Portuguese. Until now
-- nothing said so, and everything that reads expected_answer would have to
-- guess: the validator that warns about a word not presented yet must leave a
-- Portuguese answer alone, and whatever judges a spoken answer later has to
-- know which language it is listening for.
--
-- An enum and not a check on a text column, for the reasons 0017 gives for
-- image_style and one more. The generated types carry the two values, so the
-- screen's selector and the validator's switch are checked against the
-- database by the compiler, and a hand-written list in TypeScript cannot
-- drift from it. A third language later is one ALTER TYPE ... ADD VALUE, in a
-- migration of its own if the same migration needs to use the value.
--
-- Creating the type and using it in the same migration is fine: the rule that
-- caught 0010 is about ALTER TYPE ... ADD VALUE, not CREATE TYPE.
--
-- Only the answer has a language. The prompt is read as English by
-- everything that reads it, and a column for a case nobody has asked for yet
-- would be a value nobody reads.
create type answer_language as enum ('en', 'pt');

-- NOT NULL with a default of English: an answer is in English unless the
-- teacher says otherwise, which is what every answer in the book is outside
-- the translation exercises. Null would be a third case, "nobody said", that
-- every reader would have to collapse back to English.
alter table questions
  add column answer_language answer_language not null default 'en';

comment on column questions.answer_language is
  'The language expected_answer is written in. English unless the teacher says Portuguese, as in the book''s translation questions.';

-- 2. THE ORDER, WRITTEN WHOLE.
--
-- position is unique per point (0004) and the screen keeps it dense, 0 to
-- n - 1. The unique is not deferrable, so two questions cannot trade places
-- in two updates: the first lands on the position the second still holds.
-- And the client cannot hold a transaction across calls, so a swap made of
-- three requests through a spare position can stop halfway and leave a
-- question parked there, with the order the teacher chose gone and nothing
-- said. The reason save_contrast_set exists in 0022, again.
--
-- So the order of a point is written by one function, from the whole list.
-- It parks every question above both the positions in use and the positions
-- it is about to write, then numbers them from 0. Neither statement can
-- collide with itself whatever order the rows are visited in, and the unique
-- stays as immediate as it was.
--
-- The list has to be exactly the point's questions. A screen that loaded
-- before another tab added or removed one would otherwise number a list that
-- is no longer the point's, so that is refused with SQLSTATE QS001 and
-- nothing written, the way CS001 refuses a stale contrast set.
--
-- Deleting closes the gap in the same transaction, for the same reason: a
-- delete and a renumbering in two requests can leave the hole.
--
-- What is not here: nothing in the database holds the positions dense on
-- every path, the way contrast_set_is_whole does for a contrast set. A row
-- written straight into the table can still leave a gap. The two functions
-- keep it dense on the paths the screen uses, and an insert at the end keeps
-- a dense point dense.
--
-- Both are security invoker, like the write paths since 0009, so the
-- policies of 0001 stay what decides who may write. The teacher check at the
-- top only turns a silent nothing into a refusal: a student sees the
-- published questions, and without it her call would match the rows, update
-- none of them, and return as if it had worked.

/*
 * Writes the order of a point's questions: p_ids, in the order wanted, become
 * positions 0 to n - 1.
 *
 * Refuses, before writing anything, a list that is not exactly the point's
 * questions: one missing, one from another point, one repeated, a null. That
 * is SQLSTATE QS001, and it means the caller's view of the point is stale.
 */
create function reorder_questions(p_point_id uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
  v_given integer := coalesce(cardinality(p_ids), 0);
  v_base integer;
begin
  if not is_teacher() then
    raise exception 'only a teacher may order questions'
      using errcode = 'insufficient_privilege';
  end if;

  -- The point's row is the one lock every write to its order takes, before
  -- anything is counted. Two orderings made from the same view cannot both
  -- compare equal and then interleave, and an insert waits too, since its
  -- foreign key needs a share of this row.
  --
  -- One row and not the questions themselves: locking those, two deletes in
  -- the same point each held the question it had just deleted and waited for
  -- the other's, and the database ended one of them as a deadlock.
  perform 1 from points where id = p_point_id for update;

  select count(*), coalesce(max(position), 0) into v_count, v_base
    from questions where point_id = p_point_id;

  -- Two clauses, and they are the whole test. As many ids as the point has
  -- questions, and that many of the point's questions among them: then every
  -- question is named once, and a repeated, null or foreign id has no room.
  if v_count <> v_given
     or (select count(*) from questions
          where point_id = p_point_id and id = any(p_ids)) <> v_given then
    raise exception
      'the questions of point % changed since they were loaded: nothing was reordered',
      p_point_id
      using errcode = 'QS001';
  end if;

  -- Above every position in use and above every position about to be
  -- written, so neither statement meets a row the other has not moved yet.
  v_base := greatest(v_base, v_given - 1);

  update questions q
     set position = (v_base + m.n)::integer
    from unnest(p_ids) with ordinality as m(id, n)
   where q.id = m.id;

  update questions q
     set position = (m.n - 1)::integer
    from unnest(p_ids) with ordinality as m(id, n)
   where q.id = m.id;
end;
$$;

/*
 * Deletes a question and closes the gap it leaves, so the point's positions
 * run 0 to n - 1 again.
 *
 * A question a student has already been given or has answered is not deleted:
 * assignment_items and attempts hold it with restrict (0001), and that
 * refusal passes through as it is. Unpublishing is how such a question is
 * taken out of use.
 */
create function delete_question(p_question_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_point uuid;
begin
  if not is_teacher() then
    raise exception 'only a teacher may delete a question'
      using errcode = 'insufficient_privilege';
  end if;

  -- The same lock reorder_questions takes, and taken before the delete: see
  -- there. A question that does not exist locks nothing and is refused below.
  perform 1 from points
    where id = (select point_id from questions where id = p_question_id)
      for update;

  delete from questions where id = p_question_id returning point_id into v_point;

  if v_point is null then
    raise exception 'question % not found', p_question_id;
  end if;

  perform reorder_questions(
    v_point,
    array(select id from questions where point_id = v_point order by position));
end;
$$;

revoke all on function reorder_questions(uuid, uuid[]) from public;
grant execute on function reorder_questions(uuid, uuid[]) to authenticated;
revoke all on function delete_question(uuid) from public;
grant execute on function delete_question(uuid) to authenticated;

-- RLS: no new table. questions has had row level security since 0001, with
-- questions_select_published letting the student read what is published and
-- questions_write_teacher covering every write. A column inherits both, and
-- the functions run as their caller.
