-- The two writes that have an order to respect, moved into the database.
--
-- Both are security invoker, so RLS still decides who may touch which row: the
-- teacher policy on image_attempts and vocabulary_items is the defence, and
-- these functions only make the sequence atomic. A server action doing the
-- same three updates over the wire could be interrupted between them and leave
-- a word pointing at a rejected attempt.

-- Approve one attempt and demote whatever was approved before it.
--
-- The order is not a preference. image_attempts_one_approved_per_item is a
-- partial unique index and indexes are not deferrable, so promoting the new
-- row before demoting the old one raises a unique violation halfway through
-- the transaction.
create function approve_image_attempt(p_attempt uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_word uuid;
  v_path text;
  v_status text;
begin
  select vocabulary_item_id, storage_path, status
    into v_word, v_path, v_status
    from image_attempts
   where id = p_attempt
     for update;

  if not found then
    raise exception 'image attempt % not found', p_attempt;
  end if;

  -- 'approved' is allowed so that approving twice is a no-op rather than an
  -- error: the screen can retry a request it is not sure landed.
  if v_status not in ('generated', 'approved') then
    raise exception 'image attempt % is %, only generated or approved can be approved',
      p_attempt, v_status;
  end if;

  if v_path is null then
    raise exception 'image attempt % has no storage_path to approve', p_attempt;
  end if;

  update image_attempts
     set status = 'rejected', decided_at = now()
   where vocabulary_item_id = v_word
     and status = 'approved'
     and id <> p_attempt;

  update image_attempts
     set status = 'approved', decided_at = now()
   where id = p_attempt;

  update vocabulary_items
     set approved_attempt_id = p_attempt,
         image_path = v_path
   where id = v_word;
end;
$$;

-- Record what kind of representation a word takes. Choosing 'none' is a
-- decision that the word carries no image, so it also undoes an approval:
-- leaving the old picture attached to a word marked as needing none is the
-- kind of leftover nobody goes looking for.
create function clear_word_representation(
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

  if p_kind = 'none' then
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

revoke all on function approve_image_attempt(uuid) from public;
grant execute on function approve_image_attempt(uuid) to authenticated;

revoke all on function clear_word_representation(uuid, representation_kind) from public;
grant execute on function clear_word_representation(uuid, representation_kind) to authenticated;
