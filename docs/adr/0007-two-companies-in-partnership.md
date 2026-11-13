# 0007 · Two companies in partnership

- **Status**: accepted
- **Date**: 2026-11-13 (decisions made by Luiz on 2026-11-12, #305)

## Context

ADR 0006 described one company with two lines:

- GrifoAI was the company. Its B2B line sold to companies, and "Chelsea St
  by GrifoAI" was its B2C line, sold to people.
- The teaching material belonged to GrifoAI and served both lines.
- The legal entity that would hold the material was still open, and the
  `LICENSE` named Luiz until it existed.

On 2026-11-12 Luiz and his partner replaced that design with a partnership
between two companies, each owning part of the product and each receiving
the payment for its own plans.

## Decision

**Two companies.** Chelsea St (Luiz's company) and GrifoAI work in
partnership. There is still one app, one database, one repository and one
deploy: the mechanism of ADR 0004 and 0005 does not change.

**Who owns what.**

- **Chelsea St** owns the teaching content, the methodology and the
  generic tools of the platform: giving a lesson, the agenda, booking,
  "Parei aqui", sign-up, plans, credits and billing.
- **GrifoAI** owns the AI tutor tools: Robin and Grifo as tutors, live
  voice, video, the pronunciation judge and speech recognition.
- **The B2B screens.** What exists only for companies (the HR panel, the
  organization's balance, the company interest form, company billing)
  belongs to GrifoAI. The machinery under it (organizations, invites, RLS,
  brand by domain, the credit ledger) is Chelsea St's generic platform,
  which GrifoAI uses under the partners' agreement.
- **AI that writes content.** The suggestions by Claude while writing
  content, the generation of word images and the OCR extraction are
  content tools and belong to Chelsea St: they produce material, they do
  not teach. "AI tools" in this record means the tutors' tools.
- **The art follows the brand.** Robin's art and the Chelsea St marks belong
  to Chelsea St, the Grifo art to GrifoAI. The tutor engine belongs to
  GrifoAI whatever art it wears.
- **Practice history.** `attempts`, `review_schedule` and the progress
  through the trail are Chelsea St's platform and methodology. Only the
  tutor session (turns, audio, the judge's notes, #248) belongs to GrifoAI.
- **New code.** A module follows the owner of the tool it serves. The map
  by directory lives in `docs/context.md`, not here: this record is not
  edited, and the map changes with every new module.

**Who receives.**

- The Plano Fundador and the Plano Fundador Personalizado are paid into
  Chelsea St's Asaas account.
- Essencial, Fluência and Imersão are paid into GrifoAI's Asaas account.
- Companies pay GrifoAI outside the app, as in ADR 0006, until #282.
- The plan says which account receives it (#306).

**The teacher.** In GrifoAI's plans the teacher is a contractor paid per
lesson given, against an invoice (#307). At first Luiz is a teacher like
any other.

**The Plano Fundador stands apart.**

- It holds lessons with a teacher only. The AI tools show a lock that
  leads to the switch (#274).
- The credit cost of a lesson comes from the plan (#292), so the lesson
  discount holds in the Plano Fundador only.
- The seal is the lifelong right to stay in the Plano Fundador and to come
  back to it at the founder price. Its places are finite and configurable
  (#292, #296).

**Switching from the Plano Fundador to a plan with AI** happens only when
the person chooses it, once the plans with AI are open:

- The switch is immediate: the person picks the plan with AI and pays at
  once, into GrifoAI's account.
- A refused payment changes nothing: the person stays in the Plano
  Fundador already paid, and nothing changes in Chelsea St's account.
- A payment confirmed by the webhook cancels the Plano Fundador
  subscription in Chelsea St's account, with no new charge and no refund
  of the days already paid.
- The credits left from the Plano Fundador move to the new plan, added to
  the credits of the plan just bought. Every lot keeps the company that
  received its payment and keeps the expiry it had.
- A lesson then costs what the new plan says. The seal stays: the person
  can go back to the Plano Fundador whenever she wants.

**The monthly settlement.** A credit paid to one company and spent on a
tool or a lesson of the other goes into a monthly report, per lot. The
money moves by bank transfer, outside the app (#307).

**Three groups, and the brand by domain** (#194):

- **Chelsea St only** (`app.chelsea-st.com`, Robin's art): the Plano
  Fundador and the Personalizado, the seal, the founder coupon and invite,
  the chelsea-st.com landing.
- **GrifoAI only** (GrifoAI's domain, the Grifo art): the B2B (companies,
  the HR panel, the organization's balance, the company form) and the
  GrifoAI landing. Whoever arrives through GrifoAI never sees anything of
  the founder offer.
- **Shared:** the AI tools (GrifoAI's) and the content, methodology and
  generic tools (Chelsea St's), each domain with its own art. The plans
  with AI also show on Chelsea St's domain, with Robin's art, and are paid
  into GrifoAI's account.

**Entry.**

- GrifoAI takes companies only, never a person alone. A company fills the
  interest form (#309); then come a conversation, a contract and a payment
  outside the app; the platform admin creates the organization and invites
  (#205).
- Direct sign-up (#275) exists only on Chelsea St's domain.
- The GrifoAI landing has a section about Chelsea St with a link to the
  sign-up on Chelsea St's domain, carrying `?origem=grifoai`. That origin
  hides the whole founder offer (plan, coupon field, invite) and measures
  where the person came from (#296).

**Personal data.** The company the person contracted with (the one that
receives her plan; GrifoAI for an employee of a company) answers for her
data, and the other company handles it under the partners' agreement.
The privacy terms of the landings, outside this repository, follow that.

**Licences between the companies.** GrifoAI's AI uses Chelsea St's
content, and GrifoAI's B2B uses Chelsea St's platform and content. Those
licences exist and live in the partners' agreement, outside this
repository. This record only says they exist.

**Commercial terms** stay outside this repository, as ADR 0005 and 0006
say: prices, credits per plan, costs, founder places, the pay per lesson
and the shares of the settlement.

If the partners' agreement says otherwise, the agreement holds, and a new
record corrects this one.

## Consequences

- **What still holds from ADR 0006.** The three levels of practice, the
  credits and their ledger, the lock on what the plan does not open, the
  lesson booked one at a time and paid with credits, the withdrawn
  reviewer mode, other languages only after English, and commercial terms
  outside the repository.
- **What ADR 0006 loses.** "GrifoAI is the company" and "Chelsea St by
  GrifoAI" as its B2C line; the teaching material belonging to GrifoAI;
  one Asaas account for Chelsea St's payments; "Chelsea St sold under
  GrifoAI" as the current offer; the `LICENSE` changing when GrifoAI's
  legal entity exists. Each of those paragraphs in 0006 points here.
- **Two Asaas accounts.** Two keys and two webhooks (#306). The account of
  every credit lot comes from the plan of the subscription that granted it.
- **A plan has an owner.** The brand of the domain does not decide who
  receives: a plan with AI shown on Chelsea St's domain is paid into
  GrifoAI's account.
- **A settlement between the companies.** A monthly report and a payment
  per lesson to the teacher (#307).
- **The `LICENSE` does not change now.** It reserves every right to Luiz,
  who is a partner in both companies and wrote the code, until the
  partners' agreement assigns the code and the material to Chelsea St and
  to GrifoAI. `package.json` stays `UNLICENSED`.
- **The code boundary is clean today.** On 2026-11-13 the AI tutor tools
  were about 8% of the lines in `src/` and `scripts/`, and nothing outside
  them imported `lib/stt`, `lib/judge` or `lib/audio`. The first module to
  cross it (Robin's session reading the content, #248) goes through an
  interface of the content, named in its issue.
- **One infrastructure.** The repository, Vercel, Supabase and the AI keys
  are one set, in Luiz's accounts. Who pays for what belongs to the
  agreement.
