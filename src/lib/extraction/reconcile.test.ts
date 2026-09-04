import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MARGIN_GROUP_Y_TOLERANCE } from "./constants.ts";
import { reconcilePoints, type PageReadings } from "./reconcile.ts";

const RANGE = { first: 1, last: 128 };
/** Enough crops saw it that the assignment gate lets it through on its own. */
const CONFIDENT = 3;
/** One crop, once: the shape noise takes, and the shape a faint real number takes. */
const ONCE = 1;

function page(
  id: string,
  uploadIndex: number,
  readings: readonly (readonly [number, number, number])[],
  structure: { boxCount?: number; structureCount?: number } = {},
): PageReadings {
  return {
    id,
    uploadIndex,
    readings: readings.map(([value, y, agreement]) => ({
      value,
      y,
      agreement,
    })),
    boxCount: structure.boxCount ?? 0,
    structureCount: structure.structureCount ?? 0,
  };
}

function pointsById(result: ReturnType<typeof reconcilePoints>) {
  return Object.fromEntries(result.pages.map((p) => [p.id, p.points]));
}

function disputesOf(result: ReturnType<typeof reconcilePoints>, id: string) {
  return (
    result.pages.find((p) => p.id === id)?.disputes.map((d) => d.candidates) ??
    []
  );
}

describe("reconcilePoints, within one page", () => {
  test("a reading that breaks the printed order is dropped", () => {
    // The numbers run down the margin in increasing order: that is how the book
    // is printed. A 5 read between 20 and 30 cannot take part in the longest
    // run, and goes before anything is known about any other page.
    const result = reconcilePoints(
      [
        page("a", 0, [
          [10, 100, CONFIDENT],
          [20, 300, CONFIDENT],
          [5, 500, CONFIDENT],
          [30, 700, CONFIDENT],
          [40, 900, CONFIDENT],
        ]),
      ],
      RANGE,
    );
    assert.deepEqual(pointsById(result), { a: [10, 20, 30, 40] });
    assert.deepEqual(
      disputesOf(result, "a"),
      [],
      "the 5 is gone, not asked about",
    );
  });

  test("a stray between two numbers is impossible once they are placed", () => {
    // 57, 11, 58 leaves two runs of length two, so the printed order alone
    // cannot rule the 11 out. Placing 57 and 58 does: nothing fits between them.
    const result = reconcilePoints(
      [
        page("p057-058", 0, [
          [57, 258, CONFIDENT],
          [11, 522, ONCE],
          [58, 1293, ONCE],
        ]),
      ],
      RANGE,
    );
    assert.deepEqual(pointsById(result), { "p057-058": [57, 58] });
    assert.deepEqual(disputesOf(result, "p057-058"), []);
  });

  test("readings at nearly the same height are one number, not two", () => {
    const result = reconcilePoints(
      [
        page("a", 0, [
          [55, 640, CONFIDENT],
          [95, 640 + MARGIN_GROUP_Y_TOLERANCE - 1, ONCE],
        ]),
      ],
      RANGE,
    );
    assert.deepEqual(pointsById(result), { a: [55] });
  });

  test("readings far apart are separate numbers", () => {
    const result = reconcilePoints(
      [
        page("a", 0, [
          [70, 100, CONFIDENT],
          [71, 100 + MARGIN_GROUP_Y_TOLERANCE + 1, CONFIDENT],
        ]),
      ],
      RANGE,
    );
    assert.deepEqual(pointsById(result), { a: [70, 71] });
  });

  test("a value beyond the ceiling cannot be a point in this book", () => {
    // Digits run together, such as 1091 on the page carrying 109.
    const result = reconcilePoints(
      [
        page("a", 0, [
          [109, 100, CONFIDENT],
          [1091, 700, CONFIDENT],
          [110, 701, CONFIDENT],
        ]),
      ],
      RANGE,
    );
    assert.deepEqual(pointsById(result), { a: [109, 110] });
  });
});

