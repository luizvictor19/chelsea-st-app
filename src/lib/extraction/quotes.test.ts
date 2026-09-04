import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { repairClosingQuotes } from "./quotes.ts";

describe("repairClosingQuotes", () => {
  test("repairs the shapes both engines actually produce", () => {
    // Left column from the CLI baseline, right column from tesseract.js. The
    // rule is by position, so it does not care which character was invented.
    const cases: readonly [string, string][] = [
      ['The plural of “foot"', "The plural of “foot”"],
      ["we generally use “any*", "we generally use “any”"],
      ["The contraction of “to have“", "The contraction of “to have”"],
      ["of “woman®", "of “woman”"],
    ];
    for (const [broken, repaired] of cases) {
      assert.equal(repairClosingQuotes(broken), repaired);
    }
  });

  test("a corruption of more than one character is left alone", () => {
    // tesseract.js sometimes replaces the closing quote with two characters,
    // as in “wrist*2. The rule swaps one character for one character, so it
    // abstains here rather than guessing how much to swallow. Measured, this
    // is why 28 of the 73 unclosed spans are left for the teacher.
    assert.equal(
      repairClosingQuotes("the word “wrist*2/ How many"),
      "the word “wrist*2/ How many",
    );
  });

  test("the dictation's reading pause survives", () => {
    // The slash is where the teacher stops reading aloud. Eating it would
    // silently change how the dictation is delivered.
    assert.equal(
      repairClosingQuotes('The plural of “foot"/ is “feet”./'),
      "The plural of “foot”/ is “feet”./",
    );
    assert.equal(
      repairClosingQuotes("we generally use “any*/ in questions"),
      "we generally use “any”/ in questions",
    );
  });

  test("punctuation inside and after the quotation is kept", () => {
    assert.equal(
      repairClosingQuotes('we say “Do you speak Japanese?" and'),
      "we say “Do you speak Japanese?” and",
    );
    assert.equal(
      repairClosingQuotes('the meaning of the word “wrist"?'),
      "the meaning of the word “wrist”?",
    );
    assert.equal(
      repairClosingQuotes('For “he”, “she” and “it", we use'),
      "For “he”, “she” and “it”, we use",
    );
  });

  test("an apostrophe is part of the word, not a quotation mark", () => {
    for (const line of [
      "“I've, you've, he’s”",
      "the contraction is “don’t”",
      "“he’s” and “she’s”",
    ]) {
      assert.equal(repairClosingQuotes(line), line);
    }
  });

  test("a quotation already closed is left alone", () => {
    for (const line of [
      "The plural of “man” is “men”.",
      "“Many” and “much” have the same meaning",
      "no quotation marks here at all",
    ]) {
      assert.equal(repairClosingQuotes(line), line);
    }
  });

  test("a quotation that runs onto the next line is not repaired", () => {
    // Prose wraps. An opening at the end of a line closes on the following one,
    // and there is nothing wrong with it.
    assert.equal(
      repairClosingQuotes("The contraction of “I"),
      "The contraction of “I",
    );
  });

  test("two possible closings means the line does not say which", () => {
    // Abstaining is the right failure: a rule that guessed here would corrupt
    // prose that was read correctly.
    // Two characters here could each be the closing quote and neither could be
    // punctuation, so the line does not say which.
    const ambiguous = 'we use “some* thing" in questions';
    assert.equal(repairClosingQuotes(ambiguous), ambiguous);

    // Where only one candidate is impossible, the line does say which, even
    // with punctuation in the way.
    assert.equal(
      repairClosingQuotes('we say “Is there anybody here? Yes; there is"'),
      "we say “Is there anybody here? Yes; there is”",
    );
  });

  test("a line with no opening quotation is untouched", () => {
    assert.equal(repairClosingQuotes(""), "");
    assert.equal(repairClosingQuotes("plain prose"), "plain prose");
  });
});
