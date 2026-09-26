// Relative, with the extension: bulk.test.ts runs under node, which resolves
// neither the @/ alias nor a missing extension.
import type {
  ImageStyle,
  Representation,
  WordClass,
} from "../../../../lib/content/queries.ts";
import { isDrawableKind } from "../../../../lib/images/style.ts";

import { MIN_MEMBERS } from "./contrast-sets.ts";
import { asksBeforeReclassifying } from "./panel-state.ts";

/**
 * The rules of the bulk actions on the images screen: which of the selected
 * words each action writes, which it skips and why. Pure, so the server
 * action, the bar and the tests all read the same answer, and the per-word
 * write stays the one the panel uses.
 */

/** A change the server applies word by word. Actions 1 to 4 of the bar. */
export type BulkChange =
  | { readonly kind: "accept" }
  | { readonly kind: "representation"; readonly value: Representation }
  | { readonly kind: "wordClass"; readonly value: WordClass }
  | { readonly kind: "style"; readonly value: ImageStyle };

/** A word as the server reads it before writing. */
export type BulkRow = {
  readonly representation: Representation | null;
  readonly suggestedRepresentation: Representation | null;
  readonly wordClass: WordClass | null;
  readonly imageStyle: ImageStyle;
};

export type SkipReason = "no-suggestion" | "same";

export type BulkPlan =
  | { readonly write: Exclude<BulkChange, { kind: "accept" }> }
  | { readonly skip: SkipReason };

/**
 * What one word gets. A word that already holds the value is skipped rather
 * than written again: the count then says what changed, and nothing about
 * the word moves either way.
 */
export function planWrite(change: BulkChange, row: BulkRow): BulkPlan {
  switch (change.kind) {
    case "accept": {
      const suggested = row.suggestedRepresentation;
      if (suggested === null) return { skip: "no-suggestion" };
      if (suggested === row.representation) return { skip: "same" };
      return { write: { kind: "representation", value: suggested } };
    }
    case "representation":
      return row.representation === change.value
        ? { skip: "same" }
        : { write: change };
    case "wordClass":
      return row.wordClass === change.value
        ? { skip: "same" }
        : { write: change };
    case "style":
      return row.imageStyle === change.value
        ? { skip: "same" }
        : { write: change };
  }
}

/** What happened to one word, as the server answers it. */
export type WordOutcome =
  | { readonly id: string; readonly outcome: "written" }
  | {
      readonly id: string;
      readonly outcome: "skipped";
      readonly reason: SkipReason;
    }
  | { readonly id: string; readonly outcome: "failed"; readonly error: string };

/** A word as the bar knows it, from the page's last render. */
export type BulkWord = BulkRow & {
  readonly id: string;
  readonly term: string;
  /** The approved picture, or null. */
  readonly imageUrl: string | null;
  readonly imageSubject: string | null;
  readonly inSet: boolean;
};

/**
 * The words a change would take an approved picture off, in the order given,
 * for the one confirmation before it. The same test the panel asks for one
 * word, asksBeforeReclassifying, on the kind each word would get.
 */
export function losingPicture(
  change: BulkChange,
  words: readonly BulkWord[],
): readonly { readonly word: BulkWord; readonly kind: Representation }[] {
  return words.flatMap((word) => {
    const plan = planWrite(change, word);
    if (!("write" in plan) || plan.write.kind !== "representation") return [];
    const kind = plan.write.value;
    return asksBeforeReclassifying(kind, word.imageUrl) ? [{ word, kind }] : [];
  });
}

/**
 * Why the selection cannot become a set, or null when it can. The rules of
 * building one by hand: at least MIN_MEMBERS words, and none already in a
 * set, since a word belongs to one set at most.
 */
export function setBlocker(words: readonly BulkWord[]): string | null {
  const taken = words.filter((word) => word.inSet);
  if (taken.length > 0) {
    const terms = taken.map((word) => word.term).join(", ");
    return taken.length === 1
      ? `${terms} já está em um conjunto.`
      : `${terms} já estão em conjuntos.`;
  }
  if (words.length < MIN_MEMBERS) {
    return "Um conjunto precisa de pelo menos duas palavras.";
  }
  return null;
}

export type SubjectPlan = "ask" | "has-one" | "no-picture";

/**
 * Whether to ask the model for a word's instruction. Never over the
 * teacher's text: a word that has one is skipped, and the server's
 * compare-and-set refuses to write over one that arrived meanwhile. A word
 * whose kind is undecided or draws nothing has no instruction to ask for,
 * and the action would refuse it.
 */
export function subjectPlan(word: BulkWord): SubjectPlan {
  if (word.imageSubject !== null) return "has-one";
  if (word.representation === null || !isDrawableKind(word.representation)) {
    return "no-picture";
  }
  return "ask";
}

/** At most this many instructions asked of the model at once. */
export const SUBJECT_CONCURRENCY = 3;

/**
 * Run `task` over `items` with at most `limit` in flight, calling `onDone`
 * as each ends. Results come back in the order of `items`.
 */
export async function inPool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
  onDone: (finished: number) => void = () => {},
): Promise<readonly R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let finished = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T);
      onDone(++finished);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
