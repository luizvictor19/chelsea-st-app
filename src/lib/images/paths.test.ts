import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { attemptPath, referencePath } from "./paths.ts";

const WORD = { kind: "word", id: "w1" } as const;
const SCENE = { kind: "scene", id: "s1" } as const;

describe("bucket paths", () => {
  test("a word's picture and reference stay where they have always been", () => {
    assert.equal(attemptPath(WORD, "a1", "png"), "w1/a1.png");
    assert.equal(referencePath(WORD, "r1", "jpg"), "references/w1/r1.jpg");
  });

  test("a scene's go under scenes/, its reference still under references/", () => {
    assert.equal(attemptPath(SCENE, "a1", "webp"), "scenes/s1/a1.webp");
    assert.equal(
      referencePath(SCENE, "r1", "png"),
      "references/scenes/s1/r1.png",
    );
  });

  test("no picture path starts with references/", () => {
    // scenes_image_path_not_reference (0030) and its word twin refuse one.
    for (const owner of [WORD, SCENE]) {
      assert.ok(!attemptPath(owner, "a1", "png").startsWith("references/"));
    }
  });
});
