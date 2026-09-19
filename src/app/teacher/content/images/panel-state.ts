/**
 * What the panel does once an action has answered.
 *
 * Kept out of the component because the component needs a browser and this
 * does not: the two rules below are the whole of the "depois" of an action,
 * and they are the part worth holding still with tests.
 */

/** Any answer an action on this screen gives. */
type Answer =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

/** An action whose answer never arrived, dressed as an answer. */
export type Lost = {
  readonly ok: false;
  readonly error: string;
  /** What actually went wrong, for the console. Never shown to the teacher. */
  readonly cause: unknown;
};

/**
 * Said when the call itself did not come back.
 *
 * It does not say the generation failed, because it very probably did not:
 * the server writes the attempt row before it answers, so a response lost on
 * the way leaves a picture that exists and a screen that cannot see it. A
 * message reading "falhou" would be a lie the teacher acts on by paying for
 * the same image twice.
 */
export const LOST_RESPONSE =
  "A resposta do servidor não chegou. O que você pediu pode já ter sido gravado: recarregue a página antes de tentar de novo.";

/**
 * The action's own answer, or a stand-in for a call that never came back.
 *
 * Every caller on this screen goes through here, because a server action call
 * is a fetch and a fetch rejects: a long one can have its response cut after
 * the server has already done the work. Awaited without a catch, that
 * rejection has no owner, the screen never hears that the call ended, and the
 * controls stay disabled with nothing said.
 */
export async function settle<A extends Answer>(
  action: () => Promise<A>,
): Promise<A | Lost> {
  try {
    return await action();
  } catch (cause) {
    return { ok: false, error: LOST_RESPONSE, cause };
  }
}

/**
 * The list an action answered with, and the server's list at that moment.
 *
 * The second half is what makes the first droppable: it is kept by identity,
 * not by value, so a list that came from the server later is recognised as
 * later without anything having to compare or timestamp rows.
 */
export type LastAnswer<T> = {
  readonly list: readonly T[];
  readonly served: readonly T[];
};

/**
 * Which list the panel shows.
 *
 * The server's, always, except in the one gap this exists for: between an
 * action answering and its re-render arriving. In that gap the answer is the
 * only list that is known to have reached the browser, because the call
 * returning is the proof that it did; the re-render travels in the same
 * response but nothing proves it landed.
 *
 * As soon as the server sends any list at all the answer is dropped, without
 * comparing the two. A list from the server is never older than the answer
 * that preceded it, and a rule that tried to decide which of two lists is
 * newer would need an ordering the rows do not carry.
 */
export function attemptsToShow<T>(
  served: readonly T[],
  answered: LastAnswer<T> | null,
): readonly T[] {
  if (answered === null) return served;
  return answered.served === served ? answered.list : served;
}
