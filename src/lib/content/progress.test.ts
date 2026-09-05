import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { gaps, pointsInRange, progress } from "./progress.ts";

describe("criterion 3: gaps in the sequence are missing pages", () => {
  test("a hole between filled points is reported", () => {
    // The batch went up without the pages holding 84 to 88.
    const filled = [...range(53, 83), ...range(89, 128)];
    const points = pointsInRange(filled, 1, 128);
    assert.deepEqual(gaps(points), [{ from: 84, to: 88 }]);
  });

  test("points not reached yet are not a hole", () => {
    // Everything after the last upload is simply not done, and calling it
    // missing would report most of the book on the first upload.
    const points = pointsInRange(range(1, 10), 1, 128);
    assert.deepEqual(gaps(points), []);
  });

  test("points before the first upload are not a hole either", () => {
    const points = pointsInRange(range(53, 128), 1, 128);
    assert.deepEqual(gaps(points), []);
  });

  test("several holes are reported separately", () => {
    const points = pointsInRange([1, 2, 5, 6, 10], 1, 12);
    assert.deepEqual(gaps(points), [
      { from: 3, to: 4 },
      { from: 7, to: 9 },
    ]);
  });

  test("a book with nothing uploaded has no holes", () => {
    assert.deepEqual(gaps(pointsInRange([], 1, 128)), []);
  });
});

describe("criterion 1: the bar counts filled against the ceiling", () => {
  test("a fresh ceiling reads zero of its total", () => {
    const points = pointsInRange([], 1, 128);
    assert.equal(points.length, 128);
    assert.deepEqual(progress(points, 1, 128), {
      filled: 0,
      total: 128,
      remaining: 128,
      fraction: 0,
    });
  });

  test("a book with no ceiling is not configured", () => {
    assert.deepEqual(pointsInRange([], null, null), []);
    assert.deepEqual(progress([], null, null), {
      filled: 0,
      total: 0,
      remaining: 0,
      fraction: 0,
    });
  });

  test("progress counts only filled points", () => {
    const points = pointsInRange(range(1, 32), 1, 128);
    assert.equal(progress(points, 1, 128).filled, 32);
    assert.equal(progress(points, 1, 128).fraction, 0.25);
  });
});

describe("a book that does not start at 1", () => {
  test("progress counts across the span, not up to the last point", () => {
    // Book 5 runs 250 to 320: seventy-one points, not three hundred and twenty.
    const points = pointsInRange(range(250, 285), 250, 320);
    assert.equal(points.length, 71);
    assert.deepEqual(progress(points, 250, 320), {
      filled: 36,
      total: 71,
      remaining: 35,
      fraction: 36 / 71,
    });
  });

  test("the list starts at the book's first point", () => {
    const points = pointsInRange([], 250, 252);
    assert.deepEqual(
      points.map((p) => p.number),
      [250, 251, 252],
    );
  });

  test("a hole inside the span is still a hole", () => {
    const points = pointsInRange([250, 251, 254, 255], 250, 255);
    assert.deepEqual(gaps(points), [{ from: 252, to: 253 }]);
  });

  test("an inverted or missing range configures nothing", () => {
    assert.deepEqual(pointsInRange([], 300, 260), []);
    assert.deepEqual(pointsInRange([], null, 320), []);
    assert.deepEqual(pointsInRange([], 250, null), []);
  });
});

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

describe("what makes a book complete", () => {
  test("every point of the range filled, and not merely having a range", () => {
    // Typing a range takes ten seconds and says nothing about how much of the
    // course is in the product, which is the only thing the index is asked.
    const whole = pointsInRange(range(53, 128), 53, 128);
    assert.equal(
      whole.every((point) => point.filled),
      true,
    );

    const nearly = pointsInRange(range(53, 127), 53, 128);
    assert.equal(
      nearly.every((point) => point.filled),
      false,
      "one point short is not complete",
    );

    const configuredOnly = pointsInRange([], 53, 128);
    assert.equal(
      configuredOnly.length > 0 && configuredOnly.every((p) => p.filled),
      false,
      "a range with nothing in it is not complete",
    );
  });

  test("a book with no range is not complete either", () => {
    const none = pointsInRange([], null, null);
    assert.equal(none.length > 0 && none.every((p) => p.filled), false);
  });
});
