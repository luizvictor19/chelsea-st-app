-- A question can show a scene, or be acted out (#62, #63). Approved by Luiz on
-- 2026-10-25, with the answers of #62 (2026-10-25): a scene's image attempts
-- live in image_attempts, a scene's description is unique, and publishing
-- without an image warns for acting out too (the warning is the screen's, #65).
--
-- A scene is an image with a subject of its own ("a big box", "a pen on a
-- book"), reusable across questions. A question shows the picture of one word,
-- or one scene, or is acted out by the teacher in class, at most one of the
-- three; none of them means not decided yet. Creating a scene generates
-- nothing: generating is a separate button (#64).
--
-- Measured against the project on 2026-10-25, before this was written:
-- image_attempts 176 rows, all common, 69 approved; questions 10 rows, all
-- common, 9 published, all 10 showing a word; questions.image_path null in all
-- 10. Nothing existing changes value: this only adds.

-- Scenes -----------------------------------------------------------------------------

create table scenes (
  id uuid primary key default gen_random_uuid(),
  -- Null is common content, as in every content table since 0029.
  school_id uuid references schools (id),
  description text not null
    constraint scenes_description_not_blank check (btrim(description) <> ''),
  image_style image_style not null default 'flat',
  reference_path text
    constraint scenes_reference_path_prefix
    check (reference_path is null or reference_path like 'references/%'),
  approved_attempt_id uuid,
  image_path text
    constraint scenes_image_path_not_reference
    check (image_path is null or image_path not like 'references/%'),
  based_on_id uuid references scenes (id) on delete set null,
  created_at timestamptz not null default now(),
  -- The approved picture and its path come together, as for a word (0008).
  constraint scenes_approved_pair check ((approved_attempt_id is null) = (image_path is null))
);

-- One description per scope: among the common scenes, and among one school's.
-- Case and repeated or outer spaces do not make a new scene. A school may
-- repeat a common description: that is how it customizes one.
create unique index scenes_description_key
  on scenes (school_id, lower(regexp_replace(btrim(description), '\s+', ' ', 'g')))
  nulls not distinct;

alter table scenes enable row level security;

grant select, insert, update, delete on scenes to authenticated;
revoke all on scenes from anon;

-- The same as every content table (0029): the platform admin anywhere, a
-- school's admin or teacher on her school's rows and reading the common ones.
create policy scenes_write on scenes
  for all
  using ((select is_platform_admin())
         or (school_id is not null and is_school_member(school_id, '{admin,teacher}')))
  with check ((select is_platform_admin())
              or (school_id is not null and is_school_member(school_id, '{admin,teacher}')));
create policy scenes_read on scenes
  for select using (
    (select is_platform_admin())
    or (school_id is null and (select teaches_anywhere()))
    or is_school_member(school_id, '{admin,teacher}'));
-- The student's read is below, once questions.scene_id exists.

-- Image attempts belong to a word or to a scene ----------------------------------------

alter table image_attempts
  alter column vocabulary_item_id drop not null,
  add column scene_id uuid references scenes (id) on delete cascade,
  add constraint image_attempts_one_owner
    check (num_nonnulls(vocabulary_item_id, scene_id) = 1);

create index image_attempts_scene_idx on image_attempts (scene_id);

alter table scenes
  add constraint scenes_approved_attempt_id_fkey
  foreign key (approved_attempt_id) references image_attempts (id) on delete set null;

-- Approving a scene's attempt does for the scene what it does for a word: the
-- approved one before goes back to being a candidate, not marked as refused.
create or replace function approve_image_attempt(p_attempt uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_word uuid;
  v_scene uuid;
  v_path text;
  v_status text;
begin
  select vocabulary_item_id, scene_id, storage_path, status
    into v_word, v_scene, v_path, v_status
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
   where (vocabulary_item_id = v_word or scene_id = v_scene)
     and status = 'approved'
     and id <> p_attempt;

  update image_attempts
     set status = 'approved', decided_at = now()
   where id = p_attempt;

  if v_word is not null then
    update vocabulary_items
       set approved_attempt_id = p_attempt,
           image_path = v_path
     where id = v_word;
  else
    update scenes
       set approved_attempt_id = p_attempt,
           image_path = v_path
     where id = v_scene;
  end if;
end;
$$;

-- What a question shows ----------------------------------------------------------------

alter table questions
  add column scene_id uuid references scenes (id) on delete restrict,
  add column is_acted_out boolean not null default false,
  add constraint questions_one_image
    check (num_nonnulls(shown_vocabulary_item_id, scene_id) + is_acted_out::int <= 1);

create index questions_scene_idx on questions (scene_id);

-- A student reads the scene of a question she may read. The subquery runs
-- under her own RLS on questions, so it reaches exactly the questions
-- questions_read_published lets her (published, common or of her school):
-- the scene follows the question, and the rule is written once.
create policy scenes_read_published on scenes
  for select to authenticated using (
    exists (select 1 from questions q where q.scene_id = scenes.id));

-- The school follows the first parent that is there --------------------------------------
--
-- Until now a row took its school from the first parent of the list only. An
-- attempt of a scene has no word, its first parent, so it would never take the
-- scene's school, and an attempt of a school's scene would be refused instead
-- of adopted. Now the first parent present gives the school. For every table
-- before this one the first parent is never null (point_id, first_point_id,
-- vocabulary_item_id), so nothing changes for them.
create or replace function school_follows_parents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_parent uuid;
  v_parent_school uuid;
  v_adopted boolean := false;
  i integer := 0;
begin
  if tg_op = 'UPDATE' and new.school_id is distinct from old.school_id then
    raise exception '%: school_id cannot change once written', tg_table_name
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  while i < tg_nargs loop
    v_parent := (v_row ->> tg_argv[i])::uuid;
    if v_parent is not null then
      execute format('select school_id from %I where id = $1', tg_argv[i + 1])
        into v_parent_school
        using v_parent;

      -- Only on insert, and only from the first parent present. On update the
      -- school is already written, and a common row moved under a school's
      -- parent must be refused below, not adopted.
      if not v_adopted and new.school_id is null and tg_op = 'INSERT' then
        new.school_id := v_parent_school;
      end if;
      v_adopted := true;

      if v_parent_school is not null and v_parent_school is distinct from new.school_id then
        raise exception '%.%: points at a row of another school', tg_table_name, tg_argv[i]
          using errcode = 'check_violation', constraint = tg_name;
      end if;
    end if;
    i := i + 2;
  end loop;

  return new;
end;
$$;

drop trigger image_attempts_school on image_attempts;
create trigger image_attempts_school before insert or update on image_attempts
  for each row execute function school_follows_parents(
    'vocabulary_item_id', 'vocabulary_items', 'scene_id', 'scenes');

drop trigger questions_school on questions;
create trigger questions_school before insert or update on questions
  for each row execute function school_follows_parents(
    'point_id', 'points', 'shown_vocabulary_item_id', 'vocabulary_items',
    'scene_id', 'scenes', 'based_on_id', 'questions');

create trigger scenes_school before insert or update on scenes
  for each row execute function school_follows_parents(
    'approved_attempt_id', 'image_attempts', 'based_on_id', 'scenes');
