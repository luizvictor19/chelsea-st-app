import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  candidates,
  contrastError,
  isChanged,
  moveMember,
  sectionKey,
  setsByWord,
  type SetWord,
} from "./contrast-sets.ts";

const word = (
  id: string,
  term: string,
  pointNumber: number | null,
): SetWord => ({ id, term, pointNumber, lessonNumber: 1 });

// Book 1 as measured on 2026-09-21: the sizes at point 3, a preposition at 5
// and one carried on at 9.
const LARGE = word("l", "large", 3);
const SMALL = word("s", "small", 3);
const LONG = word("g", "long", 3);
const IN = word("i", "in", 5);
const BEHIND = word("b", "behind", 9);
const WORDS = [LARGE, SMALL, LONG, IN, BEHIND];

describe("setsByWord", () => {
  test("finds the same set from every member, in position order", () => {
    const sets = setsByWord(
      [
        { set_id: "x", vocabulary_item_id: "s", position: 1 },
        { set_id: "x", vocabulary_item_id: "l", position: 0 },
      ],
      WORDS,
    );
    assert.deepEqual(
      sets.get("l")?.members.map((m) => m.term),
      ["large", "small"],
    );
    assert.equal(sets.get("s"), sets.get("l"));
    assert.equal(sets.get("g"), undefined);
  });

  test("drops a member it cannot name rather than showing a blank", () => {
    const sets = setsByWord(
      [
        { set_id: "x", vocabulary_item_id: "l", position: 0 },
        { set_id: "x", vocabulary_item_id: "gone", position: 1 },
      ],
      WORDS,
    );
    assert.deepEqual(
      sets.get("l")?.members.map((m) => m.id),
      ["l"],
    );
  });
});

describe("moveMember", () => {
  test("swaps with the neighbour and stops at the ends", () => {
    assert.deepEqual(moveMember(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
    assert.deepEqual(moveMember(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
    assert.deepEqual(moveMember(["a", "b"], 0, -1), ["a", "b"]);
    assert.deepEqual(moveMember(["a", "b"], 1, 1), ["a", "b"]);
  });
});

describe("isChanged", () => {
  test("an order change is a change", () => {
    assert.equal(isChanged(["a", "b"], ["a", "b"]), false);
    assert.equal(isChanged(["b", "a"], ["a", "b"]), true);
    assert.equal(isChanged(["a"], ["a", "b"]), true);
  });
});

describe("candidates", () => {
  const none = new Map();

  test("without a search, offers only the same point", () => {
    const list = candidates(LARGE, ["l"], WORDS, none, null, "");
    assert.deepEqual(
      list.map((c) => c.word.term),
      ["small", "long"],
    );
  });

  test("with a search, reaches other points, the same point first", () => {
    const list = candidates(IN, ["i"], WORDS, none, null, "l");
    // "large", "small" and "long" all contain an l; none is at point 5, so
    // they keep the order they came in.
    assert.deepEqual(
      list.map((c) => c.word.term),
      ["large", "small", "long"],
    );
    const behind = candidates(IN, ["i"], WORDS, none, null, "beh");
    assert.deepEqual(
      behind.map((c) => c.word.term),
      ["behind"],
    );
  });

  test("names the set that holds a word, but not the word's own set", () => {
    const sets = setsByWord(
      [
        { set_id: "x", vocabulary_item_id: "l", position: 0 },
        { set_id: "x", vocabulary_item_id: "s", position: 1 },
      ],
      WORDS,
    );
    const fromLong = candidates(LONG, ["g"], WORDS, sets, null, "");
    assert.equal(fromLong.find((c) => c.word.id === "s")?.takenBy?.id, "x");
    // Editing set x from large, with small taken out of the draft: small is
    // free to come back.
    const fromLarge = candidates(LARGE, ["l"], WORDS, sets, "x", "");
    assert.equal(fromLarge.find((c) => c.word.id === "s")?.takenBy, null);
  });

  test("never offers the open word to link with itself", () => {
    const sets = setsByWord(
      [
        { set_id: "x", vocabulary_item_id: "l", position: 0 },
        { set_id: "x", vocabulary_item_id: "s", position: 1 },
      ],
      WORDS,
    );
    // Editing set x from large with large itself taken out of the draft.
    for (const search of ["", "lar"]) {
      const offered = candidates(LARGE, ["s"], WORDS, sets, "x", search);
      assert.equal(
        offered.some((c) => c.word.id === "l"),
        false,
        `search ${JSON.stringify(search)}`,
      );
    }
  });
});

describe("sectionKey", () => {
  // The section is a sibling of WordPanel, keyed by the word's id. With no
  // saved set the key used to be that id alone, and React saw two children
  // with the same key.
  test("never equals the open word's id, set or no set", () => {
    assert.notEqual(sectionKey("l", []), "l");
    assert.notEqual(
      sectionKey("l", [
        { set_id: "x", vocabulary_item_id: "l", position: 0 },
        { set_id: "x", vocabulary_item_id: "s", position: 1 },
      ]),
      "l",
    );
  });

  test("changes when the saved set changes, order included", () => {
    const pair = [
      { set_id: "x", vocabulary_item_id: "l", position: 0 },
      { set_id: "x", vocabulary_item_id: "s", position: 1 },
    ];
    const swapped = [
      { set_id: "x", vocabulary_item_id: "l", position: 1 },
      { set_id: "x", vocabulary_item_id: "s", position: 0 },
    ];
    const other = [{ set_id: "y", vocabulary_item_id: "g", position: 0 }];
    assert.notEqual(sectionKey("l", pair), sectionKey("l", []));
    assert.notEqual(sectionKey("l", pair), sectionKey("l", swapped));
    assert.equal(sectionKey("l", [...pair, ...other]), sectionKey("l", pair));
  });
});

describe("contrastError", () => {
  test("turns the database's refusals into sentences", () => {
    assert.equal(
      contrastError("already in another contrast set: small"),
      "Já está em outro conjunto: small.",
    );
    assert.equal(
      contrastError("a contrast set needs at least two members, got 1"),
      "Um conjunto precisa de pelo menos duas palavras.",
    );
    assert.equal(contrastError("something else"), "something else");
  });

  test("a stale save is known by its code, whatever the message says", () => {
    assert.match(
      contrastError("contrast set x changed since it was loaded", "CS001"),
      /alterado em outro lugar/,
    );
    assert.equal(contrastError("anything", "P0001"), "anything");
  });
});
