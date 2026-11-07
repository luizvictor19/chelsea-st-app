-- A suggested question keeps its draft (issue #229, sub-issue of #67).
--
-- "Sugerir perguntas" (#67) asks a model for draft questions of a point, and
-- the teacher edits a draft before saving it. A question saved from a draft
-- keeps where it came from: the model that wrote it and the prompt and the
-- expected answer as the model wrote them. The question itself holds what the
-- teacher saved, and that is the only text anyone is shown; these three are
-- the record, so how much she edits each suggestion is measured from her real
-- use, for free (Luiz, 2026-11-06, plan of #67).
--
-- A question written by hand has none of the three. Either all three are
-- there or none is (questions_suggestion_whole): a model with no draft, or a
-- draft with no model, is a row nobody can read back. The model is never
-- empty text, so an id that failed to arrive cannot pass for one.
--
-- Measured on 2026-11-07 through the MCP, before this migration: 10 rows in
-- questions, all written by hand; the last migration applied is 0044. The
-- new columns are null on all 10, which is what they are.
--
-- No policy changes. The columns belong to the row, and whoever reads or
-- writes a question already reads or writes them; since 0043 only the
-- platform admin writes content. A student reading a published question can
-- read its draft too: it is the same sentence before an edit, about the
-- book, and nothing about anyone.

alter table questions
  add column suggested_model text,
  add column suggested_prompt text,
  add column suggested_answer text,
  add constraint questions_suggestion_whole check (
    (suggested_model is null and suggested_prompt is null and suggested_answer is null)
    or (suggested_model is not null and suggested_prompt is not null and suggested_answer is not null)
  ),
  add constraint questions_suggested_model_named check (
    suggested_model is null or btrim(suggested_model) <> ''
  );

comment on column questions.suggested_model is
  'The model whose draft this question was saved from (#67), as the app called it, such as claude-haiku-5-5. Null when written by hand.';
comment on column questions.suggested_prompt is
  'The prompt as the model wrote it, before the teacher''s edit. Null when written by hand.';
comment on column questions.suggested_answer is
  'The expected answer as the model wrote it, before the teacher''s edit. Null when written by hand.';
