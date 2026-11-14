import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { progressLine, progressOf, type Mark } from "./progress.ts";

function mark(
  scheduledAt: string,
  point: number,
  book = 1,
  lastPoint: number | null = 52,
): Mark {
  return { scheduledAt, book, point, lastPoint };
}

describe("progressOf", () => {
  test("no marked lesson is no progress", () => {
    assert.equal(progressOf([]), null);
  });

  test("one marked lesson gives its point and one lesson", () => {
    assert.deepEqual(progressOf([mark("2026-11-02T22:00:00Z", 5)]), {
      book: 1,
      point: 5,
      lastPoint: 52,
      lessons: 1,
    });
  });

  test("the latest lesson decides, not the highest point", () => {
    // A review that went back to point 9 is where she stopped, as on the
    // lesson screen (lastStop), even after reaching 14 the week before.
    const marks = [
      mark("2026-10-19T22:00:00Z", 6),
      mark("2026-11-02T22:00:00Z", 9),
      mark("2026-10-26T22:00:00Z", 14),
    ];
    assert.deepEqual(progressOf(marks), {
      book: 1,
      point: 9,
      lastPoint: 52,
      lessons: 3,
    });
  });

  test("instants are compared as instants, not as text", () => {
    // 21:30 at -03:00 is 00:30 UTC on the next day: later than 23:00 UTC.
    const marks = [
      mark("2026-11-02T23:00:00+00:00", 7),
      mark("2026-11-02T21:30:00-03:00", 8),
    ];
    assert.equal(progressOf(marks)?.point, 8);
  });

  test("the book is the latest lesson's book", () => {
    const marks = [
      mark("2026-10-26T22:00:00Z", 52, 1, 52),
      mark("2026-11-02T22:00:00Z", 60, 2, 128),
    ];
    assert.deepEqual(progressOf(marks), {
      book: 2,
      point: 60,
      lastPoint: 128,
      lessons: 2,
    });
  });
});

describe("progressLine", () => {
  test("no progress says so", () => {
    assert.equal(progressLine(null), "nenhum ponto marcado ainda");
  });

  test("book, point of its last point, and lessons in the plural", () => {
    assert.equal(
      progressLine({ book: 1, point: 14, lastPoint: 52, lessons: 6 }),
      "Livro 1 · ponto 14 de 52 · 6 aulas",
    );
  });

  test("one lesson is singular", () => {
    assert.equal(
      progressLine({ book: 1, point: 5, lastPoint: 52, lessons: 1 }),
      "Livro 1 · ponto 5 de 52 · 1 aula",
    );
  });

  test("a book without a last point leaves the total out", () => {
    assert.equal(
      progressLine({ book: 3, point: 140, lastPoint: null, lessons: 1 }),
      "Livro 3 · ponto 140 · 1 aula",
    );
  });
});
