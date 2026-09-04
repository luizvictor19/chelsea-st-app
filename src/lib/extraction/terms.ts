import { TERM_COLUMN_GAP } from "./constants.ts";
import type { OcrWord } from "./types.ts";

/**
 * Splits a panel's words into the terms it teaches.
 *
 * The panel lays its terms out in columns. Read as a line of text they run
 * together, and "a day" then looks exactly like "flower plant": two words with
 * a space between them, one a single term and the other two. Nothing about the
 * words says which, and the geometry says it plainly, so the split happens here
 * where the positions still exist rather than later where they do not.
 *
 * @param words as the engine returned them, in the crop's own coordinates
 * @param scale how much the crop was enlarged before reading
 */
export function termsFrom(
  words: readonly OcrWord[],
  scale = 1,
): readonly string[] {
  const ordered = [...words]
    .map((word) => ({
      text: word.text.trim(),
      start: word.x / scale,
      end: (word.x + word.width) / scale,
    }))
    .filter((word) => word.text.length > 0)
    .sort((a, b) => a.start - b.start);

  const terms: string[] = [];
  let current: string[] = [];
  let previousEnd: number | null = null;

  for (const word of ordered) {
    const gap = previousEnd === null ? 0 : word.start - previousEnd;
    if (previousEnd !== null && gap >= TERM_COLUMN_GAP) {
      terms.push(current.join(" "));
      current = [];
    }
    current.push(word.text);
    previousEnd = word.end;
  }
  if (current.length > 0) {
    terms.push(current.join(" "));
  }

  return terms;
}

/** How a panel's terms are written into one text column, and read back out. */
export const TERM_SEPARATOR = ", ";

export function joinTerms(terms: readonly string[]): string {
  return terms.join(TERM_SEPARATOR);
}

/**
 * The terms of a vocabulary block, as the teacher may have edited them.
 *
 * Split on the separator rather than on whitespace, which is the whole point:
 * a term may contain a space and usually does.
 */
export function splitTerms(content: string): readonly string[] {
  return content
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}
