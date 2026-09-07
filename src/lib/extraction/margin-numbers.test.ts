import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MARGIN_MAX_DIGITS,
  MARGIN_READ_CONFIGS,
  MARGIN_RIGHT_TOLERANCE,
  MARGIN_UPSCALE,
} from "./constants.ts";
import { marginNumbers } from "./margin-numbers.ts";
import { blankPage, toBitmap } from "./testing/synthetic-page.ts";
import type { OcrReader, OcrWord } from "./types.ts";

const BOX_LEFT = 120;

function word(text: string, pageX: number, pageY: number): OcrWord {
  // The reader is handed the enlarged strip, so it answers in enlarged
  // coordinates. Placing words in page coordinates here keeps the tests
  // readable and exercises the conversion back.
  return {
    text,
    x: pageX * MARGIN_UPSCALE,
    y: pageY * MARGIN_UPSCALE,
    width: text.length * 8 * MARGIN_UPSCALE,
    height: 10 * MARGIN_UPSCALE,
    confidence: 0,
    symbols: [],
  };
}

/** An engine that answers with a fixed script, keyed by segmentation mode. */
function scriptedReader(
  script: Record<number, readonly OcrWord[]>,
): OcrReader & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    async read(_image, options) {
      const mode = options?.pageSegmentation ?? -1;
      calls.push(mode);
      return script[mode] ?? [];
    },
  };
}

const page = toBitmap(blankPage(1100, 800));

describe("marginNumbers", () => {
  test("reads a number from the margin and reports it in page coordinates", async () => {
    const reader = scriptedReader({ 6: [word("57", 40, 210)] });
    const found = await marginNumbers(page, BOX_LEFT, reader);
    assert.deepEqual(found, [{ value: 57, y: 210 }]);
  });

  test("uses every configured crop and segmentation mode", async () => {
    // No single combination finds every number; the union is the point.
    const reader = scriptedReader({});
    await marginNumbers(page, BOX_LEFT, reader);
    assert.equal(reader.calls.length, MARGIN_READ_CONFIGS.length);
    assert.deepEqual(
      [...reader.calls].sort(),
      MARGIN_READ_CONFIGS.map((c) => c.pageSegmentation).sort(),
    );
  });

  test("unions the configurations, keeping the first position seen", async () => {
    const reader = scriptedReader({
      6: [word("90", 40, 100)],
      11: [word("90", 40, 555), word("91", 40, 400)],
    });
    const found = await marginNumbers(page, BOX_LEFT, reader);
    assert.deepEqual(found, [
      { value: 90, y: 100 },
      { value: 91, y: 400 },
    ]);
  });

  test("ignores a number that starts level with the text column", async () => {
    // The ruler runs down the margin. A number out in the column is page
    // content, such as a numbered example.
    const reader = scriptedReader({
      6: [word("7", BOX_LEFT - MARGIN_RIGHT_TOLERANCE, 300)],
    });
    assert.deepEqual(await marginNumbers(page, BOX_LEFT, reader), []);
  });

  test("keeps a number just inside the margin", async () => {
    const reader = scriptedReader({
      6: [word("7", BOX_LEFT - MARGIN_RIGHT_TOLERANCE - 1, 300)],
    });
    assert.equal((await marginNumbers(page, BOX_LEFT, reader)).length, 1);
  });

  test("drops a run of digits too long to be a point number", async () => {
    const reader = scriptedReader({
      6: [word("1".repeat(MARGIN_MAX_DIGITS + 1), 40, 100)],
    });
    assert.deepEqual(await marginNumbers(page, BOX_LEFT, reader), []);
  });

  test("strips stray non-digits rather than discarding the reading", async () => {
    const reader = scriptedReader({ 6: [word("1O9.", 40, 100)] });
    assert.deepEqual(await marginNumbers(page, BOX_LEFT, reader), [
      { value: 19, y: 100 },
    ]);
  });

  test("returns readings ordered down the page", async () => {
    const reader = scriptedReader({
      6: [word("94", 40, 600), word("93", 40, 120)],
    });
    const found = await marginNumbers(page, BOX_LEFT, reader);
    assert.deepEqual(
      found.map((f) => f.value),
      [93, 94],
    );
  });

  test("noise is returned, not filtered, because confidence cannot judge it", async () => {
    // A legitimate 123 came back with confidence 0 and a spurious 1 with 68, so
    // this stage reports what it saw and the sequence filter decides.
    const reader = scriptedReader({
      6: [word("74", 40, 300), word("45", 40, 90)],
    });
    const found = await marginNumbers(page, BOX_LEFT, reader);
    assert.deepEqual(
      found.map((f) => f.value),
      [45, 74],
    );
  });
});
