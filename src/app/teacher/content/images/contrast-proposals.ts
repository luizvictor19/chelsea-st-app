/**
 * The contrast set proposals on screen, kept out of the component so the
 * rules are tested without a browser.
 *
 * A card is a proposal and nothing else until the teacher accepts it. It
 * lives in this browser only: a reload drops every card, which costs one more
 * request and loses nothing, since nothing was written.
 */

// Relative, with the extension, for the same reason as in panel-state.ts:
// node:test runs this, and node resolves neither the alias nor a bare path.
import { settle, type Lost } from "./panel-state.ts";

type Answer =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * Asks, and asks once more if the answer was lost on the way.
 *
 * Only a lost answer is repeated, and only once. A suggestion writes
 * nothing, so asking again cannot do anything twice; but a refusal (an
 * unreadable answer, a failed read) is an answer, and repeating it would pay
 * the model again for the same refusal.
 */
export async function askTwiceIfLost<A extends Answer>(
  ask: () => Promise<A>,
): Promise<{
  readonly answer: A | Lost;
  readonly attempts: 1 | 2;
}> {
  const first = await settle(ask);
  if (first.ok || !("cause" in first)) return { answer: first, attempts: 1 };
  return { answer: await settle(ask), attempts: 2 };
}

export type Member = {
  readonly id: string;
  readonly term: string;
  readonly point: number | null;
};

export type Card = {
  /** For React, and for knowing which card an answer belongs to. */
  readonly key: string;
  readonly members: readonly Member[];
  readonly reason: string;
};

let next = 0;

export function cardsFrom(
  proposals: readonly {
    readonly members: readonly Member[];
    readonly reason: string;
  }[],
): readonly Card[] {
  return proposals.map((proposal) => ({
    key: `proposta-${(next += 1)}`,
    members: proposal.members,
    reason: proposal.reason,
  }));
}

export function removeMember(card: Card, id: string): Card {
  return {
    ...card,
    members: card.members.filter((member) => member.id !== id),
  };
}

export function addMember(card: Card, member: Member): Card {
  if (card.members.some((m) => m.id === member.id)) return card;
  return { ...card, members: [...card.members, member] };
}

type Proposal = {
  readonly members: readonly Member[];
  readonly reason: string;
};

const sameMembers = (members: readonly Member[]) =>
  members
    .map((member) => member.id)
    .sort()
    .join(",");

/**
 * The proposals that are not already a card on screen.
 *
 * A card not yet decided writes nothing, so its words go to the model again
 * on the next click, and the model can propose the same set again. Two equal
 * cards would then sit side by side, and accepting the second would fail on
 * words the first had just saved.
 *
 * Equal means the same members, whatever the order, compared with each card
 * as it is now, after any edit. A proposal that only overlaps a card is kept:
 * ceiling and floor on screen and ceiling, floor and wall proposed are two
 * different answers, and choosing between them is the teacher's.
 */
export function withoutCardsOnScreen(
  onScreen: readonly Card[],
  proposals: readonly Proposal[],
): { readonly fresh: readonly Proposal[]; readonly repeated: number } {
  const shown = new Set(onScreen.map((card) => sameMembers(card.members)));
  const fresh = proposals.filter(
    (proposal) => !shown.has(sameMembers(proposal.members)),
  );
  return { fresh, repeated: proposals.length - fresh.length };
}
