import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  pendingCount,
  staleness,
  type StoredBatch,
  type StoredPage,
} from "./batch-store.ts";

function page(overrides: Partial<StoredPage> = {}): StoredPage {
  return {
    id: "p116.png",
    fileName: "p116.png",
    uploadIndex: 0,
    points: [116],
    placements: [{ number: 116, y: 80 }],
    inheritedPoint: null,
    precedingPoint: null,
    openingPoint: null,
    opensLesson: false,
    duplicateOf: null,
    lessonNumber: null,
    disputes: [],
    unsupported: null,
    refused: false,
    blocks: [],
    savedPoints: [],
    changedSinceSaving: false,
    pointStarts: [],
    ...overrides,
  };
}

function batch(overrides: Partial<StoredBatch> = {}): StoredBatch {
  return {
    bookId: "book-2",
    bookPosition: 2,
    firstPoint: 53,
    lastPoint: 128,
    readAt: "2026-09-05T10:00:00.000Z",
    extractionVersion: 1,
    pages: [page()],
    ...overrides,
  };
}

describe("staleness", () => {
  test("a batch read against the current range is usable", () => {
    assert.equal(staleness(batch(), 53, 128, 1), null);
  });

  test("a batch read against another range is not", () => {
    // The batch may hold numbers that are now outside the book, and the review
    // would offer to write them.
    assert.equal(staleness(batch(), 40, 128, 1), "range-changed");
    assert.equal(staleness(batch(), 53, 200, 1), "range-changed");
    assert.equal(staleness(batch(), null, null, 1), "range-changed");
  });

  test("a batch whose every page is written has nothing left", () => {
    // Resuming it would invite writing the whole thing a second time.
    const done = batch({ pages: [page({ savedPoints: [116] })] });
    assert.equal(staleness(done, 53, 128, 1), "all-saved");
  });

  test("pages that were never going to be written do not keep a batch alive", () => {
    const nothingToDo = batch({
      pages: [
        page({ id: "dup.png", duplicateOf: "p116.png" }),
        page({ id: "rev.png", unsupported: "revision_exercise" }),
        page({ id: "photo.jpg", refused: true }),
      ],
    });
    assert.equal(staleness(nothingToDo, 53, 128, 1), "all-saved");
  });

  test("a page written and then edited is still waiting", () => {
    // The edit only reaches the database by being confirmed again, so a batch
    // holding one is not finished, however many points it has already written.
    const edited = batch({
      pages: [page({ savedPoints: [116], changedSinceSaving: true })],
    });
    assert.equal(staleness(edited, 53, 128, 1), null);
    assert.equal(pendingCount(edited), 1);
  });

  test("one page still waiting keeps the batch alive", () => {
    const mixed = batch({
      pages: [page({ savedPoints: [116] }), page({ id: "p117.png" })],
    });
    assert.equal(staleness(mixed, 53, 128, 1), null);
  });
});

describe("what a restored batch must carry", () => {
  test("a spread keeps the height of each number and each block", () => {
    // A block belongs to the last number printed above it. Without the heights
    // a restored spread could only put everything on its first point, and it
    // would do it silently, which is the misfiling the whole design avoids.
    const spread = page({
      id: "p117-118.png",
      points: [117, 118],
      placements: [
        { number: 117, y: 80 },
        { number: 118, y: 1219 },
      ],
      blocks: [
        { kind: "vocabulary", content: "some", needsReview: false, top: 64 },
        {
          kind: "vocabulary",
          content: "love, hate",
          needsReview: false,
          top: 1240,
        },
      ],
    });
    assert.deepEqual(
      spread.placements.map((p) => p.y),
      [80, 1219],
    );
    assert.deepEqual(
      spread.blocks.map((b) => b.top),
      [64, 1240],
    );
  });

  test("two files called the same thing stay two pages", () => {
    // The identity used to be the file name, so a second photograph dropped in
    // under the same name became the same page: one draft for both, and the
    // rail pointing at the wrong row. The name is still carried, because it is
    // what the database records as the writer of a block.
    const first = page({ id: "IMG_0042.jpg", fileName: "IMG_0042.jpg" });
    const second = page({
      id: "IMG_0042.jpg (2)",
      fileName: "IMG_0042.jpg",
      points: [117],
    });
    assert.notEqual(first.id, second.id);
    assert.equal(first.fileName, second.fileName);
    assert.equal(
      new Set([first, second].map((one) => one.id)).size,
      2,
      "each uploaded file is its own page",
    );
  });
});

describe("pendingCount", () => {
  test("counts only what is still to be written", () => {
    const mixed = batch({
      pages: [
        page({ savedPoints: [116] }),
        page({ id: "p117.png" }),
        page({ id: "p118.png" }),
        page({ id: "dup.png", duplicateOf: "p116.png" }),
      ],
    });
    assert.equal(pendingCount(mixed), 2);
  });

  test("an empty batch has nothing pending", () => {
    assert.equal(pendingCount(batch({ pages: [] })), 0);
  });
});

describe("staleness against the extraction that read the batch", () => {
  test("a batch read by the extraction now running is usable", () => {
    assert.equal(staleness(batch({ extractionVersion: 4 }), 53, 128, 4), null);
  });

  test("a batch read by an earlier extraction is not", () => {
    // The pages were read by code that has since changed, so the blocks on the
    // screen are not the blocks this extraction would produce. Nothing else in
    // the batch says so: the range can be untouched and every page still
    // waiting, and the resume card offered it as though it were fresh.
    assert.equal(
      staleness(batch({ extractionVersion: 3 }), 53, 128, 4),
      "extraction-changed",
    );
  });

  test("a batch read by a later extraction is not either", () => {
    // Going backwards happens too, on a branch or a rollback, and the reading
    // is just as much not this one's.
    assert.equal(
      staleness(batch({ extractionVersion: 5 }), 53, 128, 4),
      "extraction-changed",
    );
  });

  test("a batch stored before the stamp existed is not", () => {
    // It was read by something, and there is no way to know what. Offering it
    // back on the grounds that it does not disagree is the guess this exists to
    // refuse.
    const { extractionVersion, ...unstamped } = batch();
    void extractionVersion;
    assert.equal(staleness(unstamped, 53, 128, 4), "extraction-changed");
  });

  test("a finished batch is finished, whatever read it", () => {
    // The one thing "extraction-changed" must not do. Every batch already in a
    // teacher's browser lacks the stamp, so on the first load after this ships
    // a fully written batch would be offered back for a re-upload and a second
    // review of pages that are already in the database. Uploading again does
    // not mend "all-saved": nothing is left to mend.
    const done = batch({
      extractionVersion: undefined,
      pages: [page({ savedPoints: [116], changedSinceSaving: false })],
    });
    assert.equal(staleness(done, 53, 128, 4), "all-saved");
  });

  test("an unwritten edit is still work, so the reading still matters", () => {
    const edited = batch({
      extractionVersion: 3,
      pages: [page({ savedPoints: [116], changedSinceSaving: true })],
    });
    assert.equal(staleness(edited, 53, 128, 4), "extraction-changed");
  });

  test("the extraction is asked before the range", () => {
    // Both are true and both are mended by uploading again, but the reading
    // being out of date is the deeper of the two: a batch read by another
    // extraction is suspect whatever range it was read against.
    assert.equal(
      staleness(batch({ extractionVersion: 3 }), 40, 128, 4),
      "extraction-changed",
    );
  });
});
