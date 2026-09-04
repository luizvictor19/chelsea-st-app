import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { boxes } from "./boxes.ts";
import { MERGE_GAP, MIN_BOX_HEIGHT, TABLE_HEIGHT } from "./constants.ts";
import { shadedMask } from "./image.ts";
import { blankPage, shadedBox, toBitmap } from "./testing/synthetic-page.ts";

const WIDTH = 1100;
const BOX_LEFT = 120;

function bandsOf(draw: (page: ReturnType<typeof blankPage>) => void) {
  const page = blankPage(WIDTH, 900);
  draw(page);
  return boxes(shadedMask(toBitmap(page)));
}

describe("boxes", () => {
  test("finds a plain shaded panel", () => {
    const bands = bandsOf((page) => shadedBox(page, BOX_LEFT, 100, 60));
    assert.equal(bands.length, 1);
    assert.deepEqual(bands[0], { top: 100, bottom: 160 });
  });

  test("criterion 6: a panel split by dense text is rejoined into one box", () => {
    // A line packed with words drops below the shaded-row fraction, so a single
    // panel arrives as two runs with a thin gap. Left alone it would be ingested
    // twice, each half holding part of the content.
    const gap = MERGE_GAP - 4;
    const bands = bandsOf((page) => {
      shadedBox(page, BOX_LEFT, 100, 80);
      shadedBox(page, BOX_LEFT, 100 + 80 + gap, 80);
    });

    assert.equal(bands.length, 1, "the two runs must come back as one box");
    assert.deepEqual(bands[0], { top: 100, bottom: 100 + 80 + gap + 80 });
  });

  test("two genuinely separate panels stay separate", () => {
    const gap = MERGE_GAP + 4;
    const bands = bandsOf((page) => {
      shadedBox(page, BOX_LEFT, 100, 80);
      shadedBox(page, BOX_LEFT, 100 + 80 + gap, 80);
    });
    assert.equal(bands.length, 2);
  });

  test("an underline artifact is below the minimum height and dropped", () => {
    const bands = bandsOf((page) =>
      shadedBox(page, BOX_LEFT, 100, MIN_BOX_HEIGHT - 1),
    );
    assert.deepEqual(bands, []);
  });

  test("a band exactly at the minimum height is kept", () => {
    const bands = bandsOf((page) =>
      shadedBox(page, BOX_LEFT, 100, MIN_BOX_HEIGHT),
    );
    assert.equal(bands.length, 1);
  });

  test("a merge may not resurrect two bands that are each too short", () => {
    // Two 20px slivers a few pixels apart merge to 44px and survive. That is
    // the intended order: merge first, then judge the height of the whole.
    const bands = bandsOf((page) => {
      shadedBox(page, BOX_LEFT, 100, 20);
      shadedBox(page, BOX_LEFT, 124, 20);
    });
    assert.equal(bands.length, 1);
    assert.equal(bands[0].bottom - bands[0].top, 44);
  });

  test("a table is tall enough to be flagged, a vocabulary panel is not", () => {
    const bands = bandsOf((page) => {
      shadedBox(page, BOX_LEFT, 40, 60);
      shadedBox(page, BOX_LEFT, 300, TABLE_HEIGHT + 40);
    });
    assert.equal(bands.length, 2);
    assert.ok(bands[0].bottom - bands[0].top <= TABLE_HEIGHT);
    assert.ok(bands[1].bottom - bands[1].top > TABLE_HEIGHT);
  });

  test("a page with no panel at all yields nothing", () => {
    assert.deepEqual(
      bandsOf(() => {}),
      [],
    );
  });
});
