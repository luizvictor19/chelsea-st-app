import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MARGIN_GROUP_Y_TOLERANCE } from "./constants.ts";
import { reconcilePoints, type PageReadings } from "./reconcile.ts";

const CEILING = 128;

/** Readings as [value, y] or [value, y, agreement]; agreement defaults to 1. */
function page(
  id: string,
  uploadIndex: number,
  readings: readonly (
    readonly [number, number] | readonly [number, number, number]
  )[],
  structure: { boxCount?: number; structureCount?: number } = {},
): PageReadings {
  return {
    id,
    uploadIndex,
    readings: readings.map(([value, y, agreement]) => ({
      value,
      y,
      agreement: agreement ?? 1,
    })),
    boxCount: structure.boxCount ?? 0,
    structureCount: structure.structureCount ?? 0,
  };
}

function pointsById(result: ReturnType<typeof reconcilePoints>) {
  return Object.fromEntries(result.pages.map((p) => [p.id, p.points]));
}

describe("reconcilePoints", () => {
  test("a page whose readings are unambiguous keeps them", () => {
    const result = reconcilePoints(
      [page("a", 0, [[57, 100]]), page("b", 1, [[58, 100]])],
      CEILING,
    );
    assert.deepEqual(pointsById(result), { a: [57], b: [58] });
    assert.equal(result.needsReview, false);
  });

  test("the pages that really carry a number push a misreading off it", () => {
    // The case the whole design exists for, in the shape the real pages take:
    // a continuation page carries no number, and OCR returns the facing page's
    // 58 and 59 as two guesses at one position, a pixel apart. Alone it is
    // indistinguishable from a page that carries them. In the batch it is not,
    // because the pages that do carry them leave that position with nothing.
    const result = reconcilePoints(
      [
        page("p057-058", 0, [
          [57, 258],
          [58, 1293],
        ]),
        page("p059", 1, [[59, 1112]]),
        page("continuation", 2, [
          [58, 1102],
          [59, 1103],
        ]),
      ],
      CEILING,
    );
    assert.deepEqual(pointsById(result), {
      "p057-058": [57, 58],
      p059: [59],
      continuation: [],
    });
    assert.equal(result.needsReview, false);
  });

  test("criterion 4: two scans of one page are merged, not counted twice", () => {
    // The pair that motivated this rule: the same page at 521px and 534px. It
    // reads the same numbers and shows the same panels. Box contents are not
    // usable as the key, because the two scans differ exactly inside the
    // flattened table, where the reading order changes.
    const result = reconcilePoints(
      [
        page(
          "p053-054",
          0,
          [
            [53, 173],
            [54, 1275],
          ],
          { boxCount: 3, structureCount: 1 },
        ),
        page(
          "dup-534px",
          1,
          [
            [53, 178],
            [54, 1280],
          ],
          { boxCount: 3, structureCount: 0 },
        ),
      ],
      CEILING,
    );

    const primary = result.pages.find((p) => p.id === "p053-054");
    const duplicate = result.pages.find((p) => p.id === "dup-534px");
    assert.deepEqual(primary?.points, [53, 54]);
    assert.equal(primary?.duplicateOf, null);
    // The scan that gave up a lesson header is the one worth keeping.
    assert.equal(duplicate?.duplicateOf, "p053-054");
    assert.deepEqual(duplicate?.points, []);
    assert.equal(result.needsReview, false);
  });

  test("pages that merely read alike are not merged", () => {
    // Same numbers, different panel count: two different pages.
    const result = reconcilePoints(
      [
        page("a", 0, [[60, 100]], { boxCount: 3 }),
        page("b", 1, [[60, 100]], { boxCount: 1 }),
      ],
      CEILING,
    );
    assert.equal(
      result.pages.filter((p) => p.duplicateOf !== null).length,
      0,
      "neither may be treated as a copy of the other",
    );
  });

  test("criterion: a stray number between two anchors is impossible", () => {
    // With 73 and 75 placed, the position between them can only hold 74. The
    // 4 and the 45 go without any threshold saying so, which is the sequence
    // half of "validate by sequence and ceiling".
    const result = reconcilePoints(
      [
        page("p073", 0, [[73, 200]]),
        page("p074", 1, [
          [74, 538],
          [4, 538],
          [45, 538],
        ]),
        page("p075", 2, [[75, 200]]),
      ],
      CEILING,
    );
    assert.deepEqual(pointsById(result), {
      p073: [73],
      p074: [74],
      p075: [75],
    });
    assert.equal(result.needsReview, false);
  });

  test("agreement decides a tie, and only inside one position", () => {
    // 56 seen by two crops beats 50 seen by one. Never used as a filter:
    // requiring two would discard real numbers only one crop found.
    const result = reconcilePoints(
      [
        page("p056", 0, [
          [50, 644, 1],
          [56, 644, 2],
        ]),
      ],
      CEILING,
    );
    assert.deepEqual(pointsById(result), { p056: [56] });
    assert.equal(result.needsReview, false);
  });

  test("a number only one crop saw is still a number", () => {
    const result = reconcilePoints([page("a", 0, [[58, 900, 1]])], CEILING);
    assert.deepEqual(pointsById(result), { a: [58] });
  });

  test("readings at nearly the same height are one number, not two", () => {
    const result = reconcilePoints(
      [
        page("a", 0, [
          [55, 640],
          [95, 640 + MARGIN_GROUP_Y_TOLERANCE - 1],
        ]),
        page("b", 1, [[95, 100]]),
      ],
      CEILING,
    );
    // 95 belongs to b, which leaves the single group on a holding 55.
    assert.deepEqual(pointsById(result), { a: [55], b: [95] });
  });

  test("readings far apart are separate numbers", () => {
    const result = reconcilePoints(
      [
        page("a", 0, [
          [70, 100],
          [71, 100 + MARGIN_GROUP_Y_TOLERANCE + 1],
        ]),
      ],
      CEILING,
    );
    assert.deepEqual(pointsById(result), { a: [70, 71] });
  });

  test("a value beyond the ceiling cannot be a point in this book", () => {
    // Digits run together, such as 1091 on the page carrying 109.
    const result = reconcilePoints(
      [
        page("a", 0, [
          [109, 100],
          [1091, 700],
          [110, 701],
        ]),
      ],
      CEILING,
    );
    assert.deepEqual(pointsById(result), { a: [109, 110] });
  });

  test("two candidates that nothing else claims are a tie, and a tie is asked about", () => {
    // Both are spoken for by nobody, so no rule can choose between them. The
    // program does not get to invent an answer: a value may simply be absent,
    // because the teacher can upload part of a book.
    const result = reconcilePoints(
      [
        page("a", 0, [
          [50, 640],
          [56, 640],
        ]),
      ],
      CEILING,
    );
    assert.deepEqual(pointsById(result), { a: [] });
    assert.equal(result.needsReview, true);
    assert.deepEqual(result.pages[0].disputes, [
      { y: 640, candidates: [50, 56] },
    ]);
  });

  test("a page with no number inherits from the page before it in upload order", () => {
    const result = reconcilePoints(
      [
        page("first", 0, [[60, 100]]),
        page("continuation", 1, []),
        page("next", 2, [[61, 100]]),
      ],
      CEILING,
    );
    const continuation = result.pages.find((p) => p.id === "continuation");
    assert.deepEqual(continuation?.points, []);
    assert.equal(continuation?.inheritedPoint, 60);
  });

  test("book order comes from the numbers, not from the upload", () => {
    const result = reconcilePoints(
      [
        page("late", 0, [[90, 100]]),
        page("early", 1, [[54, 100]]),
        page("middle", 2, [[70, 100]]),
      ],
      CEILING,
    );
    assert.deepEqual(
      result.pages.map((p) => p.id),
      ["early", "middle", "late"],
    );
  });

  test("an unnumbered page stays beside the page it followed", () => {
    const result = reconcilePoints(
      [
        page("late", 0, [[90, 100]]),
        page("after-late", 1, []),
        page("early", 2, [[54, 100]]),
      ],
      CEILING,
    );
    assert.deepEqual(
      result.pages.map((p) => p.id),
      ["early", "late", "after-late"],
    );
  });

  test("a numbered page keeps its numbers whatever the upload order", () => {
    // Book order comes from the numbers, so a page that carries them must not
    // depend on when it was uploaded. A page that carries none is a different
    // matter: it is placed by upload order, which is the specified behaviour.
    const shapes = [
      (i: number) =>
        page("continuation", i, [
          [58, 1102],
          [59, 1103],
        ]),
      (i: number) =>
        page("p057-058", i, [
          [57, 258],
          [58, 1293],
        ]),
      (i: number) => page("p059", i, [[59, 1112]]),
    ];
    const runOrder = (order: readonly number[]) =>
      reconcilePoints(
        order.map((which, index) => shapes[which](index)),
        CEILING,
      );

    const baseline = pointsById(runOrder([0, 1, 2]));
    for (const order of [
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ]) {
      assert.deepEqual(
        pointsById(runOrder(order)),
        baseline,
        `order ${order.join(",")} disagreed`,
      );
    }
    assert.deepEqual(baseline, {
      "p057-058": [57, 58],
      p059: [59],
      continuation: [],
    });
  });
});
