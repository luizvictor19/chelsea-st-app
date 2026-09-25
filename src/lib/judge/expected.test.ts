import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { parseCases } from "../stt/cases.ts";
import { correctSpoken, derivedExpected, differingMiddle } from "./expected.ts";

describe("differingMiddle", () => {
  test("a changed ending is one word each side", () => {
    assert.deepEqual(differingMiddle("brown stand in", "brown stands in"), {
      start: 1,
      said: ["stand"],
      expected: ["stands"],
    });
  });

  test("a missing article is an empty side", () => {
    assert.deepEqual(differingMiddle("is pen", "is a pen"), {
      start: 1,
      said: [],
      expected: ["a"],
    });
  });
});

describe("correctSpoken", () => {
  /*
   * Written out by hand, one per error case, rather than computed: this is the
   * list that says what the rule should produce, so it cannot come from the
   * rule.
   */
  const CASES: [string, string, string, string][] = [
    ["Yes, it is pen.", "is pen", "is a pen", "Yes, it is a pen."],
    [
      "The book are on the table.",
      "book are",
      "book is",
      "The book is on the table.",
    ],
    ["Yes, Jack is sit.", "is sit", "is sitting", "Yes, Jack is sitting."],
    [
      "Mr Brown stand in front of the door.",
      "brown stand in",
      "brown stands in",
      "Mr Brown stands in front of the door.",
    ],
    [
      "There is two books on the table.",
      "is two",
      "are two",
      "There are two books on the table.",
    ],
    [
      "Yes, the pencil is more long.",
      "more long",
      "longer",
      "Yes, the pencil is longer.",
    ],
    [
      "Have a clock on the wall.",
      "have a clock",
      "there is a clock",
      "There is a clock on the wall.",
    ],
    [
      "No, the window is close.",
      "is close",
      "is closed",
      "No, the window is closed.",
    ],
    ["No, Anna is girl.", "is girl", "is a girl", "No, Anna is a girl."],
    ["The pens is black.", "pens is", "pens are", "The pens are black."],
  ];

  for (const [spoken, errorSpan, correctedSpan, expected] of CASES) {
    test(`${spoken} -> ${expected}`, () => {
      assert.equal(correctSpoken(spoken, errorSpan, correctedSpan), expected);
    });
  }

  test("keeps the punctuation of a word that is deleted", () => {
    assert.equal(
      correctSpoken("It is a pen really.", "pen really", "pen"),
      "It is a pen.",
    );
  });

  test("a span that is only inside a word is not found", () => {
    // "is pen" is in "this pen" as characters, not as words.
    assert.throws(
      () => correctSpoken("Yes, this pen.", "is pen", "is a pen"),
      /not in/,
    );
  });
});

describe("derivedExpected", () => {
  test("a right answer expects itself", () => {
    assert.equal(
      derivedExpected({ category: "correct", spoken: "It's a table." }),
      "It's a table.",
    );
  });

  test("silence, noise and Portuguese are not derived", () => {
    assert.equal(
      derivedExpected({ category: "silence_noise", spoken: "" }),
      null,
    );
    assert.equal(
      derivedExpected({ category: "mixed_portuguese", spoken: "É um livro." }),
      null,
    );
  });
});

/*
 * The file against the rule: every case whose expectation follows from it
 * holds exactly what the rule builds, and the five set by hand hold what Luiz
 * decided on 2026-09-25.
 */
describe("scripts/stt-cases.json expected", () => {
  const cases = parseCases(
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../../scripts/stt-cases.json"),
        "utf8",
      ),
    ),
  );

  const BY_HAND: Record<string, string | null> = {
    s01: null,
    s02: null,
    s03: "It's a pen.",
    m01: "It's a chair.",
    m02: null,
  };

  for (const each of cases) {
    test(`${each.id}`, () => {
      const want =
        each.id in BY_HAND ? BY_HAND[each.id] : derivedExpected(each);
      assert.equal(each.expected, want);
    });
  }

  test("only the five by hand are outside the rule", () => {
    const outside = cases
      .filter((each) => derivedExpected(each) === null)
      .map((each) => each.id)
      .sort();
    assert.deepEqual(outside, Object.keys(BY_HAND).sort());
  });
});
