import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { repairPrintedI } from "./printed-i.ts";
import type { OcrWord } from "./types.ts";

function word(
  text: string,
  x: number,
  y = 0,
  { width = text.length * 9, height = 12 } = {},
): OcrWord {
  return { text, x, y, width, height, confidence: 60, symbols: [] };
}

const textOf = (words: readonly OcrWord[]) =>
  words.map((one) => one.text).join(" ");

describe("repairPrintedI", () => {
  test("a pipe with a word after it on the line is the pronoun", () => {
    // The three shapes the pages actually carry: an explanation opening with
    // "I", a contraction, and a sentence about having something.
    for (const rest of [
      ["am", "not", "speaking", "French"],
      ["haven't"],
      ["have", "got", "a", "pen"],
    ]) {
      let x = 0;
      const words = ["|", ...rest].map((text) => {
        const one = word(text, x);
        x += one.width + 6;
        return one;
      });
      assert.equal(textOf(repairPrintedI(words)), ["I", ...rest].join(" "));
    }
  });

  test("a pipe ending the line is not a letter and is left alone", () => {
    // Checked against the image of nopoint-1.png: the book prints "do not /
    // don't" and "does not / doesn't / remain" with nothing after them. What
    // the engine read is the panel's own right-hand edge.
    const words = [word("do not", 0), word("don't", 120), word("|", 400)];
    assert.equal(textOf(repairPrintedI(words)), "do not don't |");
  });

  test("it is not deleted either, so the block is flagged for holding it", () => {
    // Deleting it would make a wrong panel look like a right one. Left in
    // place, the character set flags the block and the teacher sees it.
    const repaired = repairPrintedI([word("remain", 0), word("|", 400)]);
    assert.equal(repaired.length, 2);
    assert.equal(repaired[1].text, "|");
  });

  test("the word after must be on the same line", () => {
    // A pipe closing one line must not be credited with the first word of the
    // next. Two lines a full line-height apart.
    const words = [
      word("don't", 0, 0),
      word("|", 400, 0),
      word("remain", 0, 40),
    ];
    assert.equal(textOf(repairPrintedI(words)), "don't | remain");
  });

  test("a word to the left does not make it a letter", () => {
    const words = [word("what", 0, 0), word("am", 60, 0), word("|", 120, 0)];
    assert.equal(textOf(repairPrintedI(words)), "what am |");
  });

  test("what follows has to be a word", () => {
    // A bracket or a stray mark after it says nothing about the shape being a
    // letter, and both appear beside these on the tall panels.
    const words = [word("|", 0, 0), word("]", 40, 0)];
    assert.equal(textOf(repairPrintedI(words)), "| ]");
  });

  test("only a token that is nothing but the stem", () => {
    // "do|" is a rule fused to the glyph beside it, not a pronoun.
    const words = [word("do|", 0, 0), word("not", 60, 0)];
    assert.equal(textOf(repairPrintedI(words)), "do| not");
  });

  test("ordinary text passes through untouched, same objects", () => {
    const words = [word("on", 0), word("under", 40), word("in", 120)];
    const repaired = repairPrintedI(words);
    assert.deepEqual(repaired, words);
  });

  test("the characters come along, so a later stage still trusts them", () => {
    // `splitFusedWords` refuses a word whose characters do not spell it. A
    // repair that left the old ones behind would quietly disable that check.
    const one: OcrWord = {
      ...word("|", 0),
      symbols: [{ text: "|", x: 0, width: 4 }],
    };
    const repaired = repairPrintedI([one, word("am", 40)]);
    assert.equal(repaired[0].text, "I");
    assert.equal(
      repaired[0].symbols.map((symbol) => symbol.text).join(""),
      "I",
    );
  });

  test("nothing to do with an empty read", () => {
    assert.deepEqual(repairPrintedI([]), []);
  });
});