describe("reconcilePoints, what may be assigned", () => {
  test("two crops agreeing is enough on its own", () => {
    const result = reconcilePoints([page("a", 0, [[60, 100, 2]])], RANGE);
    assert.deepEqual(pointsById(result), { a: [60] });
  });

  test("a lone reading one crop saw once is asked about, never assigned", () => {
    // Nothing corroborates it: one crop, one page, no run to join. This is the
    // shape of noise, and the answer is a question rather than a guess.
    const result = reconcilePoints([page("a", 0, [[1, 326, ONCE]])], RANGE);
    assert.deepEqual(pointsById(result), { a: [] });
    assert.deepEqual(disputesOf(result, "a"), [[1]]);
  });

  test("one crop is enough when the page's own run corroborates it", () => {
    const result = reconcilePoints(
      [
        page("a", 0, [
          [57, 258, CONFIDENT],
          [58, 1293, ONCE],
        ]),
      ],
      RANGE,
    );
    assert.deepEqual(pointsById(result), { a: [57, 58] });
  });

  test("one crop is enough when two placed numbers leave one possibility", () => {
    // 62 belongs to the next page, which leaves this position holding only 61,
    // bounded below by its own 60 and above by that 62.
    const result = reconcilePoints(
      [
        page("a", 0, [
          [60, 100, CONFIDENT],
          [61, 500, ONCE],
          [62, 501, ONCE],
        ]),
        page("b", 1, [[62, 100, CONFIDENT]]),
      ],
      RANGE,
    );
    assert.deepEqual(pointsById(result), { a: [60, 61], b: [62] });
  });

  test("two candidates that nothing can separate are asked about", () => {
    const result = reconcilePoints(
      [
        page("a", 0, [
          [50, 644, ONCE],
          [56, 644, ONCE],
        ]),
      ],
      RANGE,
    );
    assert.deepEqual(pointsById(result), { a: [] });
    assert.deepEqual(disputesOf(result, "a"), [[50, 56]]);
  });

  test("agreement decides a tie, and only inside one position", () => {
    // 56 seen by two crops beats 50 seen by one. Never used as a filter:
    // requiring two would discard real numbers only one crop found.
    const result = reconcilePoints(
      [
        page("a", 0, [
          [50, 644, ONCE],
          [56, 644, 2],
        ]),
      ],
      RANGE,
    );
    assert.deepEqual(pointsById(result), { a: [56] });
  });
});

describe("reconcilePoints, on a small upload", () => {
  // Anchors are what the batch reasons from, and a small upload has few. These
  // are the shapes a teacher actually uploads: a handful of pages at a time.

  test("two undecided positions between two anchors are settled together", () => {
    // 118 and 121 are placed, which leaves 119 and 120 for two positions. There
    // is one way to fit them, and the printed order says which is which.
    // Neither is forced on its own, so the interval rule alone loses both and
    // the page silently becomes a continuation of 118.
    const result = reconcilePoints(
      [
        page("p117-118", 0, [
          [117, 200, CONFIDENT],
          [118, 900, CONFIDENT],
        ]),
        page("p119-120", 1, [
          [119, 210, ONCE],
          [120, 880, ONCE],
        ]),
        page("p121", 2, [[121, 200, CONFIDENT]]),
      ],
      RANGE,
    );
    assert.deepEqual(pointsById(result), {
      "p117-118": [117, 118],
      "p119-120": [119, 120],
      p121: [121],
    });
    assert.equal(result.needsReview, false);
  });

  test("a position that read none of the free values is not filled from the count", () => {
    // A position whose every reading was rejected has nothing to say. Filling
    // it because the arithmetic works out invents a number nobody read, and
    // takes it from the page that does carry it.
    const result = reconcilePoints(
      [
        page("p118", 0, [[118, 200, CONFIDENT]]),
        page("continuation", 1, [[57, 300, ONCE]]),
        page("p120", 2, [[120, 200, CONFIDENT]]),
      ],
      RANGE,
    );
    const continuation = result.pages.find((p) => p.id === "continuation");
    assert.deepEqual(continuation?.points, [], "119 must not be invented here");
  });

  test("more free values than positions leaves them undecided", () => {
    const result = reconcilePoints(
      [
        page("a", 0, [[110, 200, CONFIDENT]]),
        page("b", 1, [[113, 300, ONCE]]),
        page("c", 2, [[120, 200, CONFIDENT]]),
      ],
      RANGE,
    );
    assert.deepEqual(pointsById(result)["b"], [], "nothing is forced");
  });

  test("an unanchored side means the count says nothing", () => {
    // With no number placed after it, the run of free values is open-ended.
    const result = reconcilePoints(
      [page("a", 0, [[110, 200, CONFIDENT]]), page("b", 1, [[111, 300, ONCE]])],
      RANGE,
    );
    assert.deepEqual(pointsById(result)["b"], []);
  });
});

