import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  approvedPicture,
  shownWordOptions,
  type PicturedWord,
} from "./shown-word.ts";

function word(
  term: string,
  point: number,
  picture: "approved" | "waiting" | "not drawn" | "undecided",
  book = 1,
): PicturedWord {
  return {
    id: `id-${term}`,
    term,
    place: { book, point },
    representation:
      picture === "undecided"
        ? null
        : picture === "not drawn"
          ? "symbol"
          : "photo",
    imageUrl: picture === "approved" ? `https://images/${term}.png` : null,
  };
}

const row = (set_id: string, term: string, position: number) => ({
  set_id,
  vocabulary_item_id: `id-${term}`,
  position,
});

const terms = (options: readonly { readonly term: string }[]) =>
  options.map((option) => option.term);

describe("approvedPicture", () => {
  test("is the picture on a word of a kind that is drawn", () => {
    assert.equal(
      approvedPicture(word("pen", 1, "approved")),
      "https://images/pen.png",
    );
  });

  test("is nothing while the word waits for one, or was not decided", () => {
    assert.equal(approvedPicture(word("pen", 1, "waiting")), null);
    assert.equal(approvedPicture(word("pen", 1, "undecided")), null);
  });

  test("is nothing for a kind that is not drawn, whatever the path says", () => {
    assert.equal(
      approvedPicture({ representation: "symbol", imageUrl: "https://x" }),
      null,
    );
    assert.equal(
      approvedPicture({ representation: null, imageUrl: "https://x" }),
      null,
    );
  });
});

describe("shownWordOptions", () => {
  test("offers the words presented up to the point, and none after it", () => {
    const words = [
      word("pen", 1, "approved"),
      word("book", 2, "approved"),
      word("table", 3, "approved"),
    ];
    assert.deepEqual(
      terms(shownWordOptions(words, [], { book: 1, point: 2 })),
      ["book", "pen"],
    );
  });

  test("offers only the words with an approved picture", () => {
    const words = [
      word("pen", 1, "approved"),
      word("pencil", 1, "waiting"),
      word("the", 1, "not drawn"),
      word("box", 1, "undecided"),
    ];
    assert.deepEqual(shownWordOptions(words, [], { book: 1, point: 1 }), [
      { id: "id-pen", term: "pen", imageUrl: "https://images/pen.png" },
    ]);
  });

  test("puts the latest point first, and a point in alphabetical order", () => {
    const words = [
      word("pen", 1, "approved"),
      word("wall", 2, "approved"),
      word("floor", 2, "approved"),
      word("book", 1, "approved"),
    ];
    assert.deepEqual(
      terms(shownWordOptions(words, [], { book: 1, point: 2 })),
      ["floor", "wall", "book", "pen"],
    );
  });

  test("counts an earlier book as presented, and a later one as not", () => {
    const words = [
      word("pen", 40, "approved", 1),
      word("ticket", 53, "approved", 2),
      word("engine", 150, "approved", 3),
    ];
    assert.deepEqual(
      terms(shownWordOptions(words, [], { book: 2, point: 53 })),
      ["ticket", "pen"],
    );
  });

  test("counts a contrast set from its latest member, as the validator does", () => {
    // in is boxed at point 5 and behind at point 9, in one set: the set is
    // shown whole at point 9, so in is not presented at point 5.
    const words = [word("in", 5, "approved"), word("behind", 9, "approved")];
    const rows = [row("where", "in", 0), row("where", "behind", 1)];
    assert.deepEqual(
      terms(shownWordOptions(words, rows, { book: 1, point: 5 })),
      [],
    );
    assert.deepEqual(
      terms(shownWordOptions(words, rows, { book: 1, point: 9 })),
      ["behind", "in"],
    );
    assert.deepEqual(
      terms(shownWordOptions(words, [], { book: 1, point: 5 })),
      ["in"],
    );
  });
});
