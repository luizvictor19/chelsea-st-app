import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { parseCases } from "./cases.ts";
import {
  containsPhrase,
  errorPreserved,
  isEmptyTranscript,
  matchesSpoken,
  normalize,
} from "./score.ts";

describe("normalize", () => {
  test("lower case, no punctuation, spaces collapsed", () => {
    assert.equal(
      normalize("  Yes,  the Book is ON the table!  "),
      "yes the book is on the table",
    );
  });

  test("keeps the contraction as a contraction", () => {
    assert.equal(normalize("It's a pen."), "it's a pen");
    assert.notEqual(normalize("It's a pen."), normalize("It is a pen."));
  });

  test("folds the typographic apostrophe into the straight one", () => {
    assert.equal(normalize("It’s a pen"), normalize("It's a pen"));
  });

  test("drops an apostrophe used as a quotation mark", () => {
    assert.equal(normalize("'pen'"), "pen");
  });

  test("drops ellipses and keeps the words either side", () => {
    assert.equal(
      normalize("It's a... um... it's a pencil."),
      "it's a um it's a pencil",
    );
  });

  test("keeps Portuguese letters", () => {
    assert.equal(normalize("Não sei... É um livro."), "não sei é um livro");
  });

  test("abbreviation dot goes, the word stays", () => {
    assert.equal(normalize("Mr. Brown"), "mr brown");
  });

  test("punctuation alone is empty", () => {
    assert.equal(normalize(" ... ! "), "");
  });
});

describe("containsPhrase", () => {
  test("finds whole words in order", () => {
    assert.equal(
      containsPhrase("The book are on the table.", "book are"),
      true,
    );
  });

  test("does not find a phrase that is only inside a longer word", () => {
    // As a substring, "is pen" is in "this pen".
    assert.equal(containsPhrase("Yes, this pen.", "is pen"), false);
    // And "is close" is in "is closed".
    assert.equal(
      containsPhrase("No, the window is closed.", "is close"),
      false,
    );
  });

  test("an empty phrase is never found", () => {
    assert.equal(containsPhrase("anything", ""), false);
  });
});

describe("errorPreserved", () => {
  test("the mistake kept as said", () => {
    assert.equal(
      errorPreserved("The book are on the table.", "book are", "book is"),
      true,
    );
  });

  test("the mistake corrected", () => {
    assert.equal(
      errorPreserved("The book is on the table.", "book are", "book is"),
      false,
    );
  });

  /*
   * The case that separates the rule from half of it. The error is there, so
   * a rule that only looked for errorSpan would call this preserved; the
   * correction is there too, and the tutor could not tell which the student
   * said.
   */
  test("the mistake and the correction together is not preserved", () => {
    const transcript = "The pens is black. The pens are black.";
    assert.equal(containsPhrase(transcript, "pens is"), true);
    assert.equal(errorPreserved(transcript, "pens is", "pens are"), false);
  });

  test("a correction that contains the error as a substring is not preserved", () => {
    assert.equal(
      errorPreserved("No, the window is closed.", "is close", "is closed"),
      false,
    );
  });

  /*
   * Misheard, not corrected, and still not the mistake: "it is pen" heard as
   * "this pen" no longer says "is pen". Compared as characters it would.
   */
  test("the error span found only across a word boundary is not preserved", () => {
    assert.equal(errorPreserved("Yes, this pen.", "is pen", "is a pen"), false);
  });

  test("a correction by insertion is not preserved", () => {
    assert.equal(
      errorPreserved("Yes, it is a pen.", "is pen", "is a pen"),
      false,
    );
  });

  test("punctuation between the words does not hide the mistake", () => {
    assert.equal(
      errorPreserved("Yes, it is, pen.", "is pen", "is a pen"),
      true,
    );
  });

  test("a contraction is a different word", () => {
    // "it's pen" does not contain "is pen": the tutor would see "it's".
    assert.equal(errorPreserved("Yes, it's pen.", "is pen", "is a pen"), false);
  });
});

describe("matchesSpoken and isEmptyTranscript", () => {
  test("punctuation and case do not matter", () => {
    assert.equal(matchesSpoken("yes it's a pen", "Yes, it's a pen."), true);
  });

  test("an expanded contraction does not match", () => {
    assert.equal(matchesSpoken("Yes, it is a pen.", "Yes, it's a pen."), false);
  });

  test("silence answered with punctuation is empty", () => {
    assert.equal(isEmptyTranscript(" . "), true);
    assert.equal(isEmptyTranscript("Thank you."), false);
  });
});

/*
 * The committed cases have to be consistent with the rule, or the rule is
 * measuring the file: the spoken sentence of every error case is a perfect
 * transcription, so it must count as preserved, and its correction must not.
 */
describe("scripts/stt-cases.json", () => {
  const cases = parseCases(
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../../scripts/stt-cases.json"),
        "utf8",
      ),
    ),
  );

  test("has the 30 cases", () => {
    assert.equal(cases.length, 30);
  });

  for (const each of cases) {
    if (each.errorSpan === undefined || each.correctedSpan === undefined) {
      continue;
    }
    const { errorSpan, correctedSpan } = each;

    test(`${each.id}: the spoken sentence keeps the mistake`, () => {
      assert.equal(errorPreserved(each.spoken, errorSpan, correctedSpan), true);
    });

    test(`${each.id}: the spoken sentence, corrected, does not`, () => {
      const corrected = normalize(each.spoken).replace(
        normalize(errorSpan),
        normalize(correctedSpan),
      );
      assert.notEqual(corrected, normalize(each.spoken));
      assert.equal(errorPreserved(corrected, errorSpan, correctedSpan), false);
    });
  }
});