describe("reconcilePoints, across the batch", () => {
  test("the pages that really carry a number push a misreading off it", () => {
    // A continuation page carries no number, and OCR returns the facing page's
    // 58 and 59 as two guesses at one position. Alone it is indistinguishable
    // from a page that carries them; in the batch it is not.
    const result = reconcilePoints(
      [
        page("p057-058", 0, [
          [57, 258, CONFIDENT],
          [58, 1293, CONFIDENT],
        ]),
        page("p059", 1, [[59, 1112, CONFIDENT]]),
        page("continuation", 2, [
          [58, 1102, ONCE],
          [59, 1103, ONCE],
        ]),
      ],
      RANGE,
    );
    assert.deepEqual(pointsById(result), {
      "p057-058": [57, 58],
      p059: [59],
      continuation: [],
    });
    assert.equal(result.needsReview, false);
  });

  test("criterion 4: two scans of one page are merged, not counted twice", () => {
    // The same page at 521px and 534px. Box contents are not usable as the key:
    // the two scans agree word for word except inside the flattened table,
    // where the reading order changes.
    const result = reconcilePoints(
      [
        page(
          "p053-054",
          0,
          [
            [53, 173, CONFIDENT],
            [54, 1275, CONFIDENT],
          ],
          { boxCount: 3, structureCount: 1 },
        ),
        page(
          "dup-534px",
          1,
          [
            [53, 178, CONFIDENT],
            [54, 1280, CONFIDENT],
          ],
          { boxCount: 3, structureCount: 0 },
        ),
      ],
      RANGE,
    );
    const primary = result.pages.find((p) => p.id === "p053-054");
    const duplicate = result.pages.find((p) => p.id === "dup-534px");
    assert.deepEqual(primary?.points, [53, 54]);
    assert.equal(primary?.duplicateOf, null);
    // The scan that gave up a lesson header is the one worth keeping.
    assert.equal(duplicate?.duplicateOf, "p053-054");
    assert.deepEqual(duplicate?.points, []);
  });

  test("pages that merely read alike are not merged", () => {
    const result = reconcilePoints(
      [
        page("a", 0, [[60, 100, CONFIDENT]], { boxCount: 3 }),
        page("b", 1, [[60, 100, CONFIDENT]], { boxCount: 1 }),
      ],
      RANGE,
    );
    assert.equal(result.pages.filter((p) => p.duplicateOf !== null).length, 0);
  });

  test("two pages carrying no number at all are never taken for copies", () => {
    // With nothing to match on, the duplicate key says nothing, and two
    // different continuation pages would be collapsed into one.
    const result = reconcilePoints(
      [
        page("first", 0, [], { boxCount: 1 }),
        page("second", 1, [], { boxCount: 1 }),
      ],
      RANGE,
    );
    assert.equal(result.pages.filter((p) => p.duplicateOf !== null).length, 0);
  });

  test("a page with no number inherits from the page before it in upload order", () => {
    const result = reconcilePoints(
      [
        page("first", 0, [[60, 100, CONFIDENT]]),
        page("continuation", 1, []),
        page("next", 2, [[61, 100, CONFIDENT]]),
      ],
      RANGE,
    );
    const continuation = result.pages.find((p) => p.id === "continuation");
    assert.deepEqual(continuation?.points, []);
    assert.equal(continuation?.inheritedPoint, 60);
  });

  test("book order comes from the numbers, not from the upload", () => {
    const result = reconcilePoints(
      [
        page("late", 0, [[90, 100, CONFIDENT]]),
        page("early", 1, [[54, 100, CONFIDENT]]),
        page("middle", 2, [[70, 100, CONFIDENT]]),
      ],
      RANGE,
    );
    assert.deepEqual(
      result.pages.map((p) => p.id),
      ["early", "middle", "late"],
    );
  });

  test("an unnumbered page stays beside the page it followed", () => {
    const result = reconcilePoints(
      [
        page("late", 0, [[90, 100, CONFIDENT]]),
        page("after-late", 1, []),
        page("early", 2, [[54, 100, CONFIDENT]]),
      ],
      RANGE,
    );
    assert.deepEqual(
      result.pages.map((p) => p.id),
      ["early", "late", "after-late"],
    );
  });

  test("a numbered page keeps its numbers whatever the upload order", () => {
    const shapes = [
      (i: number) =>
        page("continuation", i, [
          [58, 1102, ONCE],
          [59, 1103, ONCE],
        ]),
      (i: number) =>
        page("p057-058", i, [
          [57, 258, CONFIDENT],
          [58, 1293, CONFIDENT],
        ]),
      (i: number) => page("p059", i, [[59, 1112, CONFIDENT]]),
    ];
    const runOrder = (order: readonly number[]) =>
      reconcilePoints(
        order.map((which, index) => shapes[which](index)),
        RANGE,
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
