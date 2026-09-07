import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { splitFusedWords } from "./fused-words.ts";
import type { Bitmap, OcrWord } from "./types.ts";

/*
 * Every case here is a real token off the fixtures, with the geometry it was
 * measured with: the ink columns of the word as they sit in the enlarged crop,
 * and the character boxes the engine returned for it. Both are in the crop's
 * own pixels, which is twice the page, hence scale 2 throughout.
 *
 * Nothing is invented. Where the two disagree, they disagree the way the real
 * page does: "one..." carries a character box that straddles the printed space,
 * which is what makes the ink and not the boxes the thing to measure.
 */
const SCALE = 2;

type Case = {
  readonly ink: readonly (readonly [number, number])[];
  readonly symbols: readonly (readonly [string, number, number])[];
};

const MEASURED: Record<string, Case> = {
  lam: {
    ink: [
      [0, 11],
      [32, 63],
      [70, 121],
    ],
    symbols: [
      ["l", 0, 11],
      ["a", 32, 64],
      ["m", 70, 121],
    ],
  },
  he: {
    ink: [
      [0, 32],
      [37, 70],
    ],
    symbols: [
      ["h", 0, 33],
      ["e", 37, 70],
    ],
  },
  itis: {
    ink: [
      [0, 11],
      [15, 38],
      [57, 67],
      [74, 98],
    ],
    symbols: [
      ["i", 0, 11],
      ["t", 15, 38],
      ["i", 57, 67],
      ["s", 74, 98],
    ],
  },
  "you're": {
    ink: [
      [0, 34],
      [36, 70],
      [76, 108],
      [115, 127],
      [133, 154],
      [156, 189],
    ],
    symbols: [
      ["y", 0, 34],
      ["o", 35, 70],
      ["u", 76, 108],
      ["'", 115, 127],
      ["r", 133, 154],
      ["e", 156, 189],
    ],
  },
  "itisn't": {
    ink: [
      [0, 10],
      [15, 37],
      [58, 68],
      [75, 98],
      [104, 136],
      [143, 155],
      [159, 183],
    ],
    symbols: [
      ["i", 0, 11],
      ["t", 15, 37],
      ["i", 58, 68],
      ["s", 74, 98],
      ["n", 104, 136],
      ["'", 143, 155],
      ["t", 159, 183],
    ],
  },
  "2+2=4": {
    ink: [
      [0, 32],
      [54, 89],
      [110, 142],
      [164, 199],
      [218, 254],
    ],
    symbols: [
      ["2", 0, 32],
      ["+", 54, 88],
      ["2", 110, 142],
      ["=", 164, 199],
      ["4", 218, 254],
    ],
  },
  "same...": {
    ink: [
      [0, 25],
      [28, 60],
      [66, 117],
      [123, 156],
      [175, 186],
      [192, 202],
      [208, 219],
    ],
    symbols: [
      ["s", 0, 25],
      ["a", 28, 60],
      ["m", 66, 117],
      ["e", 123, 156],
      [".", 175, 186],
      [".", 192, 202],
      [".", 208, 219],
    ],
  },
  "one...": {
    ink: [
      [0, 35],
      [40, 73],
      [77, 110],
      [130, 139],
      [146, 156],
      [163, 172],
    ],
    symbols: [
      ["o", 0, 35],
      ["n", 40, 73],
      ["e", 77, 110],
      [".", 102, 135],
      [".", 130, 156],
      [".", 163, 172],
    ],
  },
};

const HEIGHT = 40;
const MARGIN = 8;

/** The word as pixels: black where the measurement found ink, white elsewhere. */
function drawn(...names: readonly string[]): {
  image: Bitmap;
  words: readonly OcrWord[];
} {
  const width =
    names.reduce((total, name) => total + lastEnd(MEASURED[name]) + MARGIN, 0) +
    MARGIN;
  const data = new Uint8ClampedArray(width * HEIGHT * 4).fill(255);
  const words: OcrWord[] = [];
  let offset = MARGIN;

  for (const name of names) {
    const one = MEASURED[name];
    for (const [from, to] of one.ink) {
      for (let x = offset + from; x < offset + to; x += 1) {
        for (let y = 0; y < HEIGHT; y += 1) {
          const pixel = (y * width + x) * 4;
          data[pixel] = 0;
          data[pixel + 1] = 0;
          data[pixel + 2] = 0;
        }
      }
    }
    words.push({
      text: name,
      x: offset,
      y: 0,
      width: lastEnd(one),
      height: HEIGHT,
      confidence: 90,
      symbols: one.symbols.map(([text, from, to]) => ({
        text,
        x: offset + from,
        width: to - from,
      })),
    });
    offset += lastEnd(one) + MARGIN;
  }

  return { image: { width, height: HEIGHT, data }, words };
}

