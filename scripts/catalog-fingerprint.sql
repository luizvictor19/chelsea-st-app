-- The catalog of public, and the policies of storage, as sortable text (#199).
-- Read-only, one statement, one line per object or privilege: run it on both
-- sides of a migration, or on production and on a restored copy, and diff the
-- output. Production through the Supabase MCP, a local copy with
--
--   psql -X -At -v ON_ERROR_STOP=1 -f scripts/catalog-fingerprint.sql <url>
--
-- No OID and no data: what is compared is what the objects are, by name.
-- Privileges through aclexplode, so the order of items in an ACL never shows
-- as a difference; function execute also through has_function_privilege, which
-- sees what reaches a role through PUBLIC. Newlines inside a definition are
-- written as \n, so every object stays one line.

with
rel as (
  select c.oid, c.relname, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
),
fn as (
  select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
),
lines (line) as (
  select format('relation|%s|kind=%s|rls=%s|force=%s|owner=%s',
                c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
                pg_get_userbyid(c.relowner))
    from rel r join pg_class c on c.oid = r.oid
  union all
  select format('column|%s|%s|%s|notnull=%s|default=%s',
                r.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                coalesce(replace(pg_get_expr(d.adbin, d.adrelid), E'\n', '\n'), '-'))
    from rel r
    join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  union all
  select format('privilege|%s|%s|%s|%s',
                r.relname, '-', case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee)::text end,
                string_agg(x.privilege_type, ',' order by x.privilege_type))
    from rel r
    join pg_class c on c.oid = r.oid
    cross join lateral aclexplode(c.relacl) x
   group by r.relname, x.grantee
  union all
  select format('privilege|%s|%s|%s|%s',
                r.relname, a.attname, case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee)::text end,
                string_agg(x.privilege_type, ',' order by x.privilege_type))
    from rel r
    join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    cross join lateral aclexplode(a.attacl) x
   group by r.relname, a.attname, x.grantee
  union all
  select format('function|%s(%s)|secdef=%s|config=%s|acl=%s|def=%s',
                f.proname, f.args, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '-'),
                coalesce((select string_agg(case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee)::text end
                                            || '=' || x.privilege_type, ','
                                            order by x.grantee::regrole::text, x.privilege_type)
                            from aclexplode(p.proacl) x), 'default'),
                replace(pg_get_functiondef(p.oid), E'\n', '\n'))
    from fn f join pg_proc p on p.oid = f.oid
   where p.prokind in ('f', 'p')
  union all
  select format('execute|%s(%s)|%s|%s', f.proname, f.args, r.role,
                has_function_privilege(r.role, f.oid, 'execute'))
    from fn f
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role)
  union all
  select format('trigger|%s|%s|enabled=%s',
                t.tgrelid::regclass, replace(pg_get_triggerdef(t.oid), E'\n', '\n'), t.tgenabled)
    from pg_trigger t
   where not t.tgisinternal
     and (t.tgrelid in (select oid from rel) or t.tgfoid in (select oid from fn))
  union all
  select format('constraint|%s|%s|%s',
                c.conrelid::regclass, c.conname, replace(pg_get_constraintdef(c.oid), E'\n', '\n'))
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
   where n.nspname = 'public'
  union all
  select format('index|%s|%s', i.indrelid::regclass, replace(pg_get_indexdef(i.indexrelid), E'\n', '\n'))
    from pg_index i
   where i.indrelid in (select oid from rel)
  union all
  select format('policy|%s.%s|%s|cmd=%s|roles=%s|permissive=%s|using=%s|check=%s',
                n.nspname, c.relname, pol.polname, pol.polcmd,
                (select string_agg(g.name, ',' order by g.name)
                   from unnest(pol.polroles) r
                   cross join lateral (select case when r = 0 then 'PUBLIC'
                                                   else pg_get_userbyid(r)::text end as name) g),
                pol.polpermissive,
                coalesce(replace(pg_get_expr(pol.polqual, pol.polrelid), E'\n', '\n'), '-'),
                coalesce(replace(pg_get_expr(pol.polwithcheck, pol.polrelid), E'\n', '\n'), '-'))
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'storage')
  union all
  select format('enum|%s|%s', t.typname,
                (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
                   from pg_enum e where e.enumtypid = t.oid))
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typtype = 'e'
  union all
  select format('view|%s|%s', r.relname, replace(pg_get_viewdef(r.oid), E'\n', '\n'))
    from rel r
   where r.relkind in ('v', 'm')
)
select line from lines order by line collate "C";
