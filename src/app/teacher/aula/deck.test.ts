import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildDeck,
  clampPosition,
  levelCount,
  nextPosition,
  previousPosition,
  revealLess,
  revealMore,
  showAt,
  slidesAt,
  withQuestions,
  type DeckQuestion,
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

const question = (
  id: string,
  pointNumber: number,
  position: number,
): DeckQuestion => ({
  id,
  pointNumber,
  position,
  prompt: `${id}?`,
  expectedAnswer: `${id}.`,
  imageUrl: null,
});

describe("withQuestions", () => {
  test("puts the questions of a point after its presentation, by position", () => {
    const deck = withQuestions(buildDeck([STANDING, SITTING, OPENING], []), [
      question("third", 11, 2),
      question("first", 11, 0),
      question("second", 11, 1),
    ]);
    assert.deepEqual(
      deck.map((slide) => [slide.pointNumber, slide.index, slide.key]),
      [
        [11, 0, "standing"],
        [11, 1, "sitting"],
        [11, 2, "first"],
        [11, 3, "second"],
        [11, 4, "third"],
        [12, 0, "opening"],
      ],
    );
    assert.deepEqual(
      slidesAt(deck, 11).map((slide) => slide.question?.number ?? null),
      [null, null, 1, 2, 3],
    );
  });

  test("a point with questions and no words is its questions", () => {
    const deck = withQuestions(buildDeck([BEHIND, STANDING], []), [
      question("only", 10, 0),
    ]);
    assert.deepEqual(
      deck.map((slide) => [slide.pointNumber, slide.index, slide.key]),
      [
        [9, 0, "behind"],
        [10, 0, "only"],
        [11, 0, "standing"],
      ],
    );
  });

  test("the arrows walk from the words into the questions and on", () => {
    const deck = withQuestions(buildDeck([STANDING, OPENING], []), [
      question("first", 11, 0),
    ]);
    assert.deepEqual(nextPosition(deck, { pointNumber: 11, index: 0 }), {
      pointNumber: 11,
      index: 1,
    });
    assert.deepEqual(nextPosition(deck, { pointNumber: 11, index: 1 }), {
      pointNumber: 12,
      index: 0,
    });
    assert.deepEqual(previousPosition(deck, { pointNumber: 12, index: 0 }), {
      pointNumber: 11,
      index: 1,
    });
  });
});

describe("levels", () => {
  const [presented, asked] = withQuestions(buildDeck([STANDING], []), [
    question("first", 11, 0),
  ]);

  test("a presentation has two levels, or one with no picture", () => {
    assert.equal(levelCount(presented, true), 2);
    assert.equal(levelCount(presented, false), 1);
  });

  test("a question has three levels, with or without a picture", () => {
    assert.equal(levelCount(asked, true), 3);
    assert.equal(levelCount(asked, false), 3);
  });

  test("down reveals one level at a time and stops at the last", () => {
    const start = showAt({ pointNumber: 11, index: 1 });
    const second = revealMore(start, 3);
    const third = revealMore(second, 3);
    assert.deepEqual(
      [start.level, second.level, third.level, revealMore(third, 3).level],
      [1, 2, 3, 3],
    );
    assert.deepEqual(third.position, start.position);
  });

  test("up hides one level at a time and stops at the first", () => {
    const third = { position: { pointNumber: 11, index: 1 }, level: 3 };
    const second = revealLess(third);
    const first = revealLess(second);
    assert.deepEqual(
      [second.level, first.level, revealLess(first).level],
      [2, 1, 1],
    );
  });

  test("a slide with one level stays at it", () => {
    const view = showAt({ pointNumber: 11, index: 0 });
    assert.equal(revealMore(view, 1).level, 1);
  });

  test("changing slide comes back to level 1", () => {
    const deck = [presented, asked];
    const revealed = revealMore(showAt({ pointNumber: 11, index: 0 }), 2);
    assert.equal(revealed.level, 2);
    const next = nextPosition(deck, revealed.position);
    assert.ok(next !== null);
    assert.deepEqual(showAt(next), {
      position: { pointNumber: 11, index: 1 },
      level: 1,
    });
  });
});
