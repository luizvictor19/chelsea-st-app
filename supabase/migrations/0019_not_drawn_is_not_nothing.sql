-- The other half of 0018: the 22 rows re-decided, and the three places that
-- read `none` as "no picture" taught the difference.
--
-- 0018 could only add the two labels, because `alter type ... add value` does
-- not allow the new value to be used in the transaction that adds it. Every
-- statement below names one of them, so this is where they come into use.

-- THE 22 ROWS, BY NAME.
--
-- Named one by one rather than caught by a rule, because a rule over word
-- class would be a guess dressed as a criterion: `this` and `which` are both
-- pronouns to the parser and only one of them is a question word, `Mr` is a
-- noun exactly as `pen` is. What decides is what the word does in a sentence,
-- which is the teacher's reading of his own book, so it is written out.
--
-- Measured on 2026-09-20, before this was written:
--
--   select count(*) from vocabulary_items where representation = 'none';
--   ->  22, and not one of them has an image_path
--
-- Twenty-one of them are usage. `contraction` is the one metalanguage word
-- already decided, and the first of a class the book uses throughout.
--
-- `Mr` and `Mrs` are in the usage list, which contradicts docs/spec-imagens.md
-- as it stands ("título sozinho: Nada"). That line was written when the only
-- choices were an image or nothing, and the new values dissolve its premise:
-- "Mr Brown is a man." is the sentence those two need. The line comes out of
-- the spec in the same commit as this file.
--
-- The counts are recorded here and deliberately not enforced. This migration
-- is applied by scripts/verify-rls.sql to an empty Postgres in CI, where every
-- count is zero, so a `raise` on the row count would turn the gate red on a
-- database that is behaving correctly. The names are the guard instead: an
-- update by name either finds the row or changes nothing, and it cannot change
-- the wrong one.
update vocabulary_items
   set representation = 'usage'
 where representation = 'none'
   and lower(term) in (
     'a', 'this', 'what is (what''s)', 'it is (it''s)',
     'is this?', 'it is not (isn''t)', 'yes', 'no',
     'the', 'or', 'mr', 'mrs', 'what colour?', 'where',
     'me', 'you', 'him', 'her',
     'doing', 'what am i doing?', 'which'
   );

update vocabulary_items
   set representation = 'metalanguage'
 where representation = 'none'
   and lower(term) = 'contraction';

-- Two open items close in that list, and neither of them by being worked on.
--
-- `me`, `you`, `him` and `her` going to usage ends the one docs/spec-imagens.md
-- had been holding since 2026-09-19: the personal pronoun was `none` "for now",
-- because a figure on its own does not say "him" — a photograph of a man says
-- "man" — and the item was pinned to the tutor's scene, waiting for a model
-- that takes a reference. It stops waiting. A pronoun never needed a scene or
-- a drawing; it needed a sentence that uses it, and that is what usage is.
--
-- `doing` and `what am I doing?` close the other, a rule that had been waiting
-- to be written into the suggestion prompt — "a verb with no specific action is
-- Outro". It is not written; it stops being needed, because the answer for
-- those two was never "nothing to show" but "show it in use".

-- THE SUGGESTIONS THAT ANSWERED A QUESTION THAT NO LONGER EXISTS.
--
-- The rows above carry a suggestion as well as a decision, and the distance
-- between the two columns is what docs/spec-imagens.md calls the measurement of
-- how good the suggestions are. Left alone, this migration would wreck that
-- measurement without touching a single suggestion.
--
-- Measured on 2026-09-20, before this was written:
--
--   select suggested_representation, count(*) from vocabulary_items
--    where representation = 'none' group by 1;     ->  none 21, action 1
--
--   select count(*) filter (where representation is not null
--                             and suggested_representation is not null),
--          count(*) filter (where representation is not null
--                             and suggested_representation is not null
--                             and representation <> suggested_representation)
--     from vocabulary_items;                       ->  78 decided-and-suggested,
--                                                      1 of them disagreeing
--
-- Those 21 would become 21 disagreements the moment their decision moved to
-- usage, and the screen would report "the model suggested nothing" for each.
-- The measurement would read 22 in 78 instead of 1 in 78, with nothing to tell
-- the real one from the manufactured ones.
--
-- And they would be false. The model was asked to choose among six kinds, and
-- `usage` was not one of them: `none` was the only answer it had for "nothing
-- to draw". An answer given to a question that is no longer asked is not a
-- disagreement, it is an obsolete answer, and null is how this schema says a
-- word has not been suggested yet. Nulled, they are picked up again by the
-- panel and re-suggested under the prompt that now has all eight.
--
-- Only the ones that said `none`. The single row suggesting `action` is
-- `doing`, and that one is a real disagreement between the model and the
-- teacher, made under a question the model could answer: the model saw a verb
-- and read activity, the teacher saw a word that has no activity of its own.
-- It is the disagreement the new taxonomy explains rather than one it
-- invents, and it stays exactly where it is.
--
-- This runs after the two updates above, and keys on the decision they wrote.
update vocabulary_items
   set suggested_representation = null
 where representation in ('usage', 'metalanguage')
   and suggested_representation = 'none';

