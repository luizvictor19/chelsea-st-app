-- A question shows a word.
--
-- In the live lesson a question is a card, and the first thing the card shows
-- is a picture: the teacher points at it and asks. The picture is not the
-- question's own. It is the approved picture of a word the lesson has already
-- presented, the same one the word's own card shows, so the question says
-- which word and the picture is read from the word every time.
--
-- A reference and not a copy of the path. questions.image_path has been there
-- since 0001 and holds a path; a path copied from the word would go on naming
-- the old file after the teacher approves a better picture, or after the bin
-- removes it. Pointing at the word, the card always shows the picture the
-- word has now, and shows the neutral card when it has none. image_path is
-- left exactly as it is, read by nothing.
--
-- Measured against the project on 2026-10-02, before this was written:
--
--   select count(*) from questions;                           ->  3
--   select count(*) from vocabulary_items;                    ->  283
--   select count(*) from vocabulary_items
--    where image_path is not null;                            ->  69
--   foreign keys into vocabulary_items (pg_constraint):
--     image_attempts.vocabulary_item_id        on delete cascade
--     contrast_set_items.vocabulary_item_id    on delete restrict
--   vocabulary_items.first_point_id -> points  on delete restrict
--
-- The three questions that exist get null, which is what they are today:
-- questions with no picture. Nothing is backfilled, because nothing says
-- which word each of them is about.
--
-- NULL IS A QUESTION WITH NO PICTURE. Most of the book's questions point at
-- nothing ("Is the table long or short?" is asked of the room), so the column
-- is nullable and has no default to speak of.
--
-- ON DELETE RESTRICT, as contrast_set_items in 0022 and for the same reason.
-- A word is never deleted by the application, and nothing reaches it by
-- cascade: its own point holds it with restrict. So the clause only decides
-- what a delete made by hand does. set null would take the picture off every
-- question that shows the word and say nothing; cascade would take the
-- questions. With restrict the delete is refused until the questions are
-- pointed elsewhere, which makes losing the picture a decision.
--
-- What restrict does not cover, on purpose: the word staying, and its picture
-- going (reclassified, or the approved attempt binned). That is the picture's
-- life, held by 0016 and 0021, and the question follows it: the card falls
-- back to the neutral one and the questions screen says the word has no
-- approved picture. Nothing here stores whether the word had a picture when
-- it was chosen.
--
-- NO RULE THAT THE WORD IS PRESENTED BY THE QUESTION'S POINT. The screen
-- offers only those, by the validator's criterion, and the validator itself
-- warns and never blocks (presented.ts). A trigger here would turn a warning
-- into a refusal, and would have to be re-judged whenever a word or a
-- contrast set moves.
--
-- NO INDEX. The screens read from the question to the word, through the
-- word's primary key. The other direction, from a word to the questions that
-- show it, is walked only by the restrict check when a word is deleted, which
-- the application never does, over a table of 3 rows today.
alter table questions
  add column shown_vocabulary_item_id uuid
    constraint questions_shown_vocabulary_item_id_fkey
    references vocabulary_items on delete restrict;

comment on column questions.shown_vocabulary_item_id is
  'The word whose approved picture the question''s card shows first in the live lesson. Null for a question with no picture.';

-- RLS: no new table. questions has had row level security since 0001:
-- questions_select_published lets the student read what is published and
-- questions_write_teacher covers every write, and the table's grants are on
-- the table, so the column inherits all of it. A student who reads a
-- published question reads this id with it and nothing behind it:
-- vocabulary_items has had a teacher-only policy since 0004.
