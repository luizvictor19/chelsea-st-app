# 0005 · Two brands, many companies

- **Status**: accepted
- **Date**: 2026-11-05 (Content changed on 2026-11-06, #211)

## Context

ADR 0004 put every school in one database, separated by `school_id` and
RLS, because the platform was meant to be sold to other English schools
through GrifoAI. On 2026-11-05 Luiz changed who the customer is (issue
#192):

- GrifoAI sells AI automation to companies, tailored to each company's
  largest costs and delays. The platform's English training is part of that
  offer: the company's employees practise with Robin, with no teacher, free
  during the implantação of the automation, then for a monthly fee per
  employee. The English system is also the proof of GrifoAI's expertise in
  AI.
- Chelsea St stays as Luiz's personal brand: live lessons with him plus the
  AI, sold to people directly.
- English schools are no longer customers. The sentence of ADR 0004's
  context, "sold to other English schools (B2B, through GrifoAI)", no
  longer holds, and the white-label per school of #143 goes with it.

Measured on 2026-11-05 on `main`: 26 lines with "Chelsea St" in `src/`
outside tests, one host (`app.chelsea-st.com`, #68), and `schools` holding
only `id`, `slug`, `name` and `created_at` (migration 0029).

## Decision

One app and one Supabase project serve both brands. The mechanism of ADR
0004 stays as it is: one database, rows separated by the tenant column and
RLS, membership born only from an invite, content common by default. The
tenant is an organization: Chelsea St is one, and each company GrifoAI
serves is one.

- **Names.** "School" becomes "organization" in the database and in the
  code (`organizations`, `organization_members`, `organization_invites`,
  `organization_id`, `is_organization_member()`), in one migration (#199)
  rehearsed on a restored backup, as the ADR 0004 retrofit was. Old
  migrations are not edited.
- **Brand by host.** The host of the request picks the brand (name,
  mascot, colours, metadata) from an allowlist; an unknown host does not
  fall back to Chelsea St (#194). Each organization stores its own brand
  (#195): Robin for Chelsea St, a griffin for GrifoAI. Auth links and
  invites lead to the organization's own host (#196). The GrifoAI domain
  sits beside `chelsea-st.com` in the same Vercel project (#193).
- **Organizations without a teacher.** An organization can have no
  teacher. There, employees practise only with Robin, with no live lessons
  or schedule, and the organization's admin invites employees and follows
  the team's practice (#198) without reaching the teacher's tools
  (content, lesson, preparation) (#197). In an organization with a teacher
  the admin keeps what ADR 0004 gives it.
- **Content** (changed on 2026-11-06, #211). All content is common, served
  to every organization, and written only by the platform admin: ingestion,
  blocks, points, vocabulary, images, scenes, contrast sets and questions.
  A teacher only teaches: she reads content where a lesson needs it and
  edits none. No organization holds content of its own: `organization_id`
  stays on the content tables, always null, refused by one check per table
  (`<table>_is_common`, migration 0043) (AGENTS.md, "Content and
  licensing").
- **Commercial terms.** Prices, trial lengths and the fee per employee live
  outside this repository, as `docs/context.md` says; code follows them
  only through an issue.

## Consequences

- One deploy, one schema and one set of migrations still serve everything.
  A new company is rows, not infrastructure.
- The rename touches every policy, function and query that names a school.
  It is the riskiest migration since the retrofit and blocks #195, #197 and
  #198 until it is applied. The deployed app and the migration must change
  together, or the app queries names that no longer exist.
- Isolation between companies rests on RLS as isolation between schools
  did: `verify-rls.sql` keeps one assertion per table with two seeded
  organizations (ADR 0003).
- "Admin can do everything a teacher can" (ADR 0004, Roles) now holds only
  in organizations with a teacher.
- #99 (screens for a school's own content) is closed as not planned: by
  the decision of 2026-11-06 (#211) no organization has content of its own,
  and a company that wants some is a new decision that starts by undoing
  migration 0043.
- GrifoAI's offer depends on Robin working without a teacher, so Robin v1
  (#71) is on the critical path of the November milestone.
