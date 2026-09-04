import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MARGIN_GROUP_Y_TOLERANCE } from "./constants.ts";
import { reconcilePoints, type PageReadings } from "./reconcile.ts";

const CEILING = 128;

function page(
  id: string,
  uploadIndex: number,
  readings: readonly [number, number][],
): PageReadings {
  return {
    id,
    uploadIndex,
    readings: readings.map(([value, y]) => ({ value, y })),
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

  test("two positions equally certain of the same value are both asked about", () => {
    // Measured on the real set: a continuation page reads 53 and 54 at two
    // separate positions, exactly as the page that carries them does. Nothing
    // in the batch tells them apart, and whichever the loop reached first would
    // win by iteration order alone. Both are questions instead.
    const result = reconcilePoints(
      [
        page("p053-054", 0, [
          [53, 173],
          [54, 1275],
        ]),
        page("continuation", 1, [
          [53, 228],
          [54, 1280],
        ]),
      ],
      CEILING,
    );
    assert.equal(result.needsReview, true);
    assert.deepEqual(pointsById(result), { "p053-054": [], continuation: [] });
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

  test("the result does not depend on the order pages arrived in", () => {
    const build = (order: readonly number[]) =>
      reconcilePoints(
        order.map((n, i) =>
          n === 0
            ? page("continuation", i, [
                [58, 300],
                [59, 700],
              ])
            : n === 1
              ? page("p057-058", i, [
                  [57, 200],
                  [58, 900],
                ])
              : page("p059", i, [[59, 200]]),
        ),
        CEILING,
      );
    assert.deepEqual(
      pointsById(build([0, 1, 2])),
      pointsById(build([2, 0, 1])),
    );
  });
});
