import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  descriptionKey,
  firstPoint,
  groupLabel,
  groupScenes,
  isDescriptionTaken,
} from "./scenes.ts";

function scene(id: string, description: string, questionPoints: number[]) {
  return { id, description, questionPoints };
}

describe("groupScenes", () => {
  test("groups by the first point, in book order, unused scenes last", () => {
    const groups = groupScenes([
      scene("free", "a cat", []),
      scene("late", "a pen on the book", [30]),
      scene("early", "a big box", [12]),
    ]);
    assert.deepEqual(
      groups.map((group) => [group.point, group.scenes.map((s) => s.id)]),
      [
        [12, ["early"]],
        [30, ["late"]],
        [null, ["free"]],
      ],
    );
  });

  test("a scene two questions use is filed at the earlier point", () => {
    assert.equal(firstPoint(scene("x", "a big box", [30, 12, 41])), 12);
    const groups = groupScenes([scene("x", "a big box", [30, 12])]);
    assert.equal(groups[0]?.point, 12);
  });

  test("inside a group, by description, case aside", () => {
    const groups = groupScenes([
      scene("b", "Big box", [5]),
      scene("a", "a small box", [5]),
      scene("c", "chairs", [5]),
    ]);
    assert.deepEqual(
      groups[0]?.scenes.map((s) => s.id),
      ["a", "b", "c"],
    );
  });

  test("nothing to group is no group", () => {
    assert.deepEqual(groupScenes([]), []);
  });
});

describe("groupLabel", () => {
  test("names the point, or says no question uses it", () => {
    assert.equal(groupLabel(12), "Ponto 12");
    assert.equal(groupLabel(null), "Sem pergunta ainda");
  });
});

describe("isDescriptionTaken", () => {
  test("only the unique violation on scenes_description_key", () => {
    const taken = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "scenes_description_key"',
    };
    assert.ok(isDescriptionTaken(taken));
    assert.ok(
      !isDescriptionTaken({
        code: "23505",
        message: 'duplicate key value violates unique constraint "scenes_pkey"',
      }),
    );
    assert.ok(!isDescriptionTaken({ ...taken, code: "23514" }));
    assert.ok(!isDescriptionTaken({ code: null, message: taken.message }));
  });
});

describe("descriptionKey", () => {
  test("compares as scenes_description_key does", () => {
    // lower(btrim(regexp_replace(description, '\s+', ' ', 'g'))) in 0030.
    assert.equal(descriptionKey(" A  big\tbox "), "a big box");
    assert.equal(descriptionKey("Big box"), descriptionKey("big   box"));
    assert.notEqual(descriptionKey("big box"), descriptionKey("big boxes"));
  });
});
