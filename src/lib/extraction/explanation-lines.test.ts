import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { EXPLANATION_MAX_GAP } from "./constants.ts";
import { explanationLines } from "./explanation-lines.ts";
import {
  blankPage,
  inkLine,
  shadedBox,
  toBitmap,
  type MutablePage,
} from "./testing/synthetic-page.ts";

const WIDTH = 1100;
const BOX_LEFT = 120;
const COLUMN_RIGHT = 980;

function linesOf(draw: (page: MutablePage) => void) {
  const page = blankPage(WIDTH, 700);
  draw(page);
  return explanationLines(toBitmap(page));
}

describe("explanationLines", () => {
  test("criterion 7: a justified paragraph is found", () => {
    const lines = linesOf((page) => {
      inkLine(page, { left: BOX_LEFT, right: COLUMN_RIGHT, top: 100 });
      inkLine(page, { left: BOX_LEFT, right: COLUMN_RIGHT, top: 130 });
      inkLine(page, { left: BOX_LEFT, right: COLUMN_RIGHT, top: 160 });
    });
    assert.equal(lines.length, 3);
  });

  test("criterion 7: question and answer lines are not", () => {
    // Two columns always leave a wide hole in the middle of the line.
    const lines = linesOf((page) => {
      inkLine(page, {
        left: BOX_LEFT,
        right: COLUMN_RIGHT,
        top: 100,
        centreGap: 80,
      });
      inkLine(page, {
        left: BOX_LEFT,
        right: COLUMN_RIGHT,
        top: 130,
        centreGap: 80,
      });
    });
    assert.deepEqual(lines, []);
  });

  test("a line starting right of the text margin is not prose", () => {
    // The margin comes from the text, so prose has to be on the page for an
    // indented line to be indented against anything.
    const lines = linesOf((page) => {
      for (const top of [100, 130, 160]) {
        inkLine(page, { left: BOX_LEFT, right: COLUMN_RIGHT, top });
      }
      inkLine(page, { left: WIDTH / 2, right: COLUMN_RIGHT, top: 200 });
    });
    assert.equal(lines.length, 3, "only the three justified lines");
    assert.ok(lines.every((line) => line.top < 200));
  });

  test("word spacing is not a column gap", () => {
    const lines = linesOf((page) =>
      inkLine(page, {
        left: BOX_LEFT,
        right: COLUMN_RIGHT,
        top: 100,
        wordGap: EXPLANATION_MAX_GAP - 1,
      }),
    );
    assert.equal(lines.length, 1);
  });

  test("a gap one pixel over the limit disqualifies the line", () => {
    const lines = linesOf((page) =>
      inkLine(page, {
        left: BOX_LEFT,
        right: COLUMN_RIGHT,
        top: 100,
        centreGap: EXPLANATION_MAX_GAP + 1,
      }),
    );
    assert.deepEqual(lines, []);
  });

  test("panel text is reported here and de-duplicated later", () => {
    // Ink inside the panel is still ink: the letters themselves are dark, not
    // panel-coloured, so this stage sees them exactly as the reference
    // implementation does. Pinning that here on purpose. Dropping the overlap
    // is classify's job, where the box bands are known, and there is a test for
    // it there.
    const lines = linesOf((page) => {
      shadedBox(page, BOX_LEFT, 90, 60);
      inkLine(page, { left: BOX_LEFT, right: COLUMN_RIGHT, top: 110 });
    });
    assert.equal(lines.length, 1);
  });

  test("a blank page has no lines", () => {
    assert.deepEqual(
      linesOf(() => {}),
      [],
    );
  });
});
