import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { placeKey, wordsByPoint, type LessonWord } from "./point-words.ts";

function word(term: string, point: number, book = 1): LessonWord {
  return { id: `id-${term}`, term, place: { book, point } };
}

const row = (set: string, term: string, position: number) => ({
  set_id: set,
  vocabulary_item_id: `id-${term}`,
  position,
});

describe("wordsByPoint", () => {
  test("a word alone is a group of its own, at its own point", () => {
    const groups = wordsByPoint([word("lamp", 2), word("a", 1)], []);
    assert.deepEqual(groups.get("1:1"), [
      { key: "id-a", terms: ["a"], ids: ["id-a"], isSet: false },
    ]);
    assert.deepEqual(groups.get("1:2"), [
      { key: "id-lamp", terms: ["lamp"], ids: ["id-lamp"], isSet: false },
    ]);
  });

  test("a set is one group, in the set's order and not the alphabet's", () => {
    const groups = wordsByPoint(
      [word("tiny", 3), word("tall", 3)],
      [row("sizes", "tiny", 0), row("sizes", "tall", 1)],
    );
    assert.deepEqual(groups.get("1:3"), [
      {
        key: "sizes",
        terms: ["tiny", "tall"],
        ids: ["id-tiny", "id-tall"],
        isSet: true,
      },
    ]);
  });

  test("a set across points is shown whole at its latest member", () => {
    const groups = wordsByPoint(
      [word("red", 3), word("pink", 3), word("teal", 7), word("the", 3)],
      [
        row("colours", "red", 0),
        row("colours", "pink", 1),
        row("colours", "teal", 2),
      ],
    );
    assert.deepEqual(groups.get("1:3"), [
      { key: "id-the", terms: ["the"], ids: ["id-the"], isSet: false },
    ]);
    assert.deepEqual(groups.get("1:7"), [
      {
        key: "colours",
        terms: ["red", "pink", "teal"],
        ids: ["id-red", "id-pink", "id-teal"],
        isSet: true,
      },
    ]);
  });

  test("the groups of a point run by their first term", () => {
    const groups = wordsByPoint(
      [word("under", 5), word("in", 5), word("box", 5), word("Zed", 5)],
      [row("where", "under", 0), row("where", "in", 1)],
    );
    assert.deepEqual(
      groups.get("1:5")?.map((group) => group.terms),
      [["box"], ["under", "in"], ["Zed"]],
    );
  });

  test("the same number in another book is another point", () => {
    const groups = wordsByPoint([word("lamp", 4, 1), word("shelf", 4, 2)], []);
    assert.deepEqual(groups.get(placeKey({ book: 2, point: 4 })), [
      { key: "id-shelf", terms: ["shelf"], ids: ["id-shelf"], isSet: false },
    ]);
  });
});
