import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildDeck,
  clampPosition,
  nextPosition,
  previousPosition,
  slidesAt,
  type DeckWord,
  type Slide,
} from "./deck.ts";

let tick = 0;
/** A word extracted after every word made before it. */
const word = (term: string, pointNumber: number): DeckWord => ({
  id: term,
  term,
  pointNumber,
  createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, tick++)).toISOString(),
  representation: null,
  imageUrl: null,
});

const row = (set_id: string, vocabulary_item_id: string, position: number) => ({
  set_id,
  vocabulary_item_id,
  position,
});

const terms = (slides: readonly Slide[]) =>
  slides.map((slide) => slide.words.map((w) => w.term).join("+"));

// Point 11 of book 1 as extracted, measured on 2026-10-01, and two words of
// the points around it.
const STANDING = word("standing", 11);
const SITTING = word("sitting", 11);
const TAKING = word("taking from", 11);
const PUTTING = word("putting on", 11);
const OPENING = word("opening", 12);
const BEHIND = word("behind", 9);

describe("buildDeck", () => {
  test("keeps the words of a point in the order they were extracted", () => {
    const deck = buildDeck([PUTTING, TAKING, SITTING, STANDING], []);
    assert.deepEqual(terms(deck), [
      "standing",
      "sitting",
      "taking from",
      "putting on",
    ]);
    assert.deepEqual(
      deck.map((slide) => slide.index),
      [0, 1, 2, 3],
    );
  });

  test("orders the points before the words", () => {
    const deck = buildDeck([OPENING, STANDING, BEHIND], []);
    assert.deepEqual(terms(deck), ["behind", "standing", "opening"]);
    assert.deepEqual(
      deck.map((slide) => [slide.pointNumber, slide.index]),
      [
        [9, 0],
        [11, 0],
        [12, 0],
      ],
    );
  });

  test("shows a set once, in the set's order, where its first word stood", () => {
    const deck = buildDeck(
      [STANDING, SITTING, TAKING, PUTTING],
      [
        row("pose", "sitting", 0),
        row("pose", "standing", 1),
        row("hand", "putting on", 0),
        row("hand", "taking from", 1),
      ],
    );
    assert.deepEqual(terms(deck), [
      "sitting+standing",
      "putting on+taking from",
    ]);
  });

  test("presents a set at the point of its latest member only", () => {
    const deck = buildDeck(
      [BEHIND, STANDING, SITTING, OPENING],
      [row("x", "behind", 0), row("x", "sitting", 1)],
    );
    assert.deepEqual(terms(slidesAt(deck, 9)), []);
    assert.deepEqual(terms(slidesAt(deck, 11)), ["standing", "behind+sitting"]);
    assert.deepEqual(terms(slidesAt(deck, 12)), ["opening"]);
  });

  test("a set with one word left is that word alone", () => {
    const deck = buildDeck(
      [STANDING],
      [row("pose", "sitting", 0), row("pose", "standing", 1)],
    );
    assert.deepEqual(terms(deck), ["standing"]);
    assert.equal(deck[0].key, "standing");
  });
});

describe("nextPosition and previousPosition", () => {
  // 9: behind · 11: standing, sitting · 12: opening. Point 10 has nothing.
  const deck = buildDeck([BEHIND, STANDING, SITTING, OPENING], []);

  test("move inside a point", () => {
    assert.deepEqual(nextPosition(deck, { pointNumber: 11, index: 0 }), {
      pointNumber: 11,
      index: 1,
    });
    assert.deepEqual(previousPosition(deck, { pointNumber: 11, index: 1 }), {
      pointNumber: 11,
      index: 0,
    });
  });

  test("cross to the next point from the last slide of one", () => {
    assert.deepEqual(nextPosition(deck, { pointNumber: 11, index: 1 }), {
      pointNumber: 12,
      index: 0,
    });
  });

  test("cross back to the last slide of the point before", () => {
    assert.deepEqual(previousPosition(deck, { pointNumber: 12, index: 0 }), {
      pointNumber: 11,
      index: 1,
    });
  });

  test("skip a point with no slides, both ways", () => {
    assert.deepEqual(nextPosition(deck, { pointNumber: 9, index: 0 }), {
      pointNumber: 11,
      index: 0,
    });
    assert.deepEqual(previousPosition(deck, { pointNumber: 11, index: 0 }), {
      pointNumber: 9,
      index: 0,
    });
  });

  test("leave an empty point for its neighbours", () => {
    assert.deepEqual(nextPosition(deck, { pointNumber: 10, index: 0 }), {
      pointNumber: 11,
      index: 0,
    });
    assert.deepEqual(previousPosition(deck, { pointNumber: 10, index: 0 }), {
      pointNumber: 9,
      index: 0,
    });
  });

  test("stop at both ends", () => {
    assert.equal(nextPosition(deck, { pointNumber: 12, index: 0 }), null);
    assert.equal(previousPosition(deck, { pointNumber: 9, index: 0 }), null);
  });
});

describe("clampPosition", () => {
  const deck = buildDeck([STANDING, SITTING], []);

  test("holds an item past the end to the last slide", () => {
    assert.deepEqual(clampPosition(deck, { pointNumber: 11, index: 7 }), {
      pointNumber: 11,
      index: 1,
    });
  });

  test("keeps an empty point at item 0", () => {
    assert.deepEqual(clampPosition(deck, { pointNumber: 10, index: 3 }), {
      pointNumber: 10,
      index: 0,
    });
  });
});
