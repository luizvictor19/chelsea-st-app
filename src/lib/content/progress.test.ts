import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { gaps, pointsUpTo, progress } from "./progress.ts";

describe("criterion 3: gaps in the sequence are missing pages", () => {
  test("a hole between filled points is reported", () => {
    // The batch went up without the pages holding 84 to 88.
    const filled = [...range(53, 83), ...range(89, 128)];
    const points = pointsUpTo(filled, 128);
    assert.deepEqual(gaps(points), [{ from: 84, to: 88 }]);
  });

  test("points not reached yet are not a hole", () => {
    // Everything after the last upload is simply not done, and calling it
    // missing would report most of the book on the first upload.
    const points = pointsUpTo(range(1, 10), 128);
    assert.deepEqual(gaps(points), []);
  });

  test("points before the first upload are not a hole either", () => {
    const points = pointsUpTo(range(53, 128), 128);
    assert.deepEqual(gaps(points), []);
  });

  test("several holes are reported separately", () => {
    const points = pointsUpTo([1, 2, 5, 6, 10], 12);
    assert.deepEqual(gaps(points), [
      { from: 3, to: 4 },
      { from: 7, to: 9 },
    ]);
  });

  test("a book with nothing uploaded has no holes", () => {
    assert.deepEqual(gaps(pointsUpTo([], 128)), []);
  });
});

describe("criterion 1: the bar counts filled against the ceiling", () => {
  test("a fresh ceiling reads zero of its total", () => {
    const points = pointsUpTo([], 128);
    assert.equal(points.length, 128);
    assert.deepEqual(progress(points, 128), {
      filled: 0,
      total: 128,
      fraction: 0,
    });
  });

  test("a book with no ceiling is not configured", () => {
    assert.deepEqual(pointsUpTo([], null), []);
    assert.deepEqual(progress([], null), { filled: 0, total: 0, fraction: 0 });
  });

  test("progress counts only filled points", () => {
    const points = pointsUpTo(range(1, 32), 128);
    assert.equal(progress(points, 128).filled, 32);
    assert.equal(progress(points, 128).fraction, 0.25);
  });
});

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}
