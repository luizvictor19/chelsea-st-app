-- Contrast is between pictures, not inside one.
--
-- A contrast adjective does not resolve inside a single image. large, small,
-- long and short were tried with four mechanisms (a grey size reference, two
-- objects in the scene, a circle marking the object, the human body as a
-- ruler) and none held: the model draws the pair, but cannot say which of the
-- two is which. So the contrast moves out of the image. Words are linked into
-- a contrast set, each keeps its own picture of a single subject, and the
-- presentation shows the set side by side.
--
-- A set is ordered and has two or more members. Not only pairs: the book has
-- trios (in, on, under; city, town, village) and a set of colours. A word is
-- in at most one set. Sets are declared by the teacher and never suggested by
-- the model. They know nothing about the medium: a member may be a photo, a
-- figure or a symbol, and nothing here reads representation.
--
-- NO RULE ABOUT POINTS OR LESSONS, AND THE NUMBERS THAT SAY WHY.
--
-- Measured against the project on 2026-09-21, before this was written. The
-- five known sets, as first named, each fall inside one point of book 1:
--
--   large, small, long, short     ->  point 3, lesson 1
--   city, town, village           ->  point 4, lesson 1
--   in, on, under                 ->  point 5, lesson 1
--   black, white, green, brown    ->  point 6, lesson 1
--
-- But the book carries two of them further. The colours go on at point 16
-- (red, blue, yellow, grey; lesson 3) and the prepositions at point 9
-- (behind; lesson 2) and point 20 (between; lesson 4). Sets are whole
-- families, so the colours are one set of eight across lessons 1 and 3, and
-- the prepositions one of five across lessons 1, 2 and 4. A rule of "same
-- point" or "same lesson" would forbid exactly those, so there is none.
--
-- Showing only the members already introduced at the point being presented
-- is the presentation's job, and waits for presented_from_point_id (0024).
--
-- No existing row is touched: the tables are new and start empty. Which words
-- form which set is data the teacher enters, not something this migration
-- guesses at.
--
-- TWO OR MORE, HELD BY THE DATABASE AND NOT BY THE CALLER.
--
-- A check constraint sees one row and cannot count the others, so the size of
-- a set is held by a deferred constraint trigger, checked at commit over the
-- final state. It holds on every path that writes: the API, the functions
-- below, and the SQL Editor, which runs as the table owner and passes over
-- row level security and grants. Only disabling or dropping the trigger on
-- purpose gets past it.
--
-- The same trigger holds the positions dense, 0 to n - 1. With the unique on
-- (set_id, position) and n rows, a minimum of 0 and a maximum of n - 1 leave
-- no other possibility, so two comparisons make "coherent" a fact rather than
-- a habit of the code that writes.
--
-- save_contrast_set exists because the client cannot hold a transaction
-- across calls: replacing a set's members and renumbering them is only atomic
-- inside a function. It is security invoker, like the write paths since 0009,
-- so the policies below stay the thing that decides who may write.
--
-- A set never falls to one member on its own. Saving fewer than two is
-- refused, and dissolving is its own explicit call. A set that vanished
-- because a member was taken out of it would be the teacher's work eaten
-- without a word.
--
-- A word in a set cannot be deleted (restrict), for the reason first_point_id
-- is restrict in 0004: removing it from its set first makes the delete a
-- deliberate act rather than a side effect. Deleting a set takes its members
-- with it (cascade), and the trigger lets a set that no longer exists go.

create table contrast_sets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table contrast_set_items (
  -- The primary key is the word: a word is in at most one set, so the row is
  -- the word's membership.
  vocabulary_item_id uuid primary key
    references vocabulary_items on delete restrict,
  set_id uuid not null references contrast_sets on delete cascade,
  position integer not null check (position >= 0),
  -- Deferred so that reordering in place (swapping two positions in one
  -- statement) does not collide halfway through.
  constraint contrast_set_items_position_key unique (set_id, position)
    deferrable initially deferred
);

comment on table contrast_sets is
  'An ordered set of two or more words whose meanings are told apart by showing their pictures side by side. Declared by the teacher.';
comment on column contrast_set_items.position is
  'Order of presentation within the set, dense from 0. Held dense by contrast_set_is_whole at commit.';

/*
 * Holds a contrast set whole at commit: two or more members, positions 0 to
 * n - 1. Runs deferred, over the final state of the transaction, so the
 * intermediate states of a save (delete the members, insert the new ones) are
 * never judged.
 *
 * An update may move a row between sets, so both the old and the new set are
 * checked. A set that no longer exists is skipped: it was deleted, and its
 * members went with it by cascade.
 */
create function contrast_set_is_whole()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_sets uuid[];
  v_set uuid;
  v_count integer;
  v_min integer;
  v_max integer;
begin
  if tg_table_name = 'contrast_sets' then
    v_sets := array[new.id];
  elsif tg_op = 'INSERT' then
    v_sets := array[new.set_id];
  elsif tg_op = 'DELETE' then
    v_sets := array[old.set_id];
  else
    v_sets := array[old.set_id, new.set_id];
  end if;

  foreach v_set in array v_sets loop
    continue when not exists (select 1 from contrast_sets where id = v_set);

    select count(*), min(position), max(position)
      into v_count, v_min, v_max
      from contrast_set_items
     where set_id = v_set;

    if v_count < 2 then
      raise exception
        'contrast set % has % member(s): a contrast set needs at least two',
        v_set, v_count
        using errcode = 'check_violation';
    end if;

    if v_min <> 0 or v_max <> v_count - 1 then
      raise exception
        'contrast set % has positions % to % over % members: they must run 0 to %',
        v_set, v_min, v_max, v_count, v_count - 1
        using errcode = 'check_violation';
    end if;
  end loop;

  return null;
