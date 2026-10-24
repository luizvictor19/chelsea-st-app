-- Row counts used to compare production with a restored copy (issue #61).
-- Read-only. Every base table in public is counted, so a table added by a later
-- migration enters the comparison on its own. Run the same file on both sides
-- and diff the output: production through the Supabase MCP, the local copy with
-- psql (Luiz only).

select table_schema || '.' || table_name as "table",
       (xpath('/row/n/text()',
              query_to_xml(format('select count(*) as n from %I.%I', table_schema, table_name),
                           false, true, '')))[1]::text::bigint as "rows"
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
union all
select 'auth.users', count(*) from auth.users
union all
select 'storage.objects', count(*) from storage.objects
order by 1;
