// Relative, with the extension: node:test files import this, and node
// resolves neither the @/ alias nor a missing extension.
import { isDrawableKind } from "./style.ts";

/**
 * Where a word stands, as one of four states that partition the vocabulary:
 * every word is in exactly one, so the four counts always add up to the
 * whole and a word can never hide between filters.
 *
 * One place for the rule, read by the images screen (its filters, marks and
 * counts), by the progress of listVocabularyImages and by the lesson card,
 * so the three cannot disagree about what a word has to show.
 */
export type Situation =
  "com-imagem" | "sem-imagem" | "nao-leva" | "sem-decidir";

export function situationOf(
  representation: string | null,
  imageUrl: string | null,
  symbolText: string | null,
): Situation {
  if (representation === null) return "sem-decidir";
  // A symbol shows its character in place of a picture (0063, #370): with
  // it, the word is resolved; without it, it waits as a drawn word without
  // its picture does.
  if (representation === "symbol") {
    return symbolText === null ? "sem-imagem" : "com-imagem";
  }
  // usage, metalanguage and none are decided and will never show anything
  // in place of a picture, which is not the same as waiting for one.
  if (!isDrawableKind(representation)) return "nao-leva";
  return imageUrl === null ? "sem-imagem" : "com-imagem";
}

/** Whether the word still waits for something: a decision, or what it shows. */
export function isWaiting(situation: Situation): boolean {
  return situation === "sem-decidir" || situation === "sem-imagem";
}
