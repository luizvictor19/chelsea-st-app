import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TERM_COLUMN_GAP } from "./constants.ts";
import { joinTerms, splitTerms, termsFrom } from "./terms.ts";
import type { OcrWord } from "./types.ts";

function word(text: string, start: number, width = text.length * 9): OcrWord {
  return { text, x: start, y: 0, width, height: 12, confidence: 60 };
}

describe("termsFrom", () => {
  test("a space inside a term does not split it", () => {
    // "a day" is one term. Lexically it is indistinguishable from two, which is
    // why the split is geometric.
    const words = [word("a", 0, 10), word("day", 10 + 9)];
    assert.deepEqual(termsFrom(words), ["a day"]);
  });

  test("a column between terms splits them", () => {
    const first = word("flower", 0);
    const second = word("plant", first.x + first.width + TERM_COLUMN_GAP);
    assert.deepEqual(termsFrom([first, second]), ["flower", "plant"]);
  });

  test("the measured panel comes back as four terms", () => {
    // "dinner a day morning evening", which used to become five words in
    // vocabulary_items, one of them "day".
    let x = 0;
    const build = (text: string, gapBefore: number) => {
      x += gapBefore;
      const w = word(text, x);
      x += w.width;
      return w;
    };
    const words = [
      build("dinner", 0),
      build("a", 80),
      build("day", 10),
      build("morning", 90),
      build("evening", 100),
    ];
    assert.deepEqual(termsFrom(words), [
      "dinner",
      "a day",
      "morning",
      "evening",
    ]);
  });

  test("a gap just under the cut keeps one term, just over splits", () => {
    const under = [word("do", 0, 20), word("not", 20 + TERM_COLUMN_GAP - 1)];
    assert.deepEqual(termsFrom(under), ["do not"]);
    const over = [word("do", 0, 20), word("not", 20 + TERM_COLUMN_GAP)];
    assert.deepEqual(termsFrom(over), ["do", "not"]);
  });

  test("words are read in column order whatever order they arrive in", () => {
    const a = word("first", 0);
    const b = word("second", a.width + TERM_COLUMN_GAP);
    assert.deepEqual(termsFrom([b, a]), ["first", "second"]);
  });

  test("the crop's enlargement is divided back out", () => {
    // The panel is read at double size, so a gap of 45 on the page arrives as
    // 90 and must not be measured as if it were 90 on the page.
    const scale = 2;
    const a = word("do", 0, 20 * scale);
    const b = word("not", (20 + TERM_COLUMN_GAP - 1) * scale);
    assert.deepEqual(termsFrom([a, b], scale), ["do not"]);
  });

  test("empty input yields no terms", () => {
    assert.deepEqual(termsFrom([]), []);
  });
});

describe("joinTerms and splitTerms", () => {
  test("a panel survives being written and read back", () => {
    const terms = ["dinner", "a day", "morning", "evening"];
    assert.equal(joinTerms(terms), "dinner, a day, morning, evening");
    assert.deepEqual(splitTerms(joinTerms(terms)), terms);
  });

  test("a term of one letter is a term", () => {
    // The book teaches "a" and "I". A length filter would forbid them to the
    // sentence generator forever; occupying a column of its own is what makes
    // it a term.
    assert.deepEqual(splitTerms("a, some"), ["a", "some"]);
  });

  test("the teacher's spacing is forgiven", () => {
    assert.deepEqual(splitTerms(" a day ,morning,  evening , "), [
      "a day",
      "morning",
      "evening",
    ]);
  });
});
