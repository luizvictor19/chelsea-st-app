-- Reclassifying is not rejecting.
--
-- 0016 settled this once already, for the other path: approve_image_attempt
-- used to demote the previous approved attempt to 'rejected', and that was
-- wrong because 'rejected' is the teacher having looked and said no. A picture
-- that was merely replaced is still a candidate, and getting it back should
-- not mean undoing a refusal that never happened.
--
-- The same reasoning reaches further here. Moving a word to a kind that
-- carries no picture is not a judgement of the picture at all: it says the
-- word is not drawn, not that the drawing was bad. The image stays good for
-- the day the teacher changes their mind, and one of the twenty pictures now
-- attached to a word cost fifteen attempts to get.
--
-- It is also wrong in the same second way 0016 describes. Since 2026-09-19 the
-- bin removes the file from the bucket and clears storage_path, so 'rejected'
-- came to mean "discarded, and the file is gone". A reclassified attempt would
-- sit under the same label with its file untouched: two different things
-- wearing one label, which is the exact confusion that day's work removed.
--
-- So it demotes to 'generated' with decided_at back to null. Null because
-- decided_at is when the teacher judged the attempt, and being set aside is
-- not a judgement of it.
--
-- NOTHING TO REPAIR, AND THE NUMBER RATHER THAN THE EXPECTATION.
--
-- Measured against the project on 2026-09-20, before this was written:
--
--   select count(*) from image_attempts a
--     join vocabulary_items v on v.id = a.vocabulary_item_id
--    where a.status = 'rejected'
--      and v.representation is not null
--      and v.representation not in ('photo', 'pose', 'action', 'figure');
--   ->  0
--
-- Zero, and the stronger reading is that no image attempt exists on a word of
-- any non-drawing kind at all: every one of the 94 attempts in the project
-- belongs to a word decided photo, pose or figure. The three rejected rows in
-- the whole database are on photo words and all three have storage_path null,
-- which is the bin's signature — the file removed and the path cleared — and
-- not this function's.
--
-- So there is no backfill here, and none is proposed. Had there been rows, it
-- could not have been written with certainty: the discriminator would have
-- been a rejected attempt whose storage_path survived, because this function
-- leaves the file and the bin deletes it, but the bin clears the path only
-- when the removal from the bucket succeeds. A bin that failed at the storage
-- step is indistinguishable from a reclassification, and nothing in the schema
-- records which code path set a status. A repair by that rule would be a guess
-- dressed as a criterion, and would silently promote a picture the teacher had
-- actually refused back into the list of candidates.
--
-- The partial unique index is untouched and still satisfied:
-- image_attempts_one_approved_per_item covers only rows where status =
-- 'approved', and this takes a row out of that set.
--
-- The list of kinds is unchanged and is deliberately spelled exactly as 0019
-- spells it. scripts/drawable-kinds.test.ts reads the last definition of this
-- function and holds it to naming the same set as the pending-image index and
-- isDrawableKind; this migration becomes that last definition.
--
-- create or replace keeps the privileges 0009 granted, as 0016 relied on for
-- approve_image_attempt: the revoke from public and the grant to authenticated
-- still stand.
--
-- No RLS statement, and not an omission: no table is created here. The updates
-- run under the policies that already cover vocabulary_items and
-- image_attempts, and the function is security invoker, so those policies stay
-- the thing that decides.
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
