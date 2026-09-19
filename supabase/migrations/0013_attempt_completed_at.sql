-- When an attempt stopped waiting, so that how long it waited is a fact and
-- not a memory.
--
-- Until now the generation was awaited inside one server action, and how long
-- it took existed only on a counter on the screen while it ran. The whole
-- record of it is two observations a person read off that counter on
-- 2026-09-19, 8s and 21s, which is what POLL_TIMEOUT_MS was justified by:
-- nothing. From here the wait belongs to the row, and the row says when it
-- ended.
--
-- created_at already says when it began. completed_at is set once, on the way
-- out of 'pending', whether the attempt ended in an image or in an error, so
-- completed_at - created_at is the real duration, comparable per model:
--
--   select model, count(*),
--          percentile_cont(0.5) within group (
--            order by completed_at - created_at) as p50,
--          max(completed_at - created_at) as worst
--   from image_attempts
--   where provider = 'freepik' and completed_at is not null
--   group by model;
--
-- Null on every row that already exists, and no backfill. decided_at is when
-- the teacher judged the attempt, which on the seventeen rows of 2026-09-19
-- is minutes after the picture appeared; using it as a completion time would
-- write a duration that was never measured into a column that reads like one.
--
-- RLS: image_attempts already has it enabled with image_attempts_teacher_all
-- covering every operation. A column is not a new table and this grants
-- nothing new.
alter table image_attempts add column completed_at timestamptz;

comment on column image_attempts.completed_at is
  'When the attempt left pending, for an image or for an error. Null on rows made before 2026-09-19 and on an attempt still running.';
