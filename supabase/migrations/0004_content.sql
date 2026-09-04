-- The curriculum map extracted from the books.
--
-- Replaces stages, which held no data and was too shallow: a stage could not
-- express the numbered point, which is the ruler the whole product measures
-- progress against.
--
-- The numbers in the page margin are sequential and global within a book and do
-- not restart per lesson, so a point belongs to a book, and a lesson is a range
-- over those points rather than their parent.

create type block_kind as enum (
  'vocabulary',
  'grammar_table',
  'explanation',
  'dictation',
  'revision_exercise',
  'chart_ref'
);

create table books (
  id uuid primary key default gen_random_uuid(),
  position integer not null unique check (position between 1 and 12),
  title text not null,
  -- Typed by the teacher, and the ceiling that validates a margin reading.
  -- Null until then, which is what "not configured" means on the index screen.
  last_point integer check (last_point > 0),
  created_at timestamptz not null default now()
);

-- Named with the suffix because `lessons` is already the student's booked
-- classes. This is a lesson of the book.
create table lessons_content (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books on delete cascade,
  number integer not null check (number > 0),
  first_point integer not null check (first_point > 0),
  last_point integer not null check (last_point > 0),
  created_at timestamptz not null default now(),
  unique (book_id, number),
  check (last_point >= first_point)
);

create table points (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books on delete cascade,
  number integer not null check (number > 0),
  -- Null until a LESSON header places this point inside a lesson. A point is
  -- created the moment the teacher sets last_point, long before that is known.
  lesson_content_id uuid references lessons_content on delete set null,
  -- Null while the point is empty. This is what the progress bars count.
  filled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (book_id, number)
);
create index points_unfilled_idx on points (book_id, number) where filled_at is null;

create table blocks (
  id uuid primary key default gen_random_uuid(),
  point_id uuid not null references points on delete cascade,
  position integer not null check (position >= 0),
  kind block_kind not null,
  content text not null,
  -- Set by the extractor for boxes tall enough to be a table, whose flattening
  -- into one line loses the column pairing. The review screen shows these first,
  -- beside the original crop.
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  -- Refuses a second row at the same position. It does not overwrite: the
  -- constraint is a guard, not an upsert. Re-uploading a page is made
  -- idempotent by the confirmation code, which deletes the point's blocks
  -- before inserting the new ones.
  unique (point_id, position)
);

create table vocabulary_items (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  -- Where the word is introduced. A generated sentence may only use words whose
  -- first point is at or before the point being generated.
  --
  -- restrict, not cascade: the word feeds generation for every later point, so
  -- deleting the point that introduces it has to be a deliberate act rather
  -- than a side effect.
  first_point_id uuid not null references points on delete restrict,
  image_path text,
  created_at timestamptz not null default now()
);
-- Unique on the folded term, not the raw one: "See" and "see" are the same word,
-- and the spec calls for one row per word in the system.
create unique index vocabulary_items_term_idx on vocabulary_items (lower(term));
create index vocabulary_items_without_image_idx on vocabulary_items (term)
  where image_path is null;

-- Questions hang off a point now. Both tables are empty, so this is a column
-- swap and not a data migration.
--
-- The add below is not null with no default, which only works because the table
-- has no rows. That holds today and is what will run against production, but it
-- stops holding the moment a single question exists, so this migration cannot
-- be replayed onto a populated database.
alter table questions drop column stage_id;
alter table questions
  add column point_id uuid not null references points on delete cascade;
alter table questions
  add constraint questions_point_id_position_key unique (point_id, position);

-- The replacement for this pointer is the table linking a booked lesson to the
-- points it covered, which is a later phase. A scalar here would not be that,
-- and nothing reads it today.
alter table students drop column current_stage_id;

drop table stages;

