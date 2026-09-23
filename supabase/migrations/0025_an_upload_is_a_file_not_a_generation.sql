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

-- An upload names no model and no provider task, and it cost nothing. Zero,
-- not null: null on credits_spent means "nobody knows what this cost" (see
-- 0015), and the cost of an upload is known.
--
-- IS NOT DISTINCT FROM, and not "credits_spent = 0". A check passes when its
-- expression is null, and "null = 0" is null, so the plain comparison would
-- accept an upload with no cost at all. scripts/verify-rls.sql asserts that
-- case.
alter table image_attempts
  add constraint image_attempts_upload_shape check (
    provider <> 'upload'
    or (
      model is null
      and provider_request_id is null
      and credits_spent is not distinct from 0
    )
  );

-- RLS: no new table. image_attempts has had it enabled since 0008, with
-- image_attempts_teacher_all covering every operation, and a column grants
-- nothing new.
