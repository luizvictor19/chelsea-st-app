import type { OcrWord } from "./types.ts";

/**
 * Two readings of the same crop, joined by where the glyphs are.
 *
 * A conjugation panel is a column of two-letter words in a field of white, and
 * the engine's automatic segmentation sometimes decides there is nothing there.
 * On p056 of book 2 it keeps you, she, you and they and returns no token at all
 * for he, it and we. No filter can recover a word the engine never reported, so
 * the only thing left is to ask it again, differently.
 *
 * The margin reader has worked this way from the start and the trick is
 * measured there: three crops in different segmentation modes, unioned, found
 * all 76 point numbers where no single one did.
 *
 * Position is the whole of the merge. A box that overlaps one the first read
 * already returned is the same glyph read twice, whatever the two calls made of
 * it; a box in a gap is something the first read missed. Comparing the text
 * instead would take the second read's spelling of a word the first read
 * correctly, which is a different and much larger question than this one.
 *
 * The first reading keeps its order and its words. This never replaces one,
 * only adds what was not there.
 */
export function mergeReads(
  first: readonly OcrWord[],
  second: readonly OcrWord[],
): readonly OcrWord[] {
  const missing = second.filter(
    (word) =>
      word.text.trim() !== "" &&
      !first.some((already) => overlaps(word, already)),
  );
  return missing.length === 0 ? first : [...first, ...missing];
}

/** Whether two boxes share any area at all. */
function overlaps(a: OcrWord, b: OcrWord): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}