/*
 * Creates the empty points of a book up to p_last_point and records the ceiling.
 *
 * Raising the ceiling is idempotent: the not exists guard adds only the numbers
 * that are missing, so a second run inserts nothing.
 *
 * Lowering it is a typo correction, not a way to discard work. last_point is the
 * ceiling that validates a margin reading, so leaving it below the highest point
 * that exists would silently turn legitimate readings into discarded noise, and
 * that surfaces weeks later as a page that mysteriously will not extract. So a
 * lower ceiling either removes the points above it, when they are all empty, or
 * refuses and changes nothing.
 *
 * "Empty" means no blocks, no questions and no vocabulary item introduced there.
 * Vocabulary counts because first_point_id is restrict: without the check the
 * delete would fail as a raw foreign key error instead of a message that says
 * how many points are in the way.
 *
 * A lesson reaching past the new ceiling stops it too. lessons_content holds its
 * range as plain integers with no foreign key into points, so nothing at the
 * schema level would notice a lesson left pointing at numbers that no longer
 * exist. It is a narrow case, needing a lesson recorded before any of its points
 * carry a block, but it is the kind that goes unnoticed until something reads
 * the range.
 *
 * Security invoker, like materialize_lessons in 0003. The writes are checked by
 * the policies below, so RLS stays the real defence and the guard here only
 * turns a policy violation into a message worth reading.
 */
create function materialize_points(p_book_id uuid, p_last_point integer)
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

  if p_last_point is null or p_last_point < 1 then
    raise exception 'p_last_point must be at least 1, got %', p_last_point;
  end if;

  if not exists (select 1 from books where id = p_book_id) then
    raise exception 'no such book: %', p_book_id;
  end if;

  -- Both checked before anything is written, so a refusal leaves the book
  -- exactly as it was.
  select count(*) into v_blocked_points
  from points p
  where p.book_id = p_book_id
    and p.number > p_last_point
    and (
      exists (select 1 from blocks b where b.point_id = p.id)
      or exists (select 1 from questions q where q.point_id = p.id)
      or exists (select 1 from vocabulary_items v where v.first_point_id = p.id)
    );

  select count(*) into v_blocked_lessons
  from lessons_content lc
  where lc.book_id = p_book_id
    and lc.last_point > p_last_point;

  if v_blocked_points > 0 or v_blocked_lessons > 0 then
    raise exception
      'cannot lower the ceiling of book % to %: % point(s) above it carry content, % lesson(s) reach past it',
      p_book_id, p_last_point, v_blocked_points, v_blocked_lessons;
  end if;

  delete from points
  where book_id = p_book_id and number > p_last_point;

  update books set last_point = p_last_point where id = p_book_id;

  insert into points (book_id, number)
  select p_book_id, n
  from generate_series(1, p_last_point) as n
  where not exists (
    select 1 from points p where p.book_id = p_book_id and p.number = n
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

alter table books enable row level security;
alter table lessons_content enable row level security;
alter table points enable row level security;
alter table blocks enable row level security;
alter table vocabulary_items enable row level security;

-- Content is the teacher's own working material. The student reaches published
-- questions and nothing else, so these carry no student policy at all: she is
-- not denied, she simply matches no rows.
create policy books_teacher_all on books
  for all using (is_teacher()) with check (is_teacher());
create policy lessons_content_teacher_all on lessons_content
  for all using (is_teacher()) with check (is_teacher());
create policy points_teacher_all on points
  for all using (is_teacher()) with check (is_teacher());
create policy blocks_teacher_all on blocks
  for all using (is_teacher()) with check (is_teacher());
create policy vocabulary_items_teacher_all on vocabulary_items
  for all using (is_teacher()) with check (is_teacher());

-- Explicit privileges, because the project does not expose new tables
-- automatically. RLS still decides the rows; this decides whether the API may
-- reach the table at all.
grant select, insert, update, delete on books to authenticated;
grant select, insert, update, delete on lessons_content to authenticated;
grant select, insert, update, delete on points to authenticated;
grant select, insert, update, delete on blocks to authenticated;
grant select, insert, update, delete on vocabulary_items to authenticated;

revoke all on books from anon;
revoke all on lessons_content from anon;
revoke all on points from anon;
revoke all on blocks from anon;
revoke all on vocabulary_items from anon;

revoke all on function materialize_points(uuid, integer) from public;
grant execute on function materialize_points(uuid, integer) to authenticated;
