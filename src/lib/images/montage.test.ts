import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MONTAGE_SIDE,
  montageFilename,
  montageLayout,
  type Placement,
  type Size,
} from "./montage.ts";

const SQUARE = { width: 1800, height: 1800 };
const TALL = { width: 600, height: 1800 };
const WIDE = { width: 1800, height: 900 };

function inside(placement: Placement, side: number): boolean {
  return (
    placement.x >= 0 &&
    placement.y >= 0 &&
    placement.x + placement.width <= side &&
    placement.y + placement.height <= side
  );
}

function overlap(a: Placement, b: Placement): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function ratio(size: Size): number {
  return size.width / size.height;
}

describe("montageLayout", () => {
  for (const sizes of [
    [SQUARE, SQUARE],
    [TALL, WIDE],
    [WIDE, TALL, SQUARE],
    [SQUARE, TALL, WIDE, SQUARE],
  ]) {
    test(`${sizes.length} pictures stay inside the square and apart`, () => {
      const placed = montageLayout(sizes, MONTAGE_SIDE);
      assert.equal(placed.length, sizes.length);
      for (const placement of placed) {
        assert.ok(inside(placement, MONTAGE_SIDE), JSON.stringify(placement));
      }
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          assert.ok(!overlap(placed[i], placed[j]), `${i} overlaps ${j}`);
        }
      }
    });

    test(`${sizes.length} pictures keep their shape, none cropped`, () => {
      const placed = montageLayout(sizes, MONTAGE_SIDE);
      placed.forEach((placement, i) => {
        // Rounding to whole pixels moves the ratio by under 1%.
        assert.ok(
          Math.abs(ratio(placement) / ratio(sizes[i]) - 1) < 0.01,
          `${i}: ${ratio(placement)} against ${ratio(sizes[i])}`,
        );
      });
    });
  }

  test("two and three go in one row, left to right", () => {
    const [a, b, c] = montageLayout([SQUARE, SQUARE, SQUARE], MONTAGE_SIDE);
    assert.ok(a.x < b.x && b.x < c.x);
    assert.equal(a.y, b.y);
    assert.equal(b.y, c.y);
  });

  test("four go in a 2×2 grid, in reading order", () => {
    const [a, b, c, d] = montageLayout(
      [SQUARE, SQUARE, SQUARE, SQUARE],
      MONTAGE_SIDE,
    );
    assert.equal(a.y, b.y);
    assert.equal(c.y, d.y);
    assert.ok(a.y < c.y);
    assert.equal(a.x, c.x);
    assert.ok(a.x < b.x);
  });

  test("a picture fills its cell along the side that limits it", () => {
    // Two squares in a row: each as wide as its cell, so the row is used.
    const [a] = montageLayout([SQUARE, SQUARE], MONTAGE_SIDE);
    const margin = Math.round(MONTAGE_SIDE * 0.04);
    assert.equal(a.width, Math.floor((MONTAGE_SIDE - margin * 3) / 2));
  });

  test("one picture, or five, is refused", () => {
    assert.throws(() => montageLayout([SQUARE], MONTAGE_SIDE), /2 to 4/);
    assert.throws(
      () => montageLayout([SQUARE, SQUARE, SQUARE, SQUARE, SQUARE], 1536),
      /2 to 4/,
    );
  });
});

describe("montageFilename", () => {
  test("names the pictures it was made of, in order", () => {
    assert.equal(montageFilename(["pen", "book"]), "lado-a-lado-pen-book.jpg");
    assert.equal(
      montageFilename(["a big box", "the cat"]),
      "lado-a-lado-a-big-box-the-cat.jpg",
    );
  });

  test("no accent, space or symbol survives", () => {
    assert.equal(
      montageFilename(["Café  à la carte!", "it's"]),
      "lado-a-lado-cafe-a-la-carte-it-s.jpg",
    );
  });

  test("a long description is cut, and a label with nothing left drops", () => {
    const name = montageFilename([
      "a very long description of a scene that goes on",
      "???",
    ]);
    assert.equal(name, "lado-a-lado-a-very-long-description-of-a-s.jpg");
  });
});
