# Architecture decision records

One file per decision, numbered in the order they were recorded. A record is
never edited after the fact: a change of mind gets a new record that
supersedes the old one.

Format, kept short on purpose:

- **Status**: proposed, accepted, superseded by NNNN.
- **Date**: when the record was written. Decisions made earlier say so.
- **Context**: what was true when the decision was made.
- **Decision**: one paragraph.
- **Consequences**: what we accept as a result, good and bad.

| Number | Title                                               | Status   |
| ------ | --------------------------------------------------- | -------- |
| 0001   | Next.js on Vercel with Supabase                     | accepted |
| 0002   | Web first, no native app                            | accepted |
| 0003   | RLS policies verified in CI against a real Postgres | accepted |