function lastEnd(one: Case): number {
  return one.ink[one.ink.length - 1][1];
}

/** What the words say once split, which is what the panel readers go on to join. */
function textsOf(words: readonly OcrWord[]): readonly string[] {
  return words.map((word) => word.text);
}

describe("a token the engine fused across a printed space", () => {
  test("a pronoun welded to its verb comes apart", () => {
    // The grammar table of points 8 and 9 of book 1. The printed space is
    // 9.5px, the same as the one the engine honoured two rows above in
    // "he is", and it fused this one anyway.
    const { image, words } = drawn("itis");
    assert.deepEqual(textsOf(splitFusedWords(image, words, SCALE)), [
      "it",
      "is",
    ]);
  });

  test("a contraction keeps its apostrophe on the right side of the cut", () => {
    const { image, words } = drawn("itisn't");
    assert.deepEqual(textsOf(splitFusedWords(image, words, SCALE)), [
      "it",
      "isn't",
    ]);
  });

  test("the glyph the engine got wrong stays wrong, and only the space is mended", () => {
    // "I am" comes back as "lam": the capital I was read as a lowercase l, and
    // no measurement of blank columns can know that. What this fixes is the
    // space, which the print does have; the letter is the teacher's to correct
    // on the screen, and a substitution list that quietly turned "l" into "I"
    // would be covering a reading error with a guess.
    const { image, words } = drawn("lam");
    assert.deepEqual(textsOf(splitFusedWords(image, words, SCALE)), [
      "l",
      "am",
    ]);
  });

  test("a sum comes back spaced the way the book prints it", () => {
    // Four printed spaces in one token, so the cut is not a single one.
    const { image, words } = drawn("2+2=4");
    assert.deepEqual(textsOf(splitFusedWords(image, words, SCALE)), [
      "2",
      "+",
      "2",
      "=",
      "4",
    ]);
  });

  test("a word welded to the ellipsis after it comes apart", () => {
    // The whole of book 2's family: the book prints "same ...", and the engine
    // returns one token.
    const { image, words } = drawn("same...");
    assert.deepEqual(textsOf(splitFusedWords(image, words, SCALE)), [
      "same",
      "...",
    ]);
  });

  test("a character box straddling the space does not drag a letter across", () => {
    // "one..." on p079. The engine put the first full stop's box at 102-135,
    // overlapping the "e" that ends at 110 and reaching past the printed space
    // that ends at 130. Cutting at the nearest box boundary gives "one. ..",
    // which is a worse answer than not cutting at all. The ink says where the
    // space is, and a character whose own ink ends before that space ends is on
    // the left of it.
    const { image, words } = drawn("one...");
    assert.deepEqual(textsOf(splitFusedWords(image, words, SCALE)), [
      "one",
      "...",
    ]);
  });
});

describe("a token with no printed space inside it", () => {
  test("two letters of one word are left alone", () => {
    // The widest blank inside "he" is 2.5px, and inside "you're" 3.5px. The
    // widest measured anywhere inside a word over both books is 5px.
    const { image, words } = drawn("he", "you're");
    assert.deepEqual(textsOf(splitFusedWords(image, words, SCALE)), [
      "he",
      "you're",
    ]);
  });

  test("the pieces keep boxes the panel readers can still use", () => {
    // Both halves stay inside the original word's box, and the gap between
    // them is the printed space, far under the column gaps that split a term
    // from the next or a cell from the one beside it.
    const { image, words } = drawn("itis");
    const [first, second] = splitFusedWords(image, words, SCALE);
    assert.equal(first.x, words[0].x);
    assert.equal(first.x + first.width, words[0].x + 38);
    assert.equal(second.x, words[0].x + 57);
    assert.equal(second.x + second.width, words[0].x + words[0].width);
    assert.equal(first.y, words[0].y);
    assert.equal(first.height, words[0].height);
  });
});

describe("what the rule refuses to guess at", () => {
  test("a word the engine gave no characters for is left whole", () => {
    // Without character boxes there is no place to cut, and cutting by
    // proportion would be inventing one.
    const { image, words } = drawn("itis");
    const blind = words.map((word) => ({ ...word, symbols: [] }));
    assert.deepEqual(textsOf(splitFusedWords(image, blind, SCALE)), ["itis"]);
  });

  test("characters that do not spell the word are not trusted to cut it", () => {
    const { image, words } = drawn("itis");
    const mismatched = words.map((word) => ({
      ...word,
      symbols: word.symbols.slice(1),
    }));
    assert.deepEqual(textsOf(splitFusedWords(image, mismatched, SCALE)), [
      "itis",
    ]);
  });
});
