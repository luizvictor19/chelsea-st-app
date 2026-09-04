import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  GRAMMAR_TABLE_PLACEHOLDER,
  columnCount,
  parseGrammarTable,
} from "./grammar-table.ts";

describe("parseGrammarTable", () => {
  test("the three shapes the book actually uses", () => {
    // A conjugation grid, two pronoun columns.
    const conjugation = parseGrammarTable(
      [
        "Present continuous (negative)",
        "I | am not speaking",
        "you | are not speaking",
      ].join("\n"),
    );
    assert.equal(conjugation.length, 1);
    assert.equal(conjugation[0].heading, "Present continuous (negative)");
    assert.deepEqual(conjugation[0].rows, [
      ["I", "am not speaking"],
      ["you", "are not speaking"],
    ]);

    // A comparison whose heading is itself a row of two columns.
    const comparison = parseGrammarTable(
      ["Possessive adjectives | Possessive pronouns", "my | mine"].join("\n"),
    );
    assert.deepEqual(comparison[0].rows, [
      ["Possessive adjectives", "Possessive pronouns"],
      ["my", "mine"],
    ]);

    // Three columns.
    const comparatives = parseGrammarTable("many | more ... than | the most");
    assert.equal(columnCount(comparatives[0]), 3);
  });

  test("a blank line starts a new section", () => {
    const sections = parseGrammarTable(
      [
        "positive",
        "You | are speaking",
        "",
        "question",
        "Are | you speaking?",
      ].join("\n"),
    );
    assert.equal(sections.length, 2);
    assert.equal(sections[0].heading, "positive");
    assert.equal(sections[1].heading, "question");
  });

  test("a second heading with no blank line still starts a section", () => {
    const sections = parseGrammarTable(
      ["one", "a | b", "two", "c | d"].join("\n"),
    );
    assert.deepEqual(
      sections.map((s) => s.heading),
      ["one", "two"],
    );
  });

  test("hand typing is forgiven", () => {
    const sections = parseGrammarTable("  I   |   am not speaking  |  ");
    assert.deepEqual(sections[0].rows, [["I", "am not speaking"]]);
  });

  test("an empty cell in the middle is kept, because it is a gap in the table", () => {
    const sections = parseGrammarTable("its | -");
    assert.deepEqual(sections[0].rows, [["its", "-"]]);
    const missing = parseGrammarTable("its |  | mine");
    assert.deepEqual(missing[0].rows, [["its", "", "mine"]]);
  });

  test("a heading on its own is a section with no rows", () => {
    const sections = parseGrammarTable("Present simple");
    assert.deepEqual(sections, [{ heading: "Present simple", rows: [] }]);
  });

  test("nothing typed is no table", () => {
    assert.deepEqual(parseGrammarTable(""), []);
    assert.deepEqual(parseGrammarTable("\n\n  \n"), []);
  });

  test("the placeholder is written in the convention it teaches", () => {
    // If the example did not parse, it would be teaching the wrong thing.
    const sections = parseGrammarTable(GRAMMAR_TABLE_PLACEHOLDER);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].heading, "Present continuous (negative)");
    assert.equal(sections[0].rows.length, 4);
    assert.equal(columnCount(sections[0]), 2);
  });
});
