import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { lessonToMark, type MarkableLesson } from "./stop.ts";

/** Monday 02/11/2026, 19:20 in São Paulo. */
const NOW = new Date("2026-11-02T22:20:00Z");

function lesson(id: string, start: string, minutes = 45): MarkableLesson {
  return { id, scheduledAt: start, durationMinutes: minutes };
}

describe("lessonToMark", () => {
  test("the lesson running now", () => {
    const running = lesson("running", "2026-11-02T22:00:00Z");
    assert.equal(lessonToMark([running], NOW), running);
  });

  test("a lesson starting within the hour", () => {
    const soon = lesson("soon", "2026-11-02T23:05:00Z");
    assert.equal(lessonToMark([soon], NOW), soon);
  });

  test("none for a lesson more than an hour away", () => {
    assert.equal(
      lessonToMark([lesson("later", "2026-11-03T00:30:00Z")], NOW),
      null,
    );
  });

  test("a lesson that just ended, marked as it closes", () => {
    // 21:30 UTC plus 45 minutes ended at 22:15, five minutes before 22:20:
    // "Parei aqui" comes at the end, and a lesson often runs over.
    const ended = lesson("ended", "2026-11-02T21:30:00Z");
    assert.equal(lessonToMark([ended], NOW), ended);
  });

  test("none for a lesson over for more than the grace", () => {
    // 20:00 UTC plus 45 minutes ended at 20:45, 95 minutes before 22:20.
    assert.equal(
      lessonToMark([lesson("over", "2026-11-02T20:00:00Z")], NOW),
      null,
    );
  });

  test("the lesson running wins over a closer one about to start", () => {
    // Started 40 minutes ago; the other starts in 20.
    const running = lesson("running", "2026-11-02T21:40:00Z", 90);
    const soon = lesson("soon", "2026-11-02T22:40:00Z");
    assert.equal(lessonToMark([soon, running], NOW), running);
  });

  test("a long lesson that started early is still running", () => {
    const long = lesson("long", "2026-11-02T21:00:00Z", 90);
    assert.equal(lessonToMark([long], NOW), long);
  });

  test("of two candidates, the one closer to now", () => {
    const running = lesson("running", "2026-11-02T22:00:00Z");
    const next = lesson("next", "2026-11-02T23:00:00Z");
    assert.equal(lessonToMark([next, running], NOW), running);
  });

  test("none without lessons", () => {
    assert.equal(lessonToMark([], NOW), null);
  });
});
