-- A symbol shows its character (#370).
--
-- docs/spec-imagens.md has said since 19/09 (#17) that a word decided
-- `symbol` takes no picture because "the screen renders the character". No
-- column ever held that character, and no code produced it: the word keeps
-- only its term (five, twelfth, plus), so the lesson card of a symbol is
-- empty, and the tutor would read the same emptiness (#248). Book 1 was
-- ingested on 07/09, the kind was born on 18/09 (0008), and the words were
-- decided symbol afterwards, over rows already written; nothing went back
-- for the character. The box of point 29 prints "1st 2nd 3rd 4th" under the
-- ordinals, and the stored block kept only the line of words.
--
-- So the character lives on the word, next to the picture it replaces, and
-- the teacher writes it on the images panel as he decides the kind (Luiz,
-- 14/11, Q1 A). A word of another kind holds none; a symbol may hold none
-- yet, which is the waiting state, the same as a drawn word without its
-- picture, and the screens count it as pending.
--
-- MEASURED BEFORE WRITING, in production through the MCP on 14/11:
--
--   select count(*), count(*) filter (where organization_id is null),
--          count(*) filter (where based_on_id is not null), count(distinct term)
--     from vocabulary_items where representation = 'symbol';
--   ->  41, 41, 0, 41
--
-- 41 words, all common, none based on another, no term twice. Their terms
-- are exactly the 41 of the list below, so the fill is by term among the
-- common symbols, and it stops, named, if it does not write 41 rows.
--
-- No RLS statement, and not an omission: no table is created here. The
-- column is covered by the policies of vocabulary_items, and
-- clear_word_representation stays security invoker under them.

alter table vocabulary_items add column symbol_text text;

comment on column vocabulary_items.symbol_text is
  'What the screen shows for a word decided symbol, in place of a picture (5, 12th, +). Null on every other kind; null on a symbol is waiting for the teacher (0064, #370).';

alter table vocabulary_items
  add constraint vocabulary_items_symbol_text_only_symbol
  check (symbol_text is null or representation = 'symbol');

alter table vocabulary_items
  add constraint vocabulary_items_symbol_text_not_blank
  check (symbol_text is null or btrim(symbol_text) <> '');

-- The body of 0021, with one change: a kind other than symbol takes the
-- character off, as a kind that draws nothing takes the picture off. The
-- list of drawing kinds is spelled as 0019 and 0021 spell it, because
-- scripts/drawable-kinds.test.ts reads it from the last definition of this
-- function, which this becomes. create or replace keeps the privileges 0009
-- granted.
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
  -- Only a symbol holds a character (vocabulary_items_symbol_text_only_symbol),
  -- and the check is not deferred: the kind and the character change in one
  -- update, or the kind alone is refused. Coming back to symbol asks for the
  -- character again.
  update vocabulary_items
     set representation = p_kind,
         symbol_text = case when p_kind = 'symbol' then symbol_text end
   where id = p_word;

  if not found then
    raise exception 'vocabulary item % not found', p_word;
  end if;

  if p_kind not in ('photo', 'pose', 'action', 'figure') then
    -- Back to being a candidate, not marked as refused. The file stays in the
    -- bucket, which is what makes approving it again possible at all.
    update image_attempts
       set status = 'generated', decided_at = null
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

-- The 41 of book 1. Thousands with a comma, as British English writes them.
do $$
declare
  v_written integer;
begin
  update vocabulary_items v
     set symbol_text = f.symbol_text
    from (values
      ('one', '1'), ('two', '2'), ('three', '3'), ('four', '4'), ('five', '5'),
      ('six', '6'), ('seven', '7'), ('eight', '8'), ('nine', '9'), ('ten', '10'),
      ('eleven', '11'), ('twelve', '12'), ('thirteen', '13'), ('fourteen', '14'),
      ('fifteen', '15'), ('sixteen', '16'), ('seventeen', '17'),
      ('eighteen', '18'), ('nineteen', '19'), ('twenty', '20'),
      ('thirty', '30'), ('forty', '40'), ('fifty', '50'), ('sixty', '60'),
      ('seventy', '70'), ('eighty', '80'), ('ninety', '90'),
      ('hundred', '100'), ('thousand', '1,000'), ('million', '1,000,000'),
      ('first', '1st'), ('second', '2nd'), ('third', '3rd'), ('fourth', '4th'),
      ('fifth', '5th'), ('sixth', '6th'), ('twelfth', '12th'),
      ('twentieth', '20th'),
      ('plus', '+'), ('equals', '='), ('2 + 2 = 4', '2 + 2 = 4')
    ) as f(term, symbol_text)
   where v.term = f.term
     and v.representation = 'symbol'
     and v.organization_id is null;

  get diagnostics v_written = row_count;

  -- A database with no common symbol at all (the verify script, a fresh
  -- local stack) writes nothing, and that is right. Any other database is
  -- held to the measurement: every common symbol filled, and 41 of them.
  if exists (select 1 from vocabulary_items
              where representation = 'symbol'
                and organization_id is null
                and symbol_text is null)
     or v_written not in (0, 41) then
    raise exception '0064: % common symbols matched the 41 terms; the measurement said 41, all of them', v_written;
  end if;
end;
$$;
