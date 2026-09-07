import { TABLE_LINE_TOLERANCE } from "./constants.ts";
import type { OcrWord } from "./types.ts";

/**
 * Reads back the "I" this face prints as a bare vertical stem.
 *
 * The pronoun is drawn with no serif and no crossbar, so the engine returns
 * "|", and "I" is the most common word in a book that teaches conversation.
 * The same character also arrives from the panel's own right-hand rule, which
 * is furniture and not text. Nothing about the character tells them apart, so
 * the context does: a pronoun opens a clause and something follows it; the rule
 * closes the panel and is the last thing on its line.
 *
 * Measured before it was written, with scripts/measure-pipe-in-blocks.ts, over
 * the "|" that actually reach `blocks.content` in both books. There are 18 of
 * them, in 14 blocks:
 *
 *   - 16 have a word after them on the same line: 13 in explanations, 2 in a
 *     dictation, 1 in a vocabulary panel. Every one is a printed "I", from
 *     "| am not speaking French" to "| haven't" and "| have got a pen".
 *   - 2 have nothing after them, both in the panels of nopoint-1.png. The image
 *     was opened and checked: the book prints "do not / don't" and "does not /
 *     doesn't / remain" and there is no character after either. What the engine
 *     read is the shaded box's own right-hand edge.
 *
 * The split is exact on that population, which is why the rule is the context
 * and not the character.
 *
 * The rule is deliberately not applied to a tall panel. There the same "|" also
 * arrives from the printed bracket that groups a conjugation's subjects, and a
 * bracket does have words to its right: on p060 it stands before "you" and on
 * nopoint-1 before "do not speak". Context cannot separate those, and their
 * geometry can, so `table-layout` decides it by height instead.
 *
 * What ends a line is left exactly as it came. It is not corrected, because
 * nothing here knows what it should be, and it is not deleted, because deleting
 * it would make a panel that was read wrong look like one that was read right.
 * Left in place it is a character the book cannot print, so the block reaches
 * the teacher flagged. See impossible-characters.ts.
 */
export function repairPrintedI(words: readonly OcrWord[]): readonly OcrWord[] {
  if (words.length === 0) {
    return words;
  }
  const followed = stemsWithAWordAfter(words);
  if (followed.size === 0) {
    return words;
  }
  return words.map((word, at) =>
    followed.has(at)
      ? // The characters are rewritten with it. `splitFusedWords` refuses a word
        // whose characters do not spell it, and leaving the old "|" behind
        // would turn that check off for this word without saying so.
        {
          ...word,
          text: "I",
          symbols: [{ text: "I", x: word.x, width: word.width }],
        }
      : word,
  );
}

/** A token that is nothing but the stem, which is the only shape in question. */
const BARE_STEM = /^\|$/;
/** What has to follow for the stem to be a letter: something with a word in it. */
const A_WORD = /[\p{L}\p{N}]/u;

/**
 * The positions of the stems that have a word to their right on the same line.
 *
 * Lines are grouped by the middle of each word rather than its top or bottom,
 * for the reason `table-layout` groups them that way: a word box follows the
 * glyphs in it, so two words on one line differ at both edges and agree in the
 * middle. The tolerance is the same fraction of the read's own median word
 * height, so it travels between a panel read enlarged and a page read at its
 * own size.
 */
function stemsWithAWordAfter(words: readonly OcrWord[]): ReadonlySet<number> {
  const tolerance =
    median(words.map((word) => word.height)) * TABLE_LINE_TOLERANCE;
  const middleOf = (word: OcrWord) => word.y + word.height / 2;

  const found = new Set<number>();
  for (const [at, word] of words.entries()) {
    if (!BARE_STEM.test(word.text.trim())) {
      continue;
    }
    const onward = words.some(
      (other) =>
        other !== word &&
        other.x > word.x &&
        Math.abs(middleOf(other) - middleOf(word)) <= tolerance &&
        A_WORD.test(other.text),
    );
    if (onward) {
      found.add(at);
    }
  }
  return found;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[at - 1] + sorted[at]) / 2
    : sorted[at];
}
