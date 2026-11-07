-- A function runs only for who needs it (#148).
--
-- Measured through the MCP on 2026-11-07: 18 functions of public carry no ACL
-- (proacl null), so PUBLIC executes them, anon included; 15 of them are
-- security definer. For each one, its callers were looked up in pg_policies
-- (public and storage), in the body of every function of public, in the
-- checks, the triggers, the event triggers and the .rpc( calls of src/:
--
--   function                       definer  called by                                   execute stays with
--   belongs_anywhere()             yes      questions_read_published (to authenticated)  authenticated
--   can_invite(uuid, role)         yes      3 policies of organization_invites           authenticated
--   can_write_content(uuid)        yes      delete_question, materialize_points,         authenticated
--                                           reorder_questions (invoker), .rpc in
--                                           scene-actions.ts and suggest-actions.ts
--   is_organization_member(...)    yes      5 policies; can_invite, team_practice        authenticated
--   is_platform_admin()            yes      41 policies of public,                       authenticated
--                                           vocabulary_images_write; 4 functions
--   is_reference_list(text[])      no       checks scenes_composed_from_shape and        authenticated
--                                           image_attempts_composed_from_shape
--   teaches_anywhere()             yes      10 read policies                             authenticated
--   teaches_in(uuid)               yes      24 policies; materialize_lessons (invoker)   authenticated
--   rls_auto_enable()              yes      the event trigger ensure_rls only            nobody
--   9 trigger functions            7 yes    their triggers only                          nobody
--
-- Nobody executes a trigger function: it is not called through the API, and
-- Postgres checks execute on it only when a trigger is created, not when it
-- fires. service_role gets nothing: it bypasses RLS, so no policy runs for it,
-- and the app uses it only for the Auth admin API (docs/context.md).
--
-- anon reads storage.objects (Supabase grants it select) under both policies
-- of the bucket, and vocabulary_images_write, "to public", calls
-- is_platform_admin(). Postgres checks execute when a function is called, not
-- when the query is planned: in a Postgres 17 with execute revoked and the
-- policy left as it was, anon still read the bucket, because the OR of the two
-- policies stopped before the call. That order is the planner's to choose, not
-- a promise. anon never wrote to the bucket, so the policy is now "to
-- authenticated", and anon never reaches is_platform_admin(); it keeps reading
-- the bucket through vocabulary_images_read.
--
-- rls_auto_enable() (Supabase's "enable RLS automatically", behind the event
-- trigger ensure_rls) exists in production and in no migration, so it is
-- revoked only where it exists.
--
-- Last, the default: postgres's default ACL in public is {postgres=X/postgres},
-- which a default per schema cannot narrow (Postgres adds a schema's default
-- to the global one, and the global one gives PUBLIC execute). A function
-- created after this is born with execute for its owner alone, in any schema,
-- and the migration that creates it grants execute to who calls it. Only
-- privileges and one policy change; no row of data does.

revoke execute on function
  public.a_teacher_needs_a_teaching_organization(),
  public.accept_organization_invites_on_confirmation(),
  public.belongs_anywhere(),
  public.can_invite(uuid, public.organization_role),
  public.can_write_content(uuid),
  public.handle_new_user(),
  public.is_organization_member(uuid, public.organization_role[]),
  public.is_platform_admin(),
  public.is_reference_list(text[]),
  public.lesson_stop_in_organization(),
  public.organization_follows_parents(),
  public.organization_invites_fifteen_days(),
  public.question_scene_in_use(),
  public.questions_keep_suggestion(),
  public.scene_in_use_stays(),
  public.teaches_anywhere(),
  public.teaches_in(uuid)
from public;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public;
  end if;
end;
$$;

grant execute on function
  public.belongs_anywhere(),
  public.can_invite(uuid, public.organization_role),
  public.can_write_content(uuid),
  public.is_organization_member(uuid, public.organization_role[]),
  public.is_platform_admin(),
  public.is_reference_list(text[]),
  public.teaches_anywhere(),
  public.teaches_in(uuid)
to authenticated;

alter policy vocabulary_images_write on storage.objects to authenticated;

alter default privileges for role postgres revoke execute on functions from public;
