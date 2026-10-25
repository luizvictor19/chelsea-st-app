# 0004 · One database, many schools

- **Status**: accepted
- **Date**: 2026-10-24

## Context

The platform is meant to be sold to other English schools (B2B, through
GrifoAI), with Chelsea St as the first school. The database has no notion
of a school: RLS tells a student from a teacher, and everything belongs to
Chelsea St implicitly. `is_teacher()` answers "any teacher", so a teacher
from a second school would see every row. Measured on 2026-10-24 through the
read-only Supabase MCP: 17 tables, all with RLS, holding 1 profile, 1
student and 1 lesson. Adding the school later, with real schools and
students in production, costs far more than adding it now. Issue #63 is
about to create new tables (migration 0029) and #68 publishes the platform.

## Decision

Every school lives in the same database, separated by a `school_id` column
and by RLS. People and day-to-day operation always belong to one school.
Content is common to every school by default, and a school may customize a
common row or hold content of its own.

- **Schools.** A `schools` table, with Chelsea St seeded as its first row
  in the migration that creates it.
- **Retrofit first.** One migration adds the school to the existing tables
  before 0029 and before #68: the tables, the column, the backfill, the
  rewritten policies and isolation assertions between two schools in
  `scripts/verify-rls.sql`. Tables created from 0029 on are born with
  `school_id`. People and operation tables (`profiles` membership,
  `students`, `lessons`, `lesson_schedules`, `assignments`,
  `assignment_items`, `attempts`, `review_schedule`) get it `not null`.
- **Backfill.** Every existing profile becomes a member of Chelsea St with
  its current role, and every existing student and lesson belongs to
  Chelsea St. Every existing content row becomes common (`school_id` null).
- **Roles.** `school_members (school_id, user_id, role)` replaces the global
  `role` in `profiles`, so one person can belong to two schools. Roles are
  `admin`, `teacher` and `student`; a school admin can do everything a
  teacher can. Above the schools sits the platform admin (Luiz, for
  GrifoAI), kept in its own table that no policy lets the API write.
- **Content.** In content tables (`books`, `lessons_content`, `points`,
  `blocks`, `vocabulary_items`, `image_attempts`, `contrast_sets`,
  `contrast_set_items`, `questions`), `school_id` null is common content and
  a filled `school_id` belongs to that school. To customize, a school copies
  a common row into its own scope, with `based_on_id` pointing to the
  original, and sees its copy instead of the common one. A school may also
  write content from scratch: its own rows, without `based_on_id`. Unique
  indexes such as `vocabulary_items_term_idx` and `books_position_key` hold
  per scope, `school_id` included with `nulls not distinct`. Only the
  platform admin writes common content; a school's admin and teachers write
  that school's content.
- **RLS.** Every policy checks membership through one function,
  `is_school_member(school_id, roles[])`: `stable`, `security definer`, with
  a fixed `search_path`, called as `(select is_school_member(...))` so
  Postgres evaluates it once per query. It replaces `is_teacher()`. Content
  is readable when the row is common and the reader is a member of some
  school, or when the reader is a member of the row's school. People and
  operation children reference their parent through a composite foreign key
  `(school_id, id)`, so a child cannot point to another school's parent. A
  content child points to a parent that is common or of its own school; a
  foreign key cannot say "null or equal", so the retrofit enforces it with a
  trigger.
- **Joining a school.** Membership is born only from an invite by email:
  `school_invites` (school, email, role, invited by, expiry, accepted at).
  An invite expires after 15 days and can be sent again. On the first
  sign-in with that email, the database creates the `school_members` row
  (and the `students` row for a student) and marks the invite accepted.
  A person who already has an account accepts the invite herself, signed in
  (changed by 0032, #103: until then she joined as soon as the invite was
  written, without saying yes). Without an invite, the account stays pending and sees
  nothing. A new school starts with the platform admin creating it and
  inviting its first admin. At Chelsea St, once payments exist (#72), a
  confirmed payment writes the invite.
- **Storage.** The `vocabulary-images` bucket stays public: a word picture
  is not sensitive data. An image of a school's own content goes under
  `{school_id}/`; files already stored keep their paths, because the paths
  are written in the rows.
- **Rehearsal.** The retrofit is rehearsed before `supabase db push` on a
  local Postgres (`supabase start`) loaded with the production backup:
  `verify-rls.sql` and row counts before and after. The same rehearsal
  proves the backup restores (#61).

## Consequences

- One deploy, one schema and one set of migrations serve every school. A
  new school is rows, not infrastructure.
- Isolation rests entirely on RLS. A wrong policy leaks between schools as
  silently as it leaks between students today, so `verify-rls.sql` grows an
  assertion per table with two seeded schools (see ADR 0003).
- Every policy and every security-definer function is rewritten in the
  retrofit. It is the riskiest migration so far, and the reason it is
  rehearsed on a restored backup first.
- #63 stays blocked until the retrofit is applied, not only until this
  record.
- Every school teaches the same content structure (book, lesson, point).
  A school with a different structure, a school that does not want to see
  common content, and opening `/teacher/content` to another school's
  teachers are later decisions, taken when a school asks.
- The school is checked in the database on every query. Moving it into a
  JWT claim is faster and harder to revoke; it waits for a measurement.
- Content written by Luiz is served to every school. `AGENTS.md`,
  "Content and licensing", says so.
