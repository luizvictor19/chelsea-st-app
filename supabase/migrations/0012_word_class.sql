-- What part of speech a word is, kept apart from how it gets drawn.
--
-- Two columns and not one, because they are different kinds of thing. The
-- word class is a fact about the word: "book" is a noun whoever is asked.
-- The representation is a decision about the picture, and two people can
-- reasonably disagree about whether "England" is a figure or a photo.
--
-- One column and no suggested_word_class beside it, unlike representation.
-- The model is far more certain about word class than about representation,
-- and confirming 283 of them by hand would cost more than it is worth. The
-- teacher corrects it in the panel when it is wrong, and re-suggesting a
-- lesson overwrites it.
--
-- Terms of more than one word:
--   a verb with its particle is verb        (putting on, taking from)
--   a prepositional locution is preposition (in front of)
--   phrase is only for what has no single function (what is (what's))
--
-- Creating the type and using it in the same migration is fine. The rule that
-- caught 0010 was about ALTER TYPE ... ADD VALUE, whose new value cannot be
-- used in the transaction that adds it; CREATE TYPE has no such restriction.
create type word_class as enum (
  'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition',
  'determiner', 'conjunction', 'numeral', 'question_word',
  'interjection', 'phrase'
);

alter table vocabulary_items add column word_class word_class;
