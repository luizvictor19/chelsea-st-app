import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  columnCount,
  parseTable,
  serializeTable,
  splitCellAtSpace,
  toggleLineKind,
  type TableBlock,
} from "./grammar-table.ts";

const CONJUGATION = [
  "Present continuous (negative)",
  "I | am not speaking",
  "you | are not speaking",
].join("\n");

const FLATTENED = ["many more than the most", "few fewer than the fewest"].join(
  "\n",
);

describe("parseTable", () => {
  test("a line without a column is a heading when the block has columns", () => {
    const block = parseTable(CONJUGATION);
    assert.equal(block.length, 1);
    assert.deepEqual(block[0][0], {
      kind: "title",
      text: "Present continuous (negative)",
    });
    assert.deepEqual(block[0][1], {
      kind: "row",
      cells: ["I", "am not speaking"],
    });
  });

  test("with no column anywhere, every line is a row of one cell", () => {
    // The extractor flattened the whole table, so nothing here was ever a
    // heading, and treating the first line as one would lose a row of content.
    const block = parseTable(FLATTENED);
    assert.deepEqual(
      block[0].map((line) => line.kind),
      ["row", "row"],
    );
    assert.deepEqual(block[0][0], {
      kind: "row",
      cells: ["many more than the most"],
    });
  });

  test("a blank line starts a section", () => {
    const block = parseTable("a | b\n\nc | d");
    assert.equal(block.length, 2);
  });

  test("a trailing separator means one cell, not an empty second column", () => {
    const block = parseTable("Título\nsó esta linha |");
    assert.deepEqual(block[0][1], { kind: "row", cells: ["só esta linha"] });
  });

  test("an empty cell in the middle is kept, being a hole in the table", () => {
    assert.deepEqual(parseTable("its |  | mine")[0][0], {
      kind: "row",
      cells: ["its", "", "mine"],
    });
  });

  test("nothing typed is no table", () => {
    assert.deepEqual(parseTable(""), []);
    assert.deepEqual(parseTable("\n\n  \n"), []);
  });
});

describe("round trip", () => {
  const cases: readonly [string, string][] = [
    ["a conjugation with a heading", CONJUGATION],
    ["a table the extractor flattened", FLATTENED],
    [
      "two sections",
      "positivo\nYou | are speaking\n\nquestão\nAre | you speaking?",
    ],
    ["three columns", "many | more ... than | the most"],
    ["a hole in a row", "its |  | mine"],
  ];

  for (const [name, content] of cases) {
    test(`parsing what was serialized gives the same model: ${name}`, () => {
      const once = parseTable(content);
      const again = parseTable(serializeTable(once));
      assert.deepEqual(again, once);
    });
  }

  test("a one-cell row survives beside a real column", () => {
    // Without the trailing separator this line would read back as a heading,
    // and a row of the lesson would silently become a title.
    const block: TableBlock = [
      [
        { kind: "row", cells: ["sozinha"] },
        { kind: "row", cells: ["a", "b"] },
      ],
    ];
    const text = serializeTable(block);
    assert.match(text, /sozinha \|/);
    assert.deepEqual(parseTable(text), block);
  });

  test("a block of one-cell rows needs no separator at all", () => {
    const block: TableBlock = [
      [
        { kind: "row", cells: ["primeira"] },
        { kind: "row", cells: ["segunda"] },
      ],
    ];
    assert.equal(serializeTable(block), "primeira\nsegunda");
    assert.deepEqual(parseTable(serializeTable(block)), block);
  });
});

describe("splitCellAtSpace", () => {
  const flattened = parseTable(FLATTENED)[0][0];

  test("cutting at the chosen space makes two cells", () => {
    // "many more than the most" cut after the first word.
    assert.deepEqual(splitCellAtSpace(flattened, 0, 0), {
      kind: "row",
      cells: ["many", "more than the most"],
    });
  });

  test("a later space cuts later", () => {
    assert.deepEqual(splitCellAtSpace(flattened, 0, 2), {
      kind: "row",
      cells: ["many more than", "the most"],
    });
  });

  test("cutting again splits only the cell asked for", () => {
    const once = splitCellAtSpace(flattened, 0, 0);
    assert.deepEqual(splitCellAtSpace(once, 1, 1), {
      kind: "row",
      cells: ["many", "more than", "the most"],
    });
  });

  test("a space that is not there changes nothing", () => {
    assert.deepEqual(splitCellAtSpace(flattened, 0, 9), flattened);
    assert.deepEqual(splitCellAtSpace(flattened, 0, -1), flattened);
    assert.deepEqual(splitCellAtSpace(flattened, 4, 0), flattened);
  });

  test("a heading is not a row and is left alone", () => {
    const title = { kind: "title", text: "Present simple" } as const;
    assert.deepEqual(splitCellAtSpace(title, 0, 0), title);
  });

  test("the cut survives being written and read back", () => {
    const cut = splitCellAtSpace(flattened, 0, 0);
    const block: TableBlock = [[cut]];
    assert.deepEqual(parseTable(serializeTable(block)), block);
  });
});

describe("toggleLineKind", () => {
  test("a heading the rule invented becomes a row", () => {
    const block = parseTable(CONJUGATION);
    const fixed: TableBlock = [
      [toggleLineKind(block[0][0]), ...block[0].slice(1)],
    ];
    assert.deepEqual(fixed[0][0], {
      kind: "row",
      cells: ["Present continuous (negative)"],
    });
    // And the change is visible in what gets stored.
    assert.match(serializeTable(fixed), /^Present continuous \(negative\) \|/);
    assert.deepEqual(parseTable(serializeTable(fixed)), fixed);
  });

  test("a row the teacher meant as a heading becomes one", () => {
    const block = parseTable(FLATTENED);
    const fixed: TableBlock = [
      [toggleLineKind(block[0][0]), ...block[0].slice(1)],
    ];
    assert.deepEqual(fixed[0][0], {
      kind: "title",
      text: "many more than the most",
    });
    assert.deepEqual(parseTable(serializeTable(fixed)), fixed);
  });

  test("toggling twice returns what it started as", () => {
    const row = { kind: "row", cells: ["a b"] } as const;
    assert.deepEqual(toggleLineKind(toggleLineKind(row)), row);
  });

  test("a row of several cells folds into one heading", () => {
    assert.deepEqual(toggleLineKind({ kind: "row", cells: ["a", "b"] }), {
      kind: "title",
      text: "a b",
    });
  });
});

describe("columnCount", () => {
  test("the widest row is how many columns the grid draws", () => {
    assert.equal(columnCount(parseTable("a | b | c\nd | e")[0]), 3);
  });

  test("a heading is not a row and does not count", () => {
    assert.equal(columnCount(parseTable(CONJUGATION)[0]), 2);
    assert.equal(columnCount([{ kind: "title", text: "só título" }]), 0);
  });
});
