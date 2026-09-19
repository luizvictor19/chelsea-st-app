import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compareWords, type OrderedWord } from "./word-order.ts";

function word(over: Partial<OrderedWord> = {}): OrderedWord {
  return { lessonNumber: 1, pointNumber: 1, term: "a", ...over };
}

/** The comparator's job is the whole list, so the tests sort whole lists. */
function ordered(words: readonly OrderedWord[]): string[] {
  return [...words].sort(compareWords).map((w) => w.term);
}

describe("compareWords", () => {
  test("lesson first", () => {
    assert.deepEqual(
      ordered([
        word({ lessonNumber: 3, term: "c" }),
        word({ lessonNumber: 1, term: "a" }),
        word({ lessonNumber: 2, term: "b" }),
      ]),
      ["a", "b", "c"],
    );
  });

  test("then the point the word is introduced at", () => {
    assert.deepEqual(
      ordered([
        word({ pointNumber: 53, term: "later" }),
        word({ pointNumber: 7, term: "earlier" }),
      ]),
      ["earlier", "later"],
    );
  });

  /*
   * Numbers and not strings: point 9 comes before point 10, where a textual
   * sort would put 10 first and quietly scramble every lesson past the ninth
   * point.
   */
  test("points sort as numbers", () => {
    assert.deepEqual(
      ordered([
        word({ pointNumber: 10, term: "ten" }),
        word({ pointNumber: 9, term: "nine" }),
        word({ pointNumber: 100, term: "hundred" }),
      ]),
      ["nine", "ten", "hundred"],
    );
  });

  test("and alphabetically inside one point", () => {
    assert.deepEqual(ordered([word({ term: "pen" }), word({ term: "book" })]), [
      "book",
      "pen",
    ]);
  });

  /*
   * English, because these are English words. Under a Portuguese collation a
   * list would come out in a different order on a different machine, and the
   * batches of the suggestion pass would stop matching the list on screen.
   */
  test("compares in English wherever it runs", () => {
    assert.deepEqual(
      ordered([word({ term: "zebra" }), word({ term: "apple" })]),
      ["apple", "zebra"],
    );
  });

  /*
   * Last, not first. A word the book has not placed yet is not part of its
   * order, and putting it at the front would push everything the teacher
   * recognises down the page.
   */
  test("anything unplaced sorts last", () => {
    assert.deepEqual(
      ordered([
        word({ lessonNumber: null, term: "no-lesson" }),
        word({ lessonNumber: 9, term: "lesson-nine" }),
      ]),
      ["lesson-nine", "no-lesson"],
    );
    assert.deepEqual(
      ordered([
        word({ pointNumber: null, term: "no-point" }),
        word({ pointNumber: 999, term: "point-999" }),
      ]),
      ["point-999", "no-point"],
    );
  });

  /*
   * The property the suggestion pass leans on: sorting the same words twice
   * gives the same order, so offset paging cannot skip one word and send
   * another twice.
   */
  test("is total, so paging over it is stable", () => {
    const words = [
      word({ pointNumber: 2, term: "b" }),
      word({ pointNumber: 1, term: "a" }),
      word({ pointNumber: 2, term: "a" }),
      word({ lessonNumber: 2, pointNumber: 1, term: "a" }),
    ];
    const once = ordered(words);
    assert.deepEqual(ordered([...words].reverse()), once);
    assert.equal(new Set(once).size < once.length, true, "terms repeat here");
    assert.equal(once.length, words.length);
  });
});
