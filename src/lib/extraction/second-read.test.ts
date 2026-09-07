import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { mergeReads } from "./second-read.ts";
import type { OcrWord } from "./types.ts";

function word(text: string, x: number, y: number, width = 40): OcrWord {
  return { text, x, y, width, height: 24, confidence: 80, symbols: [] };
}

const textOf = (words: readonly OcrWord[]) =>
  words.map((one) => one.text).join(" ");

describe("mergeReads", () => {
  test("a word the first read missed is added", () => {
    // The p056 case: the automatic segmentation returns no token at all where
    // "he" is printed, and a second mode does.
    const first = [word("you", 0, 0), word("she", 0, 200)];
    const second = [word("you", 0, 0), word("he", 0, 100), word("she", 0, 200)];
    assert.equal(textOf(mergeReads(first, second)), "you she he");
  });

  test("a glyph both reads saw is not added twice", () => {
    // Overlap and not equal text: the two calls may spell the same glyph
    // differently, and the first read's spelling is the one that stands.
    const first = [word("she", 0, 200)];
    const second = [word("sne", 2, 202)];
    assert.equal(textOf(mergeReads(first, second)), "she");
  });

  test("touching boxes side by side are two words, not one", () => {
    const first = [word("he", 0, 0, 40)];
    const second = [word("is", 40, 0, 40)];
    assert.equal(textOf(mergeReads(first, second)), "he is");
  });

  test("a word on another line is added even at the same x", () => {
    const first = [word("we", 0, 0)];
    const second = [word("they", 0, 100)];
    assert.equal(textOf(mergeReads(first, second)), "we they");
  });

  test("blank tokens are not worth adding", () => {
    const first = [word("we", 0, 0)];
    assert.equal(textOf(mergeReads(first, [word("  ", 0, 400)])), "we");
  });

  test("nothing new leaves the first read exactly as it was", () => {
    const first = [word("we", 0, 0)];
    assert.equal(mergeReads(first, [word("we", 0, 0)]), first);
    assert.equal(mergeReads(first, []), first);
  });

  test("an empty first read takes everything the second found", () => {
    const second = [word("he", 0, 0), word("it", 0, 100)];
    assert.equal(textOf(mergeReads([], second)), "he it");
  });
});
