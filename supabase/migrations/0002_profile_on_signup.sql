-- Creates a profile row for every new auth user.
--
-- This migration was applied directly to the project before the repository
-- tracked it. The definitions below were read back from the live database with
-- pg_get_functiondef and pg_get_triggerdef, so the file matches what is
-- deployed rather than describing it from memory.

-- A magic link sign-in creates the auth user with no profile, and every policy
-- in 0001 reads profiles. Without this, a first-time visitor holds a session
-- that RLS treats as belonging to nobody.
--
-- full_name is not null in profiles, so fall back to the local part of the
-- e-mail when the sign-up carries no metadata. The person can correct it later.
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

-- Role defaults to 'student'. Promoting someone to teacher is a deliberate
-- update, never something a sign-up can decide for itself.
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
