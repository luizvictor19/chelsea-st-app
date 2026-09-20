-- Being replaced is not being rejected.
--
-- approve_image_attempt demoted the previous approved attempt to 'rejected'.
-- Wrong twice.
--
-- In meaning: 'rejected' is the teacher having looked and said no. A picture
-- that was merely replaced is still a candidate — the teacher may well want
-- it back — and getting it back should not mean undoing a refusal that never
-- happened. It could not even be done: approve_image_attempt accepts only
-- 'generated' or 'approved', so a demoted attempt was locked out of the one
-- path that would restore it.
--
-- In consistency, which is how it showed up on the screen. Since 2026-09-19
-- the bin removes the file from the bucket and leaves the row, so 'rejected'
-- came to mean "discarded, and the file is gone". A demoted attempt appeared
-- under the same word with its file untouched: two different things wearing
-- one label, which is the exact confusion that day's work went to remove
-- from the failed rows.
--
-- So it demotes to 'generated' with decided_at back to null. Null because
-- decided_at is when the teacher judged the attempt, and being replaced is
-- not a judgement of it. Nothing in the application reads that column;
-- rejectAttempt is the only writer.
--
-- The partial unique index is still satisfied, and for the same reason the
-- order still matters. image_attempts_one_approved_per_item covers only rows
-- where status = 'approved', so demoting to 'generated' takes the old row out
-- of the index before the new one goes in; indexes are not deferrable, so
-- promoting first would still raise a unique violation halfway through.
create or replace function approve_image_attempt(p_attempt uuid)
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

  -- Back to being a candidate, not marked as refused.
  update image_attempts
     set status = 'generated', decided_at = null
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

-- create or replace keeps the privileges 0009 granted, so the revoke from
-- public and the grant to authenticated still stand.

-- THE ONES ALREADY DEMOTED, put back.
--
-- They are identifiable, and not by a criterion invented to suit. The old
-- function demoted and promoted inside one transaction, and now() in Postgres
-- is the transaction's start, so the demoted row's decided_at equals the
-- promoting row's exactly, to the microsecond. Nothing else in the system
-- writes two rows of one word at the same instant: the bin stamps one row at
-- a time from the application's clock, and clear_word_representation demotes
-- without promoting anything, so it leaves no pair to collide with.
--
-- Same word is part of the test and not decoration. Without it, two words
-- decided in the same instant would pair up by accident, and this is a
-- migration — it gets one run at the truth.
--
-- Counted on 2026-09-20 before this was written: exactly one row matches,
-- 7383d6ea-cdc9-4d47-93e4-92923e61f69b, the Kontext attempt for "pen"
-- replaced at 23:49:49.410044 on 19/09. It is named here as what the rule
-- caught that day and not as the rule itself, so that anything demoted
-- between then and this being applied is put back too.
--
-- A second signal agrees and is worth writing down, though it is not used:
-- that row still has its storage_path, where every attempt the teacher
-- actually binned since 19/09 has had the file removed and the column
-- cleared. Two independent readings, one answer.
--
-- From here the question cannot arise again: a demotion leaves decided_at
-- null, so there is no collision to look for and nothing to tell apart.
update image_attempts r
   set status = 'generated',
       decided_at = null
 where r.status = 'rejected'
   and r.decided_at is not null
   and exists (
     select 1
       from image_attempts a
      where a.vocabulary_item_id = r.vocabulary_item_id
        and a.id <> r.id
        and a.decided_at = r.decided_at
   );
