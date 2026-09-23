-- An upload is a file the teacher sent, not a generation.
--
-- Some pictures are now made outside the platform (scenes and characters drawn
-- on the Freepik site and finished by hand) and enter as an attempt of the
-- word, to be approved through approve_image_attempt like any other. 0008
-- already named the value for them: provider 'upload'. What it never said is
-- what else an upload is, so nothing held it.
--
-- Measured against the project on 2026-09-23, before this was written:
--
--   select count(*), count(*) filter (where provider = 'upload')
--   from image_attempts;   ->   121 rows, 0 uploads
--
-- So both checks below are added with no backfill and no NOT VALID step: no
-- existing row is an upload, and no existing row has a source_filename.

-- The file's name on the teacher's machine, as it arrived. Its own column
-- because prompt and subject already answer other questions: what was sent to
-- the provider, and what the teacher asked for.
alter table image_attempts add column source_filename text;

comment on column image_attempts.source_filename is
  'The original name of an uploaded file. Null on every generated attempt, and on an upload whose file came without a name.';

alter table image_attempts
  add constraint image_attempts_filename_only_on_upload check (
    source_filename is null or provider = 'upload'
  );

-- What an upload is, as a positive list.
--
-- Its status is generated, approved or rejected, never pending or failed.
-- Either the file went into the bucket and the row is written after it, or
-- nothing is written: there is no provider to wait on, so nothing ever polls
-- an upload, and a pending one would wait forever. A list of what it may be
-- rather than of what it may not, so a status added later is refused for
-- uploads until someone decides otherwise.
--
-- It names no model and no provider task, and it cost nothing. Zero, not
-- null: null on credits_spent means "nobody knows what this cost" (see 0015),
-- and the cost of an upload is known.
--
-- coalesce(credits_spent, -1) = 0, and not "credits_spent = 0". A check passes
-- when its expression is null, and "null = 0" is null, so the plain
-- comparison would accept an upload with no cost at all. The status list has
-- no such hole: status is not null. scripts/verify-rls.sql asserts each case.
alter table image_attempts
  add constraint image_attempts_upload_shape check (
    provider <> 'upload'
    or (
      status in ('generated', 'approved', 'rejected')
      and model is null
      and provider_request_id is null
      and coalesce(credits_spent, -1) = 0
    )
  );

-- RLS: no new table. image_attempts has had it enabled since 0008, with
-- image_attempts_teacher_all covering every operation, and a column grants
-- nothing new.
