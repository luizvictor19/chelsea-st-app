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
    //
    // "do" starts a column of its own and the two stems below start the next,
    // so the panel is two columns wide and the rows under "do" open with an
    // empty cell. What this test is about is the middle token: it survives, and
    // it survives as "I".
    const content = tableContent(
      [word("do", 0, 0), word("|", 300, 100, 6), word("you", 300, 200)],
      SCALE,
    );
    assert.equal(content, ["do |", " | I", " | you"].join("\n"));
  });

  test("the columns belong to the panel, not to a line of it", () => {
    // Point 36 of book 1, the punctuation grid, at the page's own geometry.
    // "question mark" is wide enough that the gap to the "?" beside it is 25px,
    // under TABLE_COLUMN_GAP, so cut line by line that row welded the two into
    // one cell while the two rows under it parted at exactly that place. The
    // panel's columns are the ones its own lines agree on, and the wide row is
    // assigned to them like any other.
    //
    // The gaps here are the measured ones and not round numbers, because the
    // whole case is that one of them falls under the cut: written with a gap
    // above it this test passes without the rule it is named for.
    const content = tableContent(
      [
        word("question", 34, 0, 258),
        word("mark", 312, 0, 152),
        word("?", 514, 0, 36),
        word("full", 956, 0, 94),
        word("stop", 1072, 0, 126),
        word(".", 1324, 0, 12),
        word("comma", 34, 100, 214),
        word(",", 494, 100, 16),
        word("colon", 956, 100, 158),
        word(":", 1300, 100, 14),
        word("semi-colon", 34, 200, 324),
        word(";", 500, 200, 16),
      ],
      SCALE,
    );
    assert.equal(
      content,
      [
        "question mark | ? | full stop | .",
        "comma | , | colon | :",
        "semi-colon | ;",
      ].join("\n"),
    );
  });

  test("a welded row in a grid of two columns is read as a heading", () => {
    // An open conflict, pinned here rather than left to be discovered. The
    // heading rule asks whether a line is one uninterrupted run laid across the
    // panel, and a row whose first cell welded to its second is exactly that
    // shape. In a grid of two columns the two questions have the same answer
    // and this one wins, so the row is promoted out of the grid instead of
    // being repaired.
    //
    // It does not happen on either book: the panel where a row does weld is the
    // punctuation grid, which has four columns and a wide gap in the middle of
    // the line, so the run is broken and the row is repaired. This is the shape
    // that would break it, and it is written down so that a future book which
    // has one fails here and not in front of the teacher.
    const content = tableContent(
      [
        word("question", 34, 0, 200),
        word("mark", 250, 0, 120),
        word("?", 460, 0, 20),
        word("comma", 34, 100, 160),
        word(",", 460, 100, 20),
        word("semi-colon", 34, 200, 240),
        word(";", 460, 200, 20),
      ],
      SCALE,
    );
    assert.equal(
      content,
      ["question mark ?", "comma | ,", "semi-colon | ;"].join("\n"),
    );
  });

  test("a row that skips a column keeps the column's place", () => {
    // Without the empty cell the last row would read as "colon" under "?" and
    // ":" under "full stop": every cell after the gap shifts one column left,
    // and the pairing the grid is printed to show is silently wrong.
    const content = tableContent(
      [
        word("comma", 34, 0, 160),
        word(",", 494, 0, 20),
        word("colon", 960, 0, 140),
        word(":", 1300, 0, 20),
        word("semi-colon", 34, 100, 240),
        word(";", 494, 100, 20),
        word("stop", 960, 100, 120),
      ],
      SCALE,
    );
    assert.equal(
      content,
      ["comma | , | colon | :", "semi-colon | ; | stop"].join("\n"),
    );
    assert.deepEqual(parseTable(content), [
      [
        { kind: "row", cells: ["comma", ",", "colon", ":"] },
        { kind: "row", cells: ["semi-colon", ";", "stop"] },
      ],
    ]);
  });

  test("an empty cell inside a row survives the round trip", () => {
    const content = tableContent(
      [
        word("I", 34, 0, 20),
        word("am", 300, 0, 80),
        word("here", 700, 0, 120),
        word("you", 34, 100, 100),
        word("there", 700, 100, 140),
      ],
      SCALE,
    );
    assert.equal(content, ["I | am | here", "you |  | there"].join("\n"));
    assert.deepEqual(parseTable(content), [
      [
        { kind: "row", cells: ["I", "am", "here"] },
        { kind: "row", cells: ["you", "", "there"] },
      ],
    ]);
  });

  test("a line laid across the panel is the panel's heading", () => {
    // "Present simple (positive)" is one printed phrase over a grid whose
    // columns are under it. Assigned word by word it came apart into three
    // cells with an empty one in the middle, which is a row the book does not
    // have. It is written as a heading, so the editor shows it as one.
    const content = tableContent(
      [
        word("Present", 36, 0, 228),
        word("simple", 282, 0, 202),
        word("(positive)", 516, 0, 182),
        word("I", 32, 100, 20),
        word("speak", 342, 100, 180),
        word("you", 32, 200, 108),
      ],
      SCALE,
    );
    assert.equal(
      content,
      ["Present simple (positive)", "I | speak", "you |"].join("\n"),
    );
    assert.deepEqual(parseTable(content), [
      [
        { kind: "title", text: "Present simple (positive)" },
        { kind: "row", cells: ["I", "speak"] },
        { kind: "row", cells: ["you"] },
      ],
    ]);
  });

  test("a run starting past the first column is a cell, not a heading", () => {
    // "none" is a single uninterrupted run too, and it is printed in the second
    // column. Taking it there is the whole point of reading the columns off the
    // panel, so the heading rule must not swallow it.
    const content = tableContent(
      [
        word("how", 32, 0, 108),
        word("many?", 152, 0, 190),
        word("seven", 806, 0, 162),
        word("none", 808, 100, 148),
      ],
      SCALE,
    );
    assert.equal(content, ["how many? | seven", " | none"].join("\n"));
  });

  test("a short line in the first column stays a row", () => {
    // "To have" heads the panel at 868 of book 1 and ends well inside the first
    // column, so no column would have cut it. Nothing here claims to find every
    // heading, only the lines the grid would tear.
    const content = tableContent(
      [
        word("To", 32, 0, 60),
        word("have", 104, 0, 130),
        word("I", 32, 100, 20),
        word("have", 700, 100, 130),
      ],
      SCALE,
    );
    assert.equal(content, ["To have |", "I | have"].join("\n"));
    assert.deepEqual(parseTable(content), [
      [
        { kind: "row", cells: ["To have"] },
        { kind: "row", cells: ["I", "have"] },
      ],
    ]);
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
