-- The twelve books of the course.
--
-- They are fixed: the method has twelve and always will, so they are reference
-- data belonging to the product rather than something the teacher creates one
-- at a time. Creating them by hand meant an insert in the SQL editor before any
-- book could be opened, and an index that showed only what had been typed so
-- far rather than the course.
--
-- No range. Where a book begins and ends is read off its own first and last
-- page, and only the teacher can do that; inventing a range here would be the
-- guess that migration 0006 deliberately refuses to make.
--
-- Idempotent, and it does not argue with a book that already exists: a row
-- already at that position keeps its title and its range untouched. This runs
-- on an empty database and on one where book 2 was already created by hand, and
-- both end with twelve books and nothing lost.
insert into books (position, title)
select n, 'Book ' || n
from generate_series(1, 12) as n
on conflict (position) do nothing;
