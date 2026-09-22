import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildContrastPrompt,
  contrastCandidates,
  inBookOrder,
  parseContrastSuggestions,
  type CandidateWord,
} from "./contrast-suggest.ts";

const word = (
  id: string,
  term: string,
  point: number,
  kind: CandidateWord["kind"],
  wordClass: string | null = "adjective",
): CandidateWord => ({ id, term, point, kind, wordClass });

// Lesson 1 of book 1 as measured on 2026-09-22, cut down: large and small at
// point 3, the article beside them, and a word already linked into a set.
const LARGE = word("l", "large", 3, "figure");
const SMALL = word("s", "small", 3, "figure");
const THE = word("t", "the", 3, "usage", "determiner");
const CONTRACTION = word("c", "contraction", 3, "metalanguage", "noun");
const BOY = word("b", "boy", 4, "photo", "noun");
const GIRL = word("g", "girl", 4, "photo", "noun");
const ONE = word("1", "one", 5, "symbol", "numeral");
const UNDECIDED = word("u", "woman", 4, null, "noun");
const LESSON = [SMALL, THE, GIRL, LARGE, CONTRACTION, BOY, ONE, UNDECIDED];

describe("contrastCandidates", () => {
  test("sends only words with a picture that are in no set, in book order", () => {
    const sent = contrastCandidates(LESSON, new Set(["g"]));
    assert.deepEqual(
      sent.map((w) => w.term),
      ["large", "small", "boy", "one"],
    );
  });

  // symbol is not a kind an image is generated for, but a numeral is shown
  // as one, and the teacher's sets include one to five.
  test("keeps symbol, and drops usage, metalanguage, none and undecided", () => {
    const sent = contrastCandidates(
      [...LESSON, word("n", "hello", 3, "none", "interjection")],
      new Set(),
    );
    const terms = sent.map((w) => w.term);
    assert.ok(terms.includes("one"));
    for (const gone of ["the", "contraction", "hello", "woman"]) {
      assert.ok(!terms.includes(gone), gone);
    }
  });
});

describe("buildContrastPrompt", () => {
  test("lists each word with its point, kind and class, and says json", () => {
    const { system, user } = buildContrastPrompt(
      { lesson: 1, point: null, words: [LARGE, SMALL] },
      "lesson",
    );
    assert.match(system, /json/iu);
    assert.match(
      user,
      /^Lesson 1\. Find the contrast sets among these 2 words:/u,
    );
    assert.match(user, /\nl\tlarge\t3\tfigure\tadjective/u);
  });

  test("offers the point as a hint per lesson, and not per point", () => {
    const hint = /more likely to form a set together/u;
    const lesson = buildContrastPrompt(
      { lesson: 1, point: null, words: [LARGE] },
      "lesson",
    );
    const point = buildContrastPrompt(
      { lesson: 1, point: 3, words: [LARGE] },
      "point",
    );
    assert.match(lesson.system, hint);
    assert.match(lesson.system, /the words of one lesson/u);
    assert.doesNotMatch(point.system, hint);
    assert.match(point.system, /the words of one point/u);
    assert.match(point.user, /^Lesson 1, point 3\./u);
  });
});

describe("parseContrastSuggestions", () => {
  const sent = [LARGE, SMALL, BOY, ONE];
  const answer = (sets: unknown) => JSON.stringify({ sets });

  test("keeps a set of sent words with its reason, in the model's order", () => {
    const parsed = parseContrastSuggestions(
      answer([{ members: ["s", "l"], reason: " Opposite sizes. " }]),
      sent,
    );
    assert.deepEqual(parsed.sets, [
      { members: ["s", "l"], reason: "Opposite sizes." },
    ]);
    assert.equal(parsed.unreadable, false);
  });

  test("drops an id from outside the lesson, or already in a set, and counts it", () => {
    // g is girl, already linked, so it was never sent; x is from nowhere.
    const parsed = parseContrastSuggestions(
      answer([{ members: ["b", "g", "x"], reason: "people" }]),
      sent,
    );
    assert.deepEqual(parsed.sets, []);
    assert.equal(parsed.unknown, 2);
    assert.equal(parsed.tooSmall, 1);
  });

  test("keeps a word in the first set that names it, and drops it from later ones", () => {
    const parsed = parseContrastSuggestions(
      answer([
        { members: ["l", "s"], reason: "size" },
        { members: ["s", "b", "1"], reason: "mixed" },
      ]),
      sent,
    );
    assert.deepEqual(
      parsed.sets.map((s) => s.members),
      [
        ["l", "s"],
        ["b", "1"],
      ],
    );
    assert.equal(parsed.repeated, 1);
  });

  test("drops a word named twice in one set, and a set left with one word", () => {
    const parsed = parseContrastSuggestions(
      answer([{ members: ["l", "l"], reason: "twice" }]),
      sent,
    );
    assert.deepEqual(parsed.sets, []);
    assert.equal(parsed.repeated, 1);
    assert.equal(parsed.tooSmall, 1);
  });

  test("a missing reason is empty rather than a guess, and a fence is unwrapped", () => {
    const parsed = parseContrastSuggestions(
      "```json\n" + answer([{ members: ["l", "s"] }]) + "\n```",
      sent,
    );
    assert.deepEqual(parsed.sets, [{ members: ["l", "s"], reason: "" }]);
  });

  test("an answer that is not the shape asked for is unreadable, and nothing is kept", () => {
    for (const text of ["not json", "[]", '{"sets": 3}', "null"]) {
      const parsed = parseContrastSuggestions(text, sent);
      assert.deepEqual(parsed.sets, [], text);
      assert.equal(parsed.unreadable, true, text);
    }
  });
});

describe("inBookOrder", () => {
  test("orders members by point, then alphabetically, whatever the model said", () => {
    assert.deepEqual(inBookOrder(["1", "s", "b", "l"], LESSON), [
      "l",
      "s",
      "b",
      "1",
    ]);
  });

  test("puts a member it cannot place last, rather than dropping it", () => {
    assert.deepEqual(inBookOrder(["?", "s", "l"], LESSON), ["l", "s", "?"]);
  });
});
