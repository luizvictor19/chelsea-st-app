import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NO_IMAGE,
  imageColumns,
  imageOfColumns,
  itemOf,
  sameImage,
  type ImageChoice,
} from "./question-image.ts";

const LAMP = "0b5c1f7e-3c0a-4a51-9d0e-6a4f2f1f0a11";
const BOX = "5a1d3c9e-2b4f-4e6a-8c0d-1e2f3a4b5c66";

describe("imageColumns", () => {
  test("every kind writes all three columns", () => {
    const kinds: ImageChoice[] = [
      NO_IMAGE,
      { kind: "word", id: LAMP },
      { kind: "scene", id: BOX },
      { kind: "acted" },
    ];
    for (const image of kinds) {
      const columns = imageColumns(image);
      assert.ok(columns !== null, image.kind);
      assert.deepEqual(Object.keys(columns).sort(), [
        "is_acted_out",
        "scene_id",
        "shown_vocabulary_item_id",
      ]);
    }
  });

  test("a word swapped for a scene writes the word null", () => {
    // Writing the scene alone would leave the word set, and
    // questions_one_image refuses a row with both.
    assert.deepEqual(imageColumns({ kind: "scene", id: BOX }), {
      shown_vocabulary_item_id: null,
      scene_id: BOX,
      is_acted_out: false,
    });
    assert.deepEqual(imageColumns({ kind: "word", id: LAMP }), {
      shown_vocabulary_item_id: LAMP,
      scene_id: null,
      is_acted_out: false,
    });
  });

  test("acted out writes the word and the scene null", () => {
    assert.deepEqual(imageColumns({ kind: "acted" }), {
      shown_vocabulary_item_id: null,
      scene_id: null,
      is_acted_out: true,
    });
  });

  test("none writes all three empty", () => {
    assert.deepEqual(imageColumns(NO_IMAGE), {
      shown_vocabulary_item_id: null,
      scene_id: null,
      is_acted_out: false,
    });
  });

  test("a word or a scene with no item is not written", () => {
    assert.equal(imageColumns({ kind: "word", id: null }), null);
    assert.equal(imageColumns({ kind: "scene", id: null }), null);
  });

  test("what is written reads back as the same choice", () => {
    for (const image of [
      NO_IMAGE,
      { kind: "word", id: LAMP },
      { kind: "scene", id: BOX },
      { kind: "acted" },
    ] satisfies ImageChoice[]) {
      const columns = imageColumns(image);
      assert.ok(columns !== null);
      assert.deepEqual(imageOfColumns(columns), image);
    }
  });
});

describe("sameImage", () => {
  test("the same kind with the same item", () => {
    assert.equal(sameImage(NO_IMAGE, { kind: "none" }), true);
    assert.equal(
      sameImage({ kind: "word", id: LAMP }, { kind: "word", id: LAMP }),
      true,
    );
  });

  test("another kind, or another item, is not the same", () => {
    // The same id under another kind cannot happen with real ids, and is
    // still a different choice.
    assert.equal(
      sameImage({ kind: "word", id: LAMP }, { kind: "scene", id: LAMP }),
      false,
    );
    assert.equal(
      sameImage({ kind: "scene", id: BOX }, { kind: "scene", id: null }),
      false,
    );
    assert.equal(sameImage(NO_IMAGE, { kind: "acted" }), false);
  });

  test("itemOf is the word or the scene, and null otherwise", () => {
    assert.equal(itemOf({ kind: "word", id: LAMP }), LAMP);
    assert.equal(itemOf({ kind: "scene", id: BOX }), BOX);
    assert.equal(itemOf({ kind: "acted" }), null);
    assert.equal(itemOf(NO_IMAGE), null);
  });
});
