import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseTable } from "./grammar-table.ts";
import { tableContent } from "./table-layout.ts";
import type { OcrWord } from "./types.ts";

/** A word as the engine returns it, in the enlarged crop's own coordinates. */
function word(text: string, x: number, y: number, width = 40): OcrWord {
  return { text, x, y, width, height: 24, confidence: 80, symbols: [] };
}

const SCALE = 2;

describe("tableContent", () => {
  test("a panel read as one run of words comes back as its lines", () => {
    // Two rows of the printed table. Before this the whole panel was joined
    // with spaces into a single line, and the second row of the book was
    // invisible on the review screen.
    const content = tableContent(
      [
        word("many", 0, 100),
        word("more", 300, 100),
        word("few", 0, 200),
        word("fewer", 300, 200),
      ],
      SCALE,
    );
    assert.equal(content, "many | more\nfew | fewer");
  });

  test("a wide gap is a column and an ordinary one is not", () => {
    // 54px in page coordinates, doubled by the read scale: below it the words
    // are one cell, at it they are two.
    const near = tableContent([word("not", 0, 0), word("speaking", 140, 0)], 2);
    const far = tableContent([word("you", 0, 0), word("are", 220, 0)], 2);
    assert.equal(near, "not speaking");
    assert.equal(far, "you | are");
  });

  test("a word off the line's centre is still on that line", () => {
    // Descenders and the odd tall glyph move a word's box by a fraction of its
    // height. Two lines of the book are never that close.
    const content = tableContent(
      [word("his", 0, 100), word("hers", 300, 106), word("its", 0, 160)],
      SCALE,
    );
    // "its" keeps a trailing separator: it is a row of one cell in a block
    // that has columns, and without it the editor would read it as a heading.
    assert.equal(content, "his | hers\nits |");
  });

  test("the panel's own furniture is dropped", () => {
    // The bracket that groups a conjugation's subjects, and the rule that
    // closes the panel, both come back as "|". Kept, either would be read back
    // as a column boundary of ours, in the middle of a cell. They are drawn
    // down the whole group of lines they hold together, which is what tells
    // them from a letter.
    const bracket = { ...word("|", 200, 0, 6), height: 24 * 3 };
    const content = tableContent(
      [word("do", 0, 0), bracket, word("speak", 400, 0)],
      SCALE,
    );
    assert.equal(content, "do | speak");
  });

  test("a stem the height of the type is the pronoun, and survives", () => {
    // Measured over the 8 bare stems in the tall panels of both books: six are
    // a printed "I" and sit at 0.80 to 0.96 of their panel's body, and the two
    // brackets sit at 2.57 and 3.27. Dropped, "I am" reached the teacher as
    // "am", with nothing on the screen to say a word had gone.
    const content = tableContent(
      [word("|", 0, 0, 6), word("am", 40, 0), word("speaking", 400, 0)],
      SCALE,
    );
    assert.equal(content, "I am | speaking");
  });

  test("a lone stem is judged against the panel, not against its own line", () => {
    // On p060 the "I" is printed alone on its line, with nothing beside it to
    // compare against. The panel around it is what says how tall a line of type
    // is there.
    const content = tableContent(
      [word("do", 0, 0), word("|", 300, 100, 6), word("you", 300, 200)],
      SCALE,
    );
    assert.equal(content, ["do", "I", "you"].join("\n"));
  });

  test("what it writes is what the editor reads back", () => {
    const content = tableContent(
      [
        word("its", 0, 0),
        word("-", 300, 0),
        word("our", 0, 60),
        word("ours", 300, 60),
      ],
      SCALE,
    );
    assert.deepEqual(parseTable(content), [
      [
        { kind: "row", cells: ["its", "-"] },
        { kind: "row", cells: ["our", "ours"] },
      ],
    ]);
  });

  test("a rule fused to a word is cleaned out of the cell", () => {
    // The engine returns "do|" as one token when the printed rule touches the
    // glyph. Left there, it would come back as a column boundary of ours.
    const content = tableContent(
      [word("do|", 0, 0), word("speak", 400, 0)],
      SCALE,
    );
    assert.equal(content, "do | speak");
    assert.deepEqual(parseTable(content), [
      [{ kind: "row", cells: ["do", "speak"] }],
    ]);
  });

  test("nothing read is no content", () => {
    assert.equal(tableContent([], SCALE), "");
    assert.equal(tableContent([word("|", 0, 0, 6)], SCALE), "");
  });
});