end;
$$;

create constraint trigger contrast_set_items_whole
  after insert or update or delete on contrast_set_items
  deferrable initially deferred
  for each row execute function contrast_set_is_whole();

-- A set inserted with no members at all fires nothing on contrast_set_items,
-- so the set itself is checked too.
create constraint trigger contrast_sets_whole
  after insert on contrast_sets
  deferrable initially deferred
  for each row execute function contrast_set_is_whole();

/*
 * Creates a contrast set, or replaces the members of an existing one, in the
 * order given. Returns the set's id.
 *
 * p_items is the whole membership, in order of presentation; positions are
 * written 0 to n - 1 from it. p_set_id omitted or null creates a new set. The
 * optional arguments come after p_items and defaulted so the generated types
 * mark them optional, rather than required strings the caller has to lie
 * about to create a set.
 *
 * p_expected is the membership, in order, that the caller's screen loaded.
 * Saving replaces the whole set, so a draft made from an old view would
 * silently undo whatever changed since (a word added in another tab, gone
 * without a word). So an existing set is saved only if its members are still
 * exactly p_expected, and otherwise refused with SQLSTATE CS001 and nothing
 * written. A null p_expected on an existing set is refused the same way:
 * there is no saving blind. For a new set it is ignored.
 *
 * The set's row is locked before the comparison. Without the lock two saves
 * made from the same view could both compare equal, and the second would
 * overwrite the first exactly as described above.
 *
 * Refuses, before writing anything, fewer than two members, a repeated or
 * null member, a word it cannot see, and a word that already belongs to
 * another set. The last one is also refused by the primary key; checking here
 * first turns a constraint name into a sentence that names the word.
 */
create function save_contrast_set(
  p_items uuid[],
  p_set_id uuid default null,
  p_expected uuid[] default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_set uuid := p_set_id;
  v_taken text;
begin
  if p_items is null or cardinality(p_items) < 2 then
    raise exception 'a contrast set needs at least two members, got %',
      coalesce(cardinality(p_items), 0);
  end if;

  if array_position(p_items, null) is not null then
    raise exception 'a contrast set member cannot be null';
  end if;

  if (select count(distinct item) from unnest(p_items) as item) <> cardinality(p_items) then
    raise exception 'a word appears twice in the same contrast set';
  end if;

  if (select count(*) from vocabulary_items where id = any(p_items)) <> cardinality(p_items) then
    raise exception 'a contrast set member is not a known vocabulary item';
  end if;

  select string_agg(v.term, ', ' order by v.term) into v_taken
    from contrast_set_items i
    join vocabulary_items v on v.id = i.vocabulary_item_id
   where i.vocabulary_item_id = any(p_items)
     and i.set_id is distinct from v_set;

  if v_taken is not null then
    raise exception 'already in another contrast set: %', v_taken;
  end if;

  if v_set is null then
    insert into contrast_sets default values returning id into v_set;
  else
    perform 1 from contrast_sets where id = v_set for update;
    if not found then
      raise exception 'contrast set % not found', v_set;
    end if;

    if array(
         select vocabulary_item_id from contrast_set_items
          where set_id = v_set order by position
       ) is distinct from p_expected then
      raise exception
        'contrast set % changed since it was loaded: nothing was saved', v_set
        using errcode = 'CS001';
    end if;
  end if;

  delete from contrast_set_items where set_id = v_set;

  insert into contrast_set_items (vocabulary_item_id, set_id, position)
  select m.item, v_set, (m.n - 1)::integer
    from unnest(p_items) with ordinality as m(item, n);

  return v_set;
end;
$$;

/*
 * Dissolves a contrast set. Its members go with it by cascade; the words and
 * their pictures are untouched.
 */
create function dissolve_contrast_set(p_set_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from contrast_sets where id = p_set_id;

  if not found then
    raise exception 'contrast set % not found', p_set_id;
  end if;
end;
$$;

-- Mirrors vocabulary_items exactly, as it stands on the project (measured on
-- 2026-09-22): one policy for the teacher on every operation, nothing for the
-- student. She is not denied, she matches no rows. authenticated holds the
-- table privileges so the policy is what decides; anon holds none.
alter table contrast_sets enable row level security;
alter table contrast_set_items enable row level security;

create policy contrast_sets_teacher_all on contrast_sets
  for all using (is_teacher()) with check (is_teacher());
create policy contrast_set_items_teacher_all on contrast_set_items
  for all using (is_teacher()) with check (is_teacher());

grant select, insert, update, delete on contrast_sets to authenticated;
grant select, insert, update, delete on contrast_set_items to authenticated;

revoke all on contrast_sets from anon;
revoke all on contrast_set_items from anon;

revoke all on function save_contrast_set(uuid[], uuid, uuid[]) from public;
grant execute on function save_contrast_set(uuid[], uuid, uuid[]) to authenticated;
revoke all on function dissolve_contrast_set(uuid) from public;
grant execute on function dissolve_contrast_set(uuid) to authenticated;
revoke all on function contrast_set_is_whole() from public;
