import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TARGET_WIDTH } from "./constants.ts";
import { boxLeft, crop, normalise, resize, shadedMask } from "./image.ts";
import {
  INK,
  PAGE_WHITE,
  PANEL,
  blankPage,
  fillRect,
  shadedBox,
  toBitmap,
} from "./testing/synthetic-page.ts";

function pixel(
  image: { width: number; data: Uint8ClampedArray },
  x: number,
  y: number,
) {
  const offset = (y * image.width + x) * 4;
  return [
    image.data[offset],
    image.data[offset + 1],
    image.data[offset + 2],
  ] as const;
}

describe("normalise", () => {
  test("brings a page to the reference width, keeping its proportions", () => {
    // Every fixture arrives around 519px, which is the case that matters.
    const result = normalise(toBitmap(blankPage(519, 776)));
    assert.equal(result.width, TARGET_WIDTH);
    assert.equal(result.height, Math.round((776 * TARGET_WIDTH) / 519));
  });

  test("a page already at the reference width is handed back untouched", () => {
    const page = toBitmap(blankPage(TARGET_WIDTH, 400));
    assert.equal(normalise(page), page);
  });

  test("the teacher's zoom stops mattering: two scans agree after normalising", () => {
    // Criterion 4 rests on this. The same page at two widths has to reduce to
    // the same geometry, or re-uploading it would produce different boxes.
    const draw = (width: number, height: number) => {
      const page = blankPage(width, height);
      shadedBox(
        page,
        Math.round(width * 0.11),
        Math.round(height * 0.2),
        Math.round(height * 0.1),
      );
      return normalise(toBitmap(page));
    };
    const small = draw(519, 776);
    const large = draw(534, 799);
    assert.equal(small.width, large.width);
    assert.ok(Math.abs(small.height - large.height) <= 2);

    const leftSmall = boxLeft(shadedMask(small));
    const leftLarge = boxLeft(shadedMask(large));
    assert.ok(
      Math.abs(leftSmall - leftLarge) <= 3,
      `box_left drifted: ${leftSmall} against ${leftLarge}`,
    );
  });
});

describe("resize", () => {
  test("a flat colour survives resampling exactly", () => {
    // Lanczos overshoots at edges; a uniform field must not drift, or the
    // shaded-panel test would start missing panels.
    const page = blankPage(200, 100, PANEL);
    const result = resize(toBitmap(page), 700, 350);
    assert.deepEqual(pixel(result, 350, 175), [...PANEL]);
    assert.deepEqual(pixel(result, 0, 0), [...PANEL]);
  });

  test("resizing to the same size is a no-op", () => {
    const page = toBitmap(blankPage(50, 50));
    assert.equal(resize(page, 50, 50), page);
  });
});

describe("shadedMask", () => {
  test("marks the panel and nothing else", () => {
    const page = blankPage(100, 60);
    fillRect(page, 20, 10, 40, 20, PANEL);
    fillRect(page, 20, 40, 40, 10, INK);
    const mask = shadedMask(toBitmap(page));

    assert.equal(mask.data[15 * 100 + 30], 1, "panel");
    assert.equal(mask.data[5 * 100 + 30], 0, "page white");
    assert.equal(mask.data[45 * 100 + 30], 0, "ink");
  });

  test("white is not a shade, however slightly blue", () => {
    const page = blankPage(10, 10, [252, 253, 255]);
    assert.equal(shadedMask(toBitmap(page)).data[55], 0);
  });
});

describe("boxLeft", () => {
  test("is the leftmost shaded column", () => {
    const page = blankPage(400, 200);
    shadedBox(page, 88, 50, 40);
    assert.equal(boxLeft(shadedMask(toBitmap(page))), 88);
  });

  test("falls back to a tenth of the width when there is no panel at all", () => {
    // A dictation page carries no panel and still has to be readable.
    const page = blankPage(400, 200, PAGE_WHITE);
    assert.equal(boxLeft(shadedMask(toBitmap(page))), 40);
  });
});

describe("crop", () => {
  test("takes the requested rectangle", () => {
    const page = blankPage(100, 100);
    fillRect(page, 10, 10, 10, 10, INK);
    const result = crop(toBitmap(page), 10, 10, 20, 20);
    assert.equal(result.width, 10);
    assert.equal(result.height, 10);
    assert.deepEqual(pixel(result, 5, 5), [...INK]);
  });

  test("refuses a rectangle it cannot honour, naming it", () => {
    // Returning an empty bitmap here used to move the failure into a canvas
    // call somewhere else, which reported a zero width and nothing about the
    // crop that caused it.
    const page = toBitmap(blankPage(50, 50));
    assert.throws(
      () => crop(page, 40, 40, 999, 999),
      /\[40, 40, 999, 999\].*50x50/,
    );
    assert.throws(() => crop(page, 0, 0, 0, 10), /\[0, 0, 0, 10\]/);
    assert.throws(() => crop(page, -1, 0, 10, 10), /\[-1, 0, 10, 10\]/);
  });
});
