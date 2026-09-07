import { FUSED_WORD_GAP, INK_LEVEL } from "./constants.ts";
import { luma } from "./image.ts";
import type { Bitmap, OcrSymbol, OcrWord } from "./types.ts";

/**
 * Parts the words the engine welded across a printed space.
 *
 * The engine decides a word boundary against the glyphs on either side of the
 * gap rather than against its width, so the same printed space is a boundary
 * after a round letter and not after a narrow stem: "he is" comes back as two
 * words and "it is", printed with half a pixel less, comes back as "itis". The
 * page itself is not ambiguous about it, and this reads the answer back off the
 * page. See FUSED_WORD_GAP for the two populations that set the cut.
 *
 * Deliberately not a list of words to substitute. A list would mend the six
 * shapes we have seen and stay silent on the seventh, and it would mend them by
 * agreeing with a guess rather than with the paper. What is measured here is
 * only the space; a letter the engine read wrong stays wrong, which is why
 * "I am" comes out of this as "l am" and not as "I am".
 *
 * @param image the crop the words were read from, at the size they were read at
 * @param words as the engine returned them, in that crop's coordinates
 * @param scale how much the crop was enlarged, so the gap is judged in page
 *   pixels, which is where it was measured
 */
export function splitFusedWords(
  image: Bitmap,
  words: readonly OcrWord[],
  scale = 1,
): readonly OcrWord[] {
  return words.flatMap((word) => splitOne(image, word, scale));
}

function splitOne(
  image: Bitmap,
  word: OcrWord,
  scale: number,
): readonly OcrWord[] {
  // Without characters there is no place to cut, and cutting a word by
  // proportion would be inventing one. Same for characters that spell
  // something other than the word: then neither can be trusted to place the
  // other, and the word is left as the engine gave it.
  if (
    word.symbols.length < 2 ||
    word.symbols.map((symbol) => symbol.text).join("") !== word.text
  ) {
    return [word];
  }

  const spaces = printedSpaces(image, word, scale);
  if (spaces.length === 0) {
    return [word];
  }

  // The first character that reaches past the space is where the right-hand
  // word starts, so everything before it is the left-hand one.
  //
  // The index of that character and not a count of the ones before it: the two
  // agree only while the characters that end early are a prefix, and the boxes
  // are known to overlap on exactly these words, which is how they could stop
  // being one. And not the nearest character boundary either, which is the same
  // answer whenever the boxes are sound and a worse one when they are not: on
  // p079 of book 2 the engine gave the first full stop of "one..." a box
  // straddling the space, and the nearest boundary there cuts "one. ..".
  const cuts = [
    ...new Set(
      spaces.map((space) =>
        word.symbols.findIndex((symbol) => symbol.x + symbol.width > space.end),
      ),
    ),
  ]
    .filter((cut) => cut > 0 && cut < word.symbols.length)
    .sort((a, b) => a - b);

  if (cuts.length === 0) {
    return [word];
  }

  const pieces: OcrWord[] = [];
  let start = 0;
  for (const cut of [...cuts, word.symbols.length]) {
    pieces.push(wordFrom(word, word.symbols.slice(start, cut)));
    start = cut;
  }
  return pieces;
}

/** The word's own box, narrowed to the characters left in this piece. */
function wordFrom(word: OcrWord, symbols: readonly OcrSymbol[]): OcrWord {
  const left = Math.min(...symbols.map((symbol) => symbol.x));
  const right = Math.max(...symbols.map((symbol) => symbol.x + symbol.width));
  return {
    text: symbols.map((symbol) => symbol.text).join(""),
    x: left,
    y: word.y,
    width: right - left,
    height: word.height,
    confidence: word.confidence,
    symbols,
  };
}

/**
 * The blanks inside a word's box that are wide enough to be a printed space.
 *
 * Columns rather than pixels: a space is blank all the way down, and a letter
 * with a gap in the middle of it, like the two bowls of an "8", is not.
 */
function printedSpaces(
  image: Bitmap,
  word: OcrWord,
  scale: number,
): readonly { readonly end: number }[] {
  const from = Math.max(0, Math.round(word.x));
  const to = Math.min(image.width, Math.round(word.x + word.width));
  const top = Math.max(0, Math.round(word.y));
  const bottom = Math.min(image.height, Math.round(word.y + word.height));

  const inked: boolean[] = [];
  for (let x = from; x < to; x += 1) {
    let ink = false;
    for (let y = top; y < bottom && !ink; y += 1) {
      const pixel = (y * image.width + x) * 4;
      ink =
        luma(image.data[pixel], image.data[pixel + 1], image.data[pixel + 2]) <
        INK_LEVEL;
    }
    inked.push(ink);
  }

  // Only the blanks between the word's own first and last ink: whatever sits
  // beyond them is the margin the box was drawn with, not a space.
  const first = inked.indexOf(true);
  const last = inked.lastIndexOf(true);
  const spaces: { end: number }[] = [];
  let run = 0;
  for (let index = first; index <= last; index += 1) {
    if (!inked[index]) {
      run += 1;
      continue;
    }
    if (run / scale >= FUSED_WORD_GAP) {
      spaces.push({ end: from + index });
    }
    run = 0;
  }
  return spaces;
}
