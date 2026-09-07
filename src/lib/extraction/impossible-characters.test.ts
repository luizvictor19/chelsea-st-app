import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { hasImpossibleCharacter } from "./impossible-characters.ts";

describe("hasImpossibleCharacter", () => {
  test("ordinary English is not flagged", () => {
    assert.equal(hasImpossibleCharacter("on, under, in", "vocabulary"), false);
  });

  test("the punctuation the book prints is not flagged", () => {
    // Each of these was found in the pages themselves and put in the set for
    // that reason. A set that flags the book's own semicolons measures nothing:
    // the first pass flagged 36 blocks and 22 of them were correct English.
    for (const content of [
      "we aren't both sitting; you're sitting",
      "Before a consonant we say “a” — a book",
      "take!, put!, open!",
      "five vowels in the English alphabet:",
      "no = not any",
      "2 + 2 = 4",
      "‘a’ and “the”",
      "What is the meaning/ of the word",
      "I've got, you've got, he’s got",
      "(translate into student's language)",
    ]) {
      assert.equal(
        hasImpossibleCharacter(content, "explanation"),
        false,
        content,
      );
    }
  });

  test("a character the book cannot print is flagged, in every kind", () => {
    for (const kind of [
      "vocabulary",
      "explanation",
      "dictation",
      "chart_ref",
      "revision_exercise",
    ] as const) {
      assert.equal(
        hasImpossibleCharacter("do not, don’t, |", kind),
        true,
        kind,
      );
      assert.equal(hasImpossibleCharacter("Are there any? ~ Yes", kind), true);
      assert.equal(hasImpossibleCharacter("the word “wrist*2/", kind), true);
      assert.equal(hasImpossibleCharacter("&/ DIIGO,", kind), true);
      assert.equal(hasImpossibleCharacter("a ] you", kind), true);
    }
  });

  test("inside a table the column separator is ours, not the engine's", () => {
    // `serializeTable` writes a row as its cells with "|" between them. Counting
    // that as impossible would flag every table in both books and drown the
    // signal the rule exists to carry.
    assert.equal(
      hasImpossibleCharacter("he | is | not speaking", "grammar_table"),
      false,
    );
  });

  test("a table is still flagged for anything else", () => {
    assert.equal(
      hasImpossibleCharacter("he | is ] not speaking", "grammar_table"),
      true,
    );
  });

  test("the newline a table is written with is not a strange character", () => {
    assert.equal(
      hasImpossibleCharacter("he | is\nshe | is", "grammar_table"),
      false,
    );
  });
});
