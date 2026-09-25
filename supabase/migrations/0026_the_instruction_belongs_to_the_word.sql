-- The instruction belongs to the word, not to the screen.
--
-- Until now the Instrução field lived in the panel's state and in
-- image_attempts.subject. The panel remounts per word, so a suggestion that
-- arrived after the teacher moved to another word was dropped, and an edit
-- never used in a generation was lost on the way out. Coming back, the field
-- was filled from the approved attempt first, so an edit used in a newer
-- attempt was shown as the older text.
--
-- image_attempts.subject stays as the record of what each picture was drawn
-- from. This column is the word's latest instruction, suggested or edited,
-- whichever came last.
--
-- Measured against the project on 2026-09-25, before this was written:
--
--   select count(*) from vocabulary_items;                         -> 283
--   select count(distinct vocabulary_item_id) from image_attempts
--    where subject is not null and btrim(subject) <> '';          -> 35
--   select count(*) from image_attempts where subject is null;     -> 12 of 141
--
-- and 2 words whose approved attempt carries a different subject from their
-- most recent attempt with one. Those 2 now open on the most recent.

alter table vocabulary_items add column image_subject text;

comment on column vocabulary_items.image_subject is
  'The word''s latest image instruction, suggested or edited. Null when there is none. Never blank.';

-- No instruction is null, one way of saying it. A blank string would be a
-- second, and the screen would have to tell the two apart.
alter table vocabulary_items
  add constraint vocabulary_items_image_subject_not_blank check (
    btrim(image_subject) <> ''
  );

-- Seeded from the most recent attempt that had a subject: the last instruction
-- the teacher actually used. Ties on created_at are broken by id so the result
-- does not depend on the plan. Drafts never generated were never stored
-- anywhere and cannot be recovered.
update vocabulary_items v
set image_subject = s.subject
from (
  select distinct on (vocabulary_item_id) vocabulary_item_id, subject
  from image_attempts
  where subject is not null and btrim(subject) <> ''
  order by vocabulary_item_id, created_at desc, id desc
) s
where s.vocabulary_item_id = v.id;

-- RLS: no new table. vocabulary_items has had it enabled since 0001, with
-- vocabulary_items_teacher_all (0004) covering every operation, and a column
-- grants nothing new.
