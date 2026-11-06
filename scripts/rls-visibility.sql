-- What each account sees through row level security, table by table (#199).
-- Run on a local copy only, never on production: it switches roles to read as
-- each account. Read-only: everything happens inside a transaction that is
-- rolled back. One line per account and table of public, with the number of
-- rows that account selects there. Accounts are numbered in the order of
-- their id and named by that number alone: no email, no name, so the output
-- can be diffed and pasted anywhere. anon is account 0.
--
--   psql -X -q -At -v ON_ERROR_STOP=1 -f scripts/rls-visibility.sql <url>
--
-- auth.uid() is read the way Supabase reads it (request.jwt.claims) and the
-- way scripts/verify-rls.sql stubs it (test.uid): both are set.

begin;

create temp table rls_visibility (account integer, relname text, visible bigint);

do $$
declare
  v_accounts uuid[] := array(select id from auth.users order by id);
  v_tables text[] := array(
    select c.relname::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
     order by c.relname);
  v_account integer;
  v_table text;
  v_count bigint;
  v_counts bigint[];
begin
  for v_account in 0 .. coalesce(cardinality(v_accounts), 0) loop
    v_counts := array[]::bigint[];
    if v_account = 0 then
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      perform set_config('test.uid', '', true);
      set local role anon;
    else
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_accounts[v_account], 'role', 'authenticated')::text, true);
      perform set_config('test.uid', v_accounts[v_account]::text, true);
      set local role authenticated;
    end if;

    foreach v_table in array v_tables loop
      begin
        execute format('select count(*) from public.%I', v_table) into v_count;
      exception when insufficient_privilege then
        v_count := -1;  -- no select privilege at all, as opposed to zero rows
      end;
      v_counts := v_counts || v_count;
    end loop;

    reset role;
    insert into rls_visibility
      select v_account, t.relname, t.visible
        from unnest(v_tables, v_counts) as t(relname, visible);
  end loop;
end;
$$;

select format('account %s|%s|%s', account, relname, visible)
  from rls_visibility
 order by account, relname collate "C";

rollback;