-- THE PENDING LIST.
--
-- 0008 keyed this on `representation <> 'none'`, which was the whole truth
-- while `none` was the only decision that carried no picture. From here it
-- would hold all 22 rows above in the pending-image list forever: decided,
-- never drawable, and counted as work still to do.
--
-- The predicate names the kinds that are drawn rather than the kinds that are
-- not. A value added to the enum later and forgotten here then stays out of
-- the pending list, which is a gap on a screen; the other polarity would pull
-- it in and demand a picture that nothing can generate. Both are wrong, and
-- the first is the one that can be seen. What actually catches it is
-- scripts/drawable-kinds.test.ts, which holds this predicate, the function
-- below and isDrawableKind in src/lib/images/style.ts to naming the same set.
drop index vocabulary_items_pending_image_idx;
create index vocabulary_items_pending_image_idx on vocabulary_items (first_point_id)
  where representation is null
     or (representation in ('photo', 'pose', 'action', 'figure') and image_path is null);

-- CHOOSING A KIND THAT CARRIES NO PICTURE.
--
-- 0009 undid the approval only under `if p_kind = 'none'`, and said why: a
-- picture left attached to a word that takes none is the kind of leftover
-- nobody goes looking for. Usage and metalanguage say exactly the same thing
-- about a picture, so without this they would walk past that guard —
-- reclassifying a word that already has an approved image would leave
-- image_path and approved_attempt_id pointing at a file no screen will ever
-- show, and vocabulary_items_approved_pair would stay quiet, because the two
-- columns remain paired with each other while pointing at nothing anyone
-- wants.
--
-- Nothing has been lost yet, and that is measured rather than assumed. On
-- 2026-09-20, before this was written: no word decided `none` or `symbol`
-- has an image_path, so there is nothing to repair. This closes a door that
-- 0018 opened rather than cleaning up after it.
--
-- `symbol` comes in with them, which is a change of behaviour and not a
-- restatement. A symbol is rendered by the screen as the character itself, so
-- an approved picture on a symbol word is the same leftover the function was
-- written to prevent; it was outside the old condition only because `none`
-- was the only kind anyone had thought about. Nothing is affected today: the
-- ten symbol words have no image between them.
--
-- The list is the same four kinds as the index above, spelled the same way on
-- purpose, so the test that compares them compares text and not an idea of it.
create or replace function clear_word_representation(
  p_word uuid,
  p_kind representation_kind
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update vocabulary_items
     set representation = p_kind
   where id = p_word;

  if not found then
    raise exception 'vocabulary item % not found', p_word;
  end if;

  if p_kind not in ('photo', 'pose', 'action', 'figure') then
    update image_attempts
       set status = 'rejected', decided_at = now()
     where vocabulary_item_id = p_word
       and status = 'approved';

    -- Both columns together: the approved-pair check refuses one without
    -- the other.
    update vocabulary_items
       set approved_attempt_id = null,
           image_path = null
     where id = p_word;
  end if;
end;
$$;

-- create or replace keeps the privileges 0009 granted, as 0016 relied on for
-- approve_image_attempt: the revoke from public and the grant to authenticated
-- still stand.

-- One thing here is deliberately left as it was, and is written down so that
-- leaving it is a decision rather than an oversight. The demotion above still
-- writes 'rejected', while 0016 established that being replaced is not being
-- rejected and moved approve_image_attempt to 'generated' with decided_at back
-- to null. Choosing a kind that carries no picture is no more a judgement of
-- the picture than replacing it was, and since 2026-09-19 'rejected' also
-- carries "discarded, and the file is gone" — which is not true of these rows,
-- whose files stay in the bucket. By 0016's own reasoning this write is the
-- same confusion in another function. It is not changed here because it would
-- change what happens on a path that already exists, for words decided `none`,
-- and that is its own decision with its own migration, not a rider on this one.
--
-- No RLS statement, and not an omission: no table is created here. The updates
-- run under the policies that already cover vocabulary_items and
-- image_attempts, and the function is security invoker, so those policies stay
-- the thing that decides.
