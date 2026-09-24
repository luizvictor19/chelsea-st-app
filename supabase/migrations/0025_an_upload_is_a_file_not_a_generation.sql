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
--   select provider, count(*),
--          count(*) filter (where completed_at is null),
--          count(*) filter (where error is not null),
--          count(*) filter (where prompt is not null),
--          count(*) filter (where reference_path is not null),
--          count(*) filter (where storage_path is null)
--   from image_attempts group by provider;
--
--   ->  freepik  121 rows: 17 with no completed_at, 5 with an error,
--       121 with a prompt, 31 with a reference, 6 with no storage_path
--
-- No other provider, and no upload. Every rule below that is about uploads
-- reaches no existing row, and the provider list holds for all 121, so the
-- checks are added with no backfill and no NOT VALID step.

-- The file's name on the teacher's machine, as it arrived. Its own column
-- because prompt and subject already answer other questions: what was sent to
-- the provider, and what the teacher asked for.
alter table image_attempts add column source_filename text;

comment on column image_attempts.source_filename is
  'The original name of an uploaded file. Null on every generated attempt, and on an upload whose file came without a name. Never empty.';

-- Every rule about uploads hangs on provider = 'upload', and provider has been
-- free text since 0008. A row spelled 'Upload' would slip past all of them,
-- so the discriminator is closed where it is written.
alter table image_attempts
  add constraint image_attempts_provider_known check (
    provider in ('freepik', 'upload')
  );

alter table image_attempts
  add constraint image_attempts_filename_only_on_upload check (
    source_filename is null or provider = 'upload'
  );

-- A file with no name is null, one way of saying it. An empty or blank string
-- would be a second, and a count of "is null" would miss it.
alter table image_attempts
  add constraint image_attempts_filename_not_blank check (
    btrim(source_filename) <> ''
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
-- It has its file, unless it was discarded: the bin removes the file and then
-- clears storage_path, so 'rejected' is the one status allowed without one.
-- A generated or approved upload with no file would be a candidate with
-- nothing to show and one approve_image_attempt refuses.
--
-- It went to no provider, so everything that records a provider call is null:
-- model, provider_request_id, prompt (what was sent), reference_path (what
-- the model was shown) and error (what the provider answered). A count of
-- prompts or references per attempt never mistakes an upload for a generation.
--
-- completed_at is set. Null there means an attempt still running, and an
-- upload never runs: the action stamps it when the row is written.
--
-- It cost nothing, and says zero, not null. This replaces, for uploads, what
-- 0015 wrote when there were none: that an upload "keeps its null". Null on
-- credits_spent is "nobody knows what this cost", and the cost of an upload is
-- known.
--
-- coalesce(credits_spent, -1) = 0, and not "credits_spent = 0". A check passes
-- when its expression is null, and "null = 0" is null, so the plain
-- comparison would accept an upload with no cost at all. Every other clause
-- tests a not null column or uses is null, and has no such hole.
--
-- scripts/verify-rls.sql asserts each clause, by the name of the constraint
-- that refuses.
alter table image_attempts
  add constraint image_attempts_upload_shape check (
    provider <> 'upload'
    or (
      status in ('generated', 'approved', 'rejected')
      and (status = 'rejected' or storage_path is not null)
      and model is null
      and provider_request_id is null
      and prompt is null
      and reference_path is null
      and error is null
      and completed_at is not null
      and coalesce(credits_spent, -1) = 0
    )
  );

-- RLS: no new table. image_attempts has had it enabled since 0008, with
-- image_attempts_teacher_all covering every operation, and a column grants
-- nothing new.
