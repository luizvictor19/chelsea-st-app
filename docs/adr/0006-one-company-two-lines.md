# 0006 · One company, two lines, three levels of practice

- **Status**: accepted, in part superseded by 0007
- **Date**: 2026-11-12 (decisions made by Luiz on 2026-11-11 and 2026-11-12, #271)

## Context

ADR 0005 described two brands on one platform:

- Chelsea St as Luiz's personal brand: live lessons with him plus Robin,
  sold to people directly.
- GrifoAI selling AI automation to companies, with the employees'
  English as part of the offer.
- A membership born only from an invite, in every organization,
  Chelsea St included (ADR 0004, migrations 0031 and 0032, #109).

Since then:

- **Robin's reviewer mode.** On 2026-11-07 the #71 plan put Robin in a
  reviewer mode for anyone with live lessons: an active `lesson_schedules`
  row, bounded by the last "Parei aqui".
- **Payments.** They were planned on Appmax (#72). A search of the
  providers' documentation on 2026-11-11 found that Appmax's subscriptions
  are in beta and its webhook carries no authentication.
- **The new offer.** On 2026-11-11 Luiz and his partner set a new offer:
  - levels of practice priced by credits;
  - lessons with a teacher booked one at a time;
  - Chelsea St sold under GrifoAI (superseded by ADR 0007, #305).

## Decision

GrifoAI is the company, and it has two lines on the same app and database
(superseded by ADR 0007, #305).

- **The two lines.** GrifoAI is the B2B line, for companies. "Chelsea St by
  GrifoAI" is the B2C line, for people (superseded by ADR 0007, #305).
- **Content.** The teaching material belongs to GrifoAI and serves both
  lines. The legal entity that holds it is still open (superseded by ADR
  0007, #305).

One engine serves three levels of practice:

1. **The trail.** Robin v1: the drill with pre-generated audio, bounded by
   minutes per day. It spends no credit.
2. **Live voice.** A voice question inside the trail, and free
   conversation guided by what the person has seen and gets wrong.
3. **Video.** The live voice engine with an avatar.

Our side keeps the trail, the history and the scenario. The voice, avatar
and payment providers each sit behind an interface of our own.

**Credits.** The plan decides which doors are open, and credits pay for
what goes through them:

- **What spends credit.** Live voice, video and a lesson with a teacher
  spend credits. A question by chat does not.
- **Locked features.** What the plan does not open shows a lock that leads
  to an upgrade.
- **The ledger.** Credits live in a ledger that only takes new entries
  (#273). The app grants and debits credits on the server only.

**Plans and lines:**

- **Chelsea St.**
  - Plans are per person.
  - Signing up is direct, with no invite (#275).
  - Payment goes through Asaas (#72) (superseded by ADR 0007, #305).
- **GrifoAI.**
  - Plans are per seat.
  - The seats' credits form the organization's balance, which its admin
    shares out (#273, #274).
  - A membership is still born only from an invite.
  - The company is billed outside the app, on the invoice of its
    automation contract, until #282 brings that billing into the platform.

**Lessons with a teacher** are booked one at a time and paid with credits
(#276), and there can be more than one teacher.

- The reviewer mode of 2026-11-07 is withdrawn: Robin always leads the
  trail, and the teacher follows it.
- `lesson_schedules` no longer changes how Robin behaves.

**Other languages** come only after English is stable.

**Commercial terms** stay outside this repository, as ADR 0005 says. That
covers prices, credits per plan, trial length and credits, and discounts.

## Consequences

- **What still holds from ADR 0005.** Its mechanism stays as it was: one
  database, `organization_id` with RLS, content common to every
  organization, organizations without a teacher. Only the paragraphs on
  Chelsea St as a personal brand and on invites for Chelsea St stop
  holding.
- **More high-rigor work.** Credits and billing join the high-rigor areas
  of `AGENTS.md`. The ledger, the plans and the billing need migrations
  with RLS and a code review before their PRs.
- **Sign-ups on for Chelsea St.** "Allow new users to sign up" stops being
  off once #275 lands. Direct sign-up must reach Chelsea St only, never a
  company, and `verify-rls.sql` holds that.
- **The daily cap.** It comes from the plan instead of one constant, through
  #250 and #274.
- **Migration 0023 is no longer reserved for payments.** It stays unused,
  like 0024.
- **The `LICENSE` still names Luiz.** It changes when the legal entity
  exists (superseded by ADR 0007, #305).
- **What the earlier records keep.** Nothing in ADR 0004 or 0005 is edited,
  and 0005's status in the index says it is superseded in part.
