import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { bookHorizonWeeksFrom, lessonMinutesFrom } from "./rules.ts";

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

describe("bookHorizonWeeksFrom", () => {
  test("reads the interval in days, in whole weeks rounded up", () => {
    assert.equal(bookHorizonWeeksFrom({ book_opens_ahead: "56 days" }), 8);
    assert.equal(bookHorizonWeeksFrom([{ book_opens_ahead: "P57D" }]), 9);
    assert.equal(bookHorizonWeeksFrom({ book_opens_ahead: "1 day" }), 1);
  });

  test("any other shape is null", () => {
    for (const data of [
      null,
      [],
      {},
      { book_opens_ahead: 56 },
      { book_opens_ahead: "8 weeks" },
      { book_opens_ahead: "0 days" },
      { book_opens_ahead: "1 mon" },
    ]) {
      assert.equal(bookHorizonWeeksFrom(data), null, JSON.stringify(data));
    }
  });
});
