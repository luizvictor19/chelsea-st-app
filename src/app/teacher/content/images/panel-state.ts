// Relative, with the extension: this is a value import, and panel-state.test.ts
// runs under node, which resolves neither the @/ alias nor a missing extension.
import { isDrawableKind } from "../../../../lib/images/style.ts";

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

/**
 * What the confirmation says before an attempt is discarded.
 *
 * The number and not "are you sure". The bin is irreversible now — it removes
 * the file from the bucket — and what makes a person stop is knowing what
 * they are about to throw away, which here is a picture that has already been
 * paid for. So the sentence carries the credits the row recorded, and says
 * the file does not come back.
 *
 * A null cost says so. credits_spent is null on a model whose price has never
 * been measured, and on every attempt made before the cost was written down
 * at all; inventing a figure to fill the sentence would be putting a number
 * in front of the teacher that nobody checked, at the exact moment they are
 * deciding with it.
 *
 * An upload is the other way round. It cost nothing, and "custou 0 créditos"
 * would read as nothing to lose, when the bucket holds the only copy the
 * platform has of a picture the teacher finished by hand. So it says that,
 * and how to get it back.
 */
export function discardWarning(attempt: {
  readonly provider: string;
  readonly creditsSpent: number | null;
}): string {
  const gone = "O arquivo não volta.";
  if (attempt.provider === "upload") {
    return `Esta imagem foi enviada por você, e esta é a única cópia dela na plataforma. ${gone} Para tê-la de novo, envie o arquivo de novo.`;
  }
  const kept = "A tentativa continua na lista, com o que ela custou.";
  const credits = attemptCredits(attempt);
  if (credits === null) {
    return `O custo desta imagem não foi registrado. ${gone} ${kept}`;
  }
  return `Esta imagem custou ${credits}. ${gone} ${kept}`;
}

/**
 * What an attempt cost, as the list line says it, or null for nothing to say.
 *
 * Null on an unknown cost, for the reason above, and on an upload: its zero is
 * true and stays in the row, but on the line it would set a provider's charge
 * beside a file no provider was asked for.
 */
export function attemptCredits(attempt: {
  readonly provider: string;
  readonly creditsSpent: number | null;
}): string | null {
  if (attempt.provider === "upload" || attempt.creditsSpent === null) {
    return null;
  }
  return attempt.creditsSpent === 1
    ? "1 crédito"
    : `${attempt.creditsSpent} créditos`;
}

/**
 * Whether pressing a type has to ask first.
 *
 * Only when the kind carries no picture and the word has one approved: moving
 * between kinds that draw takes nothing off anything, and a confirmation that
 * never has something to warn about is one people learn to click through
 * without reading.
 *
 * Which kinds those are is asked of isDrawableKind and not listed here. That
 * predicate, the pending-image index and clear_word_representation are held to
 * naming one set by scripts/drawable-kinds.test.ts; a list written out on this
 * screen would be a fourth copy, outside the one thing that keeps them honest,
 * and the day it drifted the dialog would stop appearing for exactly the kind
 * that had started discarding pictures.
 */
export function asksBeforeReclassifying(
  kind: string,
  imageUrl: string | null,
): boolean {
  return !isDrawableKind(kind) && imageUrl !== null;
}

/**
 * What the confirmation says before a word is moved to a kind that carries no
 * picture, while it has one approved.
 *
 * Two sentences because there are two true things, and the second one is the
 * one that saves work. The picture does come off the word: that is what the
 * teacher is about to do and they should see it said. But it is not thrown
 * away — from 0021 it goes back to being a candidate, with its file, ready to
 * be approved again the day the word is drawn after all. A warning that
 * mentioned only the loss would send a teacher off to generate a replacement
 * for a picture that is still sitting in the list, and one of the twenty
 * pictures on a word today took fifteen attempts to get.
 *
 * Only ever shown when there is an approved image to speak about. A
 * confirmation that has nothing to warn about, every time, is one people learn
 * to click through without reading — which is the same reason the suggestion
 * dialog lets a lesson with no suggestions go straight past.
 */
export function reclassifyWarning(label: string): string {
  return (
    `A imagem sai desta palavra, porque ${label.toLowerCase()} não leva imagem. ` +
    "Ela continua na lista como candidata, com o arquivo, e pode ser aprovada " +
    "de novo se você mudar o tipo outra vez."
  );
}

/**
 * Where an attempt came from, as the list line says it, or null.
 *
 * A generation is named by its model. An upload has no model, so it says it
 * was sent and, when the browser gave one, the name of the file: that name is
 * the only thing tying the row to the picture the teacher finished by hand.
 */
export function attemptOrigin(attempt: {
  readonly provider: string;
  readonly model: string | null;
  readonly sourceFilename: string | null;
}): string | null {
  if (attempt.provider === "upload") {
    return attempt.sourceFilename === null
      ? "enviada"
      : `enviada · ${attempt.sourceFilename}`;
  }
  return attempt.model;
}
