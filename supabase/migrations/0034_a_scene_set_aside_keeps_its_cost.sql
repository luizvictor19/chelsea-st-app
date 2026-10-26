-- A scene set aside keeps its cost (#121). Approved by Luiz on 2026-10-26.
--
-- Excluir a scene is archiving it, not deleting it. image_attempts.scene_id is
-- on delete cascade (0030), so deleting the row would take its attempts with
-- it, and the attempts are the record of what was spent: the sum of
-- credits_spent would read low against the Freepik dashboard, which is what
-- discardAttempt keeps a discarded attempt's row for. An attempt has exactly
-- one owner (image_attempts_one_owner), so the scene cannot be let go of
-- either. The row stays, out of every list; its files stay in the bucket,
-- which its attempts still name.
--
-- Measured against the project on 2026-10-26, before this was written: scenes
-- 1 row; image_attempts of a scene 3 rows, 200 credits; questions with a
-- scene 0. Nothing existing changes value: every scene stays in use.

alter table scenes add column archived_at timestamptz;

comment on column scenes.archived_at is
  'When the teacher excluded this scene (#121); null while in use. Its attempts and their cost stay.';

-- One description per scope, among the scenes in use (0030's rule otherwise
-- unchanged): a scene excluded and created again is a new scene, not the
-- archived one reopened.
drop index scenes_description_key;
create unique index scenes_description_key
  on scenes (school_id, lower(btrim(regexp_replace(description, '\s+', ' ', 'g'))))
  nulls not distinct
  where archived_at is null;

-- A question and an archived scene never meet ------------------------------------------
--
-- Refused as a check, named by the trigger, as school_follows_parents is
-- (0030): the app tells this refusal apart from a failure by its name.
--
-- From both sides, since either write can come second. The question's side
-- reads the scene for share: an archive running at the same moment holds the
-- scene's row, so the question waits for it and then sees it archived; and
-- an archive that comes second waits for the question's share lock, and its
-- own check then sees the question.

-- Security definer, both: the check has to see every question and every
-- scene, whatever the writer's policies let her read or lock.
create function scene_in_use_stays()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.archived_at is not null and old.archived_at is null
     and exists (select 1 from questions where scene_id = new.id) then
    raise exception 'scene % is shown by a question and cannot be archived', new.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

create trigger scenes_in_use_stays before update of archived_at on scenes
  for each row execute function scene_in_use_stays();

create function question_scene_in_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived_at timestamptz;
begin
  if new.scene_id is null
     or (tg_op = 'UPDATE' and new.scene_id is not distinct from old.scene_id) then
    return new;
  end if;
  -- The row by its id alone, so the lock waits on an archive in flight; a
  -- filter on archived_at would skip a row whose committed version is not
  -- archived yet, and take no lock at all.
  select archived_at into v_archived_at from scenes where id = new.scene_id for share;
  if v_archived_at is not null then
    raise exception 'scene % is archived and cannot be shown by a question', new.scene_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

create trigger questions_scene_in_use before insert or update of scene_id on questions
  for each row execute function question_scene_in_use();

-- RLS: no new table. scenes has it enabled since 0030, and a column grants
-- nothing new. The two functions return trigger, so nobody calls them
-- directly.
