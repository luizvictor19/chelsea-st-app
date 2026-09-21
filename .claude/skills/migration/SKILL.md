---
name: migration
description: The ritual for a database migration in this repository, from measuring the live database to the report. Use it every time you are about to write a migration here, however small.
---

# Writing a migration

The ritual that repeated across migrations 0018 to 0021. Every step is here
because skipping it once cost something. Follow them in order.

## Steps

1. **Measure before writing.** When the migration touches existing rows, query
   the database through the Supabase MCP server, which is read-only, before
   writing a line of SQL. Report the number measured, never the number
   expected.
2. **Write it, never apply it.** Use the migration number given in the prompt;
   if none was given, ask. Name the file for what the change means, not for
   the mechanics (`0021_reclassifying_is_not_rejecting.sql`, not
   `0021_update_function.sql`). Luiz applies with `supabase db push`.
3. **RLS in the same migration.** Every new table is created with row level
   security enabled and its policies, in the migration that creates it.
4. **Register it in `scripts/verify-rls.sql`.** Add the `\i` line in number
   order. `scripts/migrations.test.ts` fails the gate if it is missing.
5. **Assert changed behaviour.** For a change to a function, constraint or
   trigger, add a `do $$ ... $$` block to `scripts/verify-rls.sql` with one
   `raise notice` per invariant. Then prove the assertion can fail: undo the
   change temporarily, run the script and watch it fail, restore the change.
   An assertion never seen failing proves nothing.
6. **Regenerate and run the gate.** `./scripts/gen-types.sh`, then the whole
   gate from the Verifying section of `AGENTS.md`.
7. **Review once.** Run code-review a single time over the whole delivery.
8. **Report**, in Portuguese:
   - the whole SQL of the migration;
   - the numbers measured in step 1;
   - the review findings, with what was fixed and what was not, and why;
   - the reminder that `types.ts` now describes a database that is not applied
     yet, so nothing runs or deploys against it until Luiz applies.

## Known traps

- `alter type ... add value` cannot be used in the same transaction that adds
  the value. One migration only adds it; the next one uses it.
- Repair data only when the affected rows can be identified with certainty. If
  they cannot, say so in the report instead of repairing by approximation.
- Screen copy that describes an effect in the database ships with the
  migration, never before it. A screen that promises what the database does
  not do yet is a false sentence the teacher acts on.
