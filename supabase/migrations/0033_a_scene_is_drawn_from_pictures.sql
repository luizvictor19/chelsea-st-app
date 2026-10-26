-- A scene is drawn from approved pictures (#120). Approved by Luiz on
-- 2026-10-26, after the measurement recorded in the plan of #120.
--
-- "the pen on the book" drawn from the approved pen and the approved book,
-- one generation per arm on 2026-10-26: Seedream 4.5 Edit handed the two
-- pictures apart put the pen on the open book, twice out of two, at 50
-- credits. Handed one montage of both, it put the pen beside the book on the
-- montage's white; Flux Kontext Pro handed the montage drew only the pen. So
-- the pictures travel apart, and a scene has to keep more than one.
--
-- composed_from is that list: the pictures whose objects appear in the scene,
-- in the order the teacher chose them. It is not reference_path, which is one
-- picture whose shape the model keeps (Kontext). One question per column, so
-- neither is read as the other, and a scene or an attempt has at most one of
-- the two: with both, what went to the model would be a guess.
--
-- Each is a copy under references/, made when the teacher chooses, and never
-- the word's own image_path: an approved picture can be replaced later, and an
-- attempt has to go on saying what it was drawn from. That is the reason
-- references are never deleted (storeReference), and it holds for these too.
--
-- Measured against the project on 2026-10-26, before this was written: scenes
-- 1 row, 1 with reference_path; image_attempts 182 rows, 34 with
-- reference_path, 1 of a scene. Nothing existing changes value: this only adds.

-- The shape of a list of pictures ----------------------------------------------------
--
-- 1 to 5: the most Seedream 4.5 Edit takes (reference_images, read on
-- docs.magnific.com on 2026-10-25), and the screen asks for 2 to 4. One
-- dimension, no null in it, every path under references/. A check cannot
-- hold a subquery, hence the function; immutable, because it reads only its
-- argument.
create function is_reference_list(p_paths text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select array_ndims(p_paths) = 1
     and cardinality(p_paths) between 1 and 5
     and array_position(p_paths, null) is null
     and not exists (select 1 from unnest(p_paths) as path where path not like 'references/%');
$$;

-- Scenes ------------------------------------------------------------------------------

alter table scenes
  add column composed_from text[]
    constraint scenes_composed_from_shape
    check (composed_from is null or is_reference_list(composed_from)),
  add constraint scenes_one_kind_of_reference
    check (reference_path is null or composed_from is null);

comment on column scenes.composed_from is
  'The approved pictures this scene is generated from, copied under references/, in order (#120). Never together with reference_path.';

-- Attempts ----------------------------------------------------------------------------
--
-- What this attempt was drawn from, as reference_path is (0014): written when
-- it is opened and true about its picture from then on, whatever the scene is
-- set up with later. Only a scene's attempt, and only a generated one: an
-- upload went to no provider (0025), and a word is one thing, not several.
alter table image_attempts
  add column composed_from text[]
    constraint image_attempts_composed_from_shape
    check (composed_from is null or is_reference_list(composed_from)),
  add constraint image_attempts_one_kind_of_reference
    check (reference_path is null or composed_from is null),
  add constraint image_attempts_composed_only_for_a_generated_scene
    check (composed_from is null or (scene_id is not null and provider <> 'upload'));

comment on column image_attempts.composed_from is
  'The pictures this attempt was generated from, as they were when it was opened (#120). Never together with reference_path.';

-- RLS: no new table. scenes (0030) and image_attempts (0008) have it enabled,
-- and a column grants nothing new. is_reference_list reads only its argument.
