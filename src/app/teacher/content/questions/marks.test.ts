import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Mark } from "../../../../lib/questions/presented.ts";

import { segments, standing, summary } from "./marks.ts";

const at = { book: 1, point: 4 };

function mark(
  text: string,
  word: string,
  presentedAt: Mark["presentedAt"] = null,
  from = 0,
): Mark {
  const start = text.indexOf(word, from);
  return { start, end: start + word.length, word, presentedAt };
}

describe("segments", () => {
  test("a sentence with no mark is one stretch", () => {
    assert.deepEqual(segments("Is this a lamp?", []), [
      { text: "Is this a lamp?", mark: null },
    ]);
  });

  test("the marks cut the sentence and nothing is lost", () => {
    const text = "Is (Oslo) a kettle?";
    const oslo = mark(text, "Oslo");
    const kettle = mark(text, "kettle");
    const parts = segments(text, [oslo, kettle]);
    assert.deepEqual(parts, [
      { text: "Is (", mark: null },
      { text: "Oslo", mark: oslo },
      { text: ") a ", mark: null },
      { text: "kettle", mark: kettle },
      { text: "?", mark: null },
    ]);
    assert.equal(parts.map((part) => part.text).join(""), text);
  });

  test("a mark at either end leaves no empty stretch", () => {
    const text = "Oslo kettle";
    assert.deepEqual(
      segments(text, [mark(text, "Oslo"), mark(text, "kettle")]).map(
        (part) => part.text,
      ),
      ["Oslo", " ", "kettle"],
    );
  });
});

describe("standing", () => {
  test("a word no item carries", () => {
    assert.equal(standing(mark("Oslo", "Oslo"), at), "fora do vocabulário");
  });

  test("a word of a later point of the same book", () => {
    assert.equal(
      standing(mark("garden", "garden", { book: 1, point: 26 }), at),
      "só no ponto 26",
    );
  });

  test("a word of another book names the book", () => {
    assert.equal(
      standing(mark("garden", "garden", { book: 2, point: 60 }), at),
      "só no livro 2, ponto 60",
    );
  });
});

describe("summary", () => {
  test("is empty with no mark", () => {
    assert.equal(summary([], at), "");
  });

  test("names each word once, in the order it first appears", () => {
    const text = "No, (Oslo) isn't a garden; Oslo is a kettle";
    assert.equal(
      summary(
        [
          mark(text, "Oslo"),
          mark(text, "garden", { book: 1, point: 26 }),
          mark(text, "Oslo", null, 10),
          mark(text, "kettle"),
        ],
        at,
      ),
      "Oslo (fora do vocabulário), garden (só no ponto 26), kettle (fora do vocabulário)",
    );
  });

  test("a capital does not make a second word of it", () => {
    const text = "Kettle kettle";
    assert.equal(
      summary([mark(text, "Kettle"), mark(text, "kettle")], at),
      "Kettle (fora do vocabulário)",
    );
  });
});
