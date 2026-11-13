import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { lessonMinutesFrom } from "./rules.ts";

describe("lessonMinutesFrom", () => {
  test("reads the record PostgREST sends, alone or in a list", () => {
    assert.equal(
      lessonMinutesFrom({ lesson_minutes: 50, slot_minutes: 60 }),
      50,
    );
    assert.equal(lessonMinutesFrom([{ lesson_minutes: 50 }]), 50);
  });

  test("anything else is null, never a guess", () => {
    for (const data of [
      null,
      undefined,
      [],
      "50",
      { lesson_minutes: "50" },
      { lesson_minutes: 0 },
      { lesson_minutes: 50.5 },
      {},
    ]) {
      assert.equal(lessonMinutesFrom(data), null, JSON.stringify(data));
    }
  });
});
