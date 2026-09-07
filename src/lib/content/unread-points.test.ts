import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { pointForBlock } from "../extraction/pipeline.ts";
import type { Placement } from "../extraction/reconcile.ts";
import {
  answeredNumbers,
  pendingNumbers,
  startPlacements,
  unplacedCause,
  unreadNumbers,
  type PointStart,
} from "./unread-points.ts";

/*
 * The real page this exists for: book 1, points 6 and 7 printed in the margin,
 * the 6 never read. Eight blocks, six of them above the 7. Block 1 is point 5,
 * blocks 2 to 6 are point 6, blocks 7 and 8 are point 7. The heights are the
 * ones scripts/dump-block-points.ts reports for it.
 */
const PLACEMENTS: readonly Placement[] = [{ number: 7, y: 1008 }];
const OPENING = { precedingPoint: 5, openingPoint: 5 };
const TOPS = [65, 320, 405, 758, 839, 913, 1090, 1209] as const;

describe("unreadNumbers", () => {
  test("names the number the book printed and nothing read", () => {
    assert.deepEqual(unreadNumbers(OPENING, PLACEMENTS), [6]);
  });

  test("names both when two numbers in a row went unread", () => {
    assert.deepEqual(
      unreadNumbers({ precedingPoint: 4, openingPoint: 4 }, PLACEMENTS),
      [5, 6],
    );
  });

  test("nothing is missing when the page opens on the next point", () => {
    assert.deepEqual(
      unreadNumbers({ precedingPoint: 6, openingPoint: 6 }, PLACEMENTS),
      [],
    );
  });

  test("a page with no page before it is asked nothing", () => {
    // Not this question. Nothing precedes it in the book, so there is no
    // interval to count over: what it needs is the page before, not an answer.
    assert.deepEqual(
      unreadNumbers({ precedingPoint: null, openingPoint: null }, PLACEMENTS),
      [],
    );
  });

  test("a page carrying no number at all is asked nothing", () => {
    assert.deepEqual(unreadNumbers(OPENING, []), []);
  });

  test("a first number below the point before is not a gap", () => {
    // Out of order, so the interval is empty rather than negative. It is a
    // misreading and not a number nobody read, and inventing a list here would
    // ask the teacher to place points that are not missing.
    assert.deepEqual(
      unreadNumbers({ precedingPoint: 9, openingPoint: 9 }, PLACEMENTS),
      [],
    );
  });
});

describe("pendingNumbers", () => {
  test("every missing number is pending before anything is answered", () => {
    assert.deepEqual(pendingNumbers([5, 6], []), [5, 6]);
  });

  test("a number placed at a block is answered", () => {
    assert.deepEqual(pendingNumbers([5, 6], [{ number: 6, top: 320 }]), [5]);
  });

  test('"it does not start on this page" is an answer too', () => {
    // The explicit way out. Without it the screen forces a wrong answer
    // whenever the missing number really is printed somewhere else.
    assert.deepEqual(pendingNumbers([6], [{ number: 6, top: null }]), []);
  });

  test("an answer to a number that is not missing does not count", () => {
    assert.deepEqual(pendingNumbers([6], [{ number: 4, top: 320 }]), [6]);
  });
});

describe("startPlacements", () => {
  test("an answered start is a number printed at that block's top", () => {
    assert.deepEqual(startPlacements([{ number: 6, top: 320 }]), [
      { number: 6, y: 320 },
    ]);
  });

  test('"not on this page" places nothing', () => {
    assert.deepEqual(startPlacements([{ number: 6, top: null }]), []);
  });
});

describe("answeredNumbers", () => {
  test("only the ones given a block, which are the ones the page writes", () => {
    assert.deepEqual(
      answeredNumbers([
        { number: 5, top: null },
        { number: 6, top: 320 },
      ]),
      [6],
    );
  });
});

describe("the answer as pointForBlock reads it", () => {
  const filed = (starts: readonly PointStart[]) => {
    const placements = [...PLACEMENTS, ...startPlacements(starts)].sort(
      (a, b) => a.y - b.y,
    );
    return TOPS.map((top) => pointForBlock(placements, top, OPENING));
  };

  test("nothing is filed while the question is unanswered", () => {
    assert.deepEqual(filed([]), [null, null, null, null, null, null, 7, 7]);
  });

  test("the answer files every block of the page", () => {
    // Point 6 starts at the second block. The first is then the only thing on
    // the page printed under point 5, and the four after it carry on in 6.
    assert.deepEqual(
      filed([{ number: 6, top: 320 }]),
      [5, 6, 6, 6, 6, 6, 7, 7],
    );
  });

  test("the first block is a valid answer: nothing here is the point before", () => {
    assert.deepEqual(filed([{ number: 6, top: 65 }]), [6, 6, 6, 6, 6, 6, 7, 7]);
  });

  test('"not on this page" leaves the page exactly as it was', () => {
    assert.deepEqual(filed([{ number: 6, top: null }]), [
      null,
      null,
      null,
      null,
      null,
      null,
      7,
      7,
    ]);
  });

  test("two unread numbers in a row are placed independently", () => {
    const opening = { precedingPoint: 4, openingPoint: 4 };
    const placements = [
      ...PLACEMENTS,
      ...startPlacements([
        { number: 5, top: 320 },
        { number: 6, top: 839 },
      ]),
    ].sort((a, b) => a.y - b.y);
    assert.deepEqual(
      TOPS.map((top) => pointForBlock(placements, top, opening)),
      [4, 5, 5, 5, 6, 6, 7, 7],
    );
  });
});

describe("unplacedCause", () => {
  test("nothing is wrong when every block is filed", () => {
    assert.equal(unplacedCause(OPENING, PLACEMENTS, [], 0), null);
  });

  test("a page nothing precedes needs the page before it", () => {
    assert.deepEqual(
      unplacedCause({ precedingPoint: null, openingPoint: null }, [], [], 3),
      { kind: "no-page-before" },
    );
  });

  test("with the page before in hand, the number is the one nobody read", () => {
    // The message this replaces led with "upload the previous page" on exactly
    // this page, whose previous page is where the point above it came from.
    assert.deepEqual(unplacedCause(OPENING, PLACEMENTS, [], 6), {
      kind: "unread-numbers",
      numbers: [6],
    });
  });

  test("answered numbers drop out of the question", () => {
    assert.deepEqual(
      unplacedCause(
        { precedingPoint: 4, openingPoint: 4 },
        PLACEMENTS,
        [{ number: 5, top: 320 }],
        1,
      ),
      { kind: "unread-numbers", numbers: [6] },
    );
  });

  test('answering "not here" for all of them points at another page', () => {
    assert.deepEqual(
      unplacedCause(OPENING, PLACEMENTS, [{ number: 6, top: null }], 6),
      { kind: "elsewhere", numbers: [6] },
    );
  });

  test("no gap and a page before it: no cause is invented", () => {
    // Nothing on the page can name one, so it says the only thing it knows
    // rather than blaming a number that is not missing.
    assert.deepEqual(
      unplacedCause({ precedingPoint: 6, openingPoint: 6 }, PLACEMENTS, [], 1),
      { kind: "no-page-before" },
    );
  });
});
