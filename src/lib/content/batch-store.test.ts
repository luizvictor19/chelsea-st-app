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
    uploadIndex: 0,
    points: [116],
    inheritedPoint: null,
    duplicateOf: null,
    lessonNumber: null,
    disputes: [],
    unsupported: null,
    refused: false,
    blocks: [],
    savedPoints: [],
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
    pages: [page()],
    ...overrides,
  };
}

describe("staleness", () => {
  test("a batch read against the current range is usable", () => {
    assert.equal(staleness(batch(), 53, 128), null);
  });

  test("a batch read against another range is not", () => {
    // The batch may hold numbers that are now outside the book, and the review
    // would offer to write them.
    assert.equal(staleness(batch(), 40, 128), "range-changed");
    assert.equal(staleness(batch(), 53, 200), "range-changed");
    assert.equal(staleness(batch(), null, null), "range-changed");
  });

  test("a batch whose every page is written has nothing left", () => {
    // Resuming it would invite writing the whole thing a second time.
    const done = batch({ pages: [page({ savedPoints: [116] })] });
    assert.equal(staleness(done, 53, 128), "all-saved");
  });

  test("pages that were never going to be written do not keep a batch alive", () => {
    const nothingToDo = batch({
      pages: [
        page({ id: "dup.png", duplicateOf: "p116.png" }),
        page({ id: "rev.png", unsupported: "revision_exercise" }),
        page({ id: "photo.jpg", refused: true }),
      ],
    });
    assert.equal(staleness(nothingToDo, 53, 128), "all-saved");
  });

  test("one page still waiting keeps the batch alive", () => {
    const mixed = batch({
      pages: [page({ savedPoints: [116] }), page({ id: "p117.png" })],
    });
    assert.equal(staleness(mixed, 53, 128), null);
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
