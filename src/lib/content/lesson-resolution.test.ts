import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extractPage, resolveBatch } from "../extraction/pipeline.ts";
import {
  blankPage,
  inkLine,
  shadedBox,
  toBitmap,
  type MutablePage,
} from "../extraction/testing/synthetic-page.ts";
import type { Bitmap, OcrReader, OcrWord } from "../extraction/types.ts";
import {
  groupByLesson,
  lessonForPage,
  lessonForPoint,
  orphansToAttach,
  type LessonRange,
} from "./lesson-range.ts";

const RANGE = { first: 1, last: 128 };

function word(text: string, x: number, y: number): OcrWord {
  return { text, x, y, width: text.length * 9, height: 12, confidence: 50 };
}

function scriptedReader(script: {
  margin?: readonly OcrWord[];
  page?: readonly OcrWord[];
  box?: readonly OcrWord[];
}): OcrReader {
  return {
    async read(image: Bitmap, options) {
      if (options?.allowedCharacters !== undefined) {
        return script.margin ?? [];
      }
      return (image.width >= 1000 ? script.page : script.box) ?? [];
    },
  };
}

function lessonPage(width: number): Bitmap {
  const height = Math.round((width * 1500) / 1100);
  const page: MutablePage = blankPage(width, height);
  const left = Math.round(width * 0.11);
  const right = Math.round(width * 0.89);
  const scale = width / 1100;
  shadedBox(page, left, Math.round(200 * scale), Math.round(60 * scale));
  for (const top of [400, 430, 460]) {
    inkLine(page, {
      left,
      right,
      top: Math.round(top * scale),
      height: Math.max(2, Math.round(10 * scale)),
      wordWidth: Math.max(4, Math.round(30 * scale)),
      wordGap: Math.max(2, Math.round(8 * scale)),
    });
  }
  return toBitmap(page);
}

/** The page that carries "LESSON 22" and point 114. */
function headerPage() {
  return extractPage(
    "p114",
    0,
    lessonPage(1100),
    scriptedReader({
      margin: [word("114", 10, 300)],
      page: [word("LESSON", 100, 40), word("22", 200, 40)],
      box: [word("word", 10, 10)],
    }),
  );
}

/** A later page of the same lesson: point 116, no header of its own. */
function plainPage(uploadIndex: number) {
  return extractPage(
    "p116",
    uploadIndex,
    lessonPage(1100),
    scriptedReader({
      margin: [word("116", 10, 300)],
      page: [word("text", 120, 400)],
      box: [word("word", 10, 10)],
    }),
  );
}

const lessonOf = (
  batch: readonly {
    extraction: { id: string };
    lessonNumber: number | null;
  }[],
  id: string,
) => batch.find((page) => page.extraction.id === id)?.lessonNumber ?? null;

/**
 * The book as the database holds it once lesson 22 and the one after it have
 * been written. Both are needed to answer for a point inside 22: the lesson
 * that opens above is what says where 22 stops.
 */
const STORED: readonly LessonRange[] = [
  { id: "lesson-22", number: 22, firstPoint: 114, lastPoint: 114 },
  { id: "lesson-23", number: 23, firstPoint: 119, lastPoint: 121 },
];

describe("a page's lesson must not depend on what else was in the upload", () => {
  test("the header page in the same upload settles it, as it always has", async () => {
    const together = resolveBatch(
      [await headerPage(), await plainPage(1)],
      RANGE,
    );
    assert.equal(lessonOf(together, "p116"), 22);
  });

  test("uploaded on its own, the batch has nothing to go on", async () => {
    // Not a defect of the batch: lesson 22's header is on a page that is not
    // in this upload, so nothing here can know it. This is why the database is
    // the second step and the teacher the third.
    const alone = resolveBatch([await plainPage(0)], RANGE);
    assert.equal(lessonOf(alone, "p116"), null);
  });

  test("and the answer is the same either way once the lessons are read", async () => {
    const together = resolveBatch(
      [await headerPage(), await plainPage(1)],
      RANGE,
    );
    const alone = resolveBatch([await plainPage(0)], RANGE);

    assert.equal(lessonForPage(lessonOf(together, "p116"), 116, STORED), 22);
    assert.equal(
      lessonForPage(lessonOf(alone, "p116"), 116, STORED),
      22,
      "the lesson is a property of the point, not of the upload",
    );
  });
});

describe("lessonForPoint", () => {
  const lessons: readonly LessonRange[] = [
    { id: "l22", number: 22, firstPoint: 114, lastPoint: 114 },
    { id: "l23", number: 23, firstPoint: 119, lastPoint: 121 },
    { id: "l21", number: 21, firstPoint: 109, lastPoint: 113 },
  ];

  test("a point belongs to the last lesson that started at or before it", () => {
    assert.equal(lessonForPoint(109, lessons)?.number, 21);
    assert.equal(lessonForPoint(113, lessons)?.number, 21);
    assert.equal(lessonForPoint(114, lessons)?.number, 22);
  });

  test("a point above the last lesson recorded is nobody's to answer for", () => {
    // Nothing says where lesson 23 stops, so 125 may be in it or in a lesson
    // that has not been uploaded. The screen asks instead of guessing, which is
    // the rule the orphan sweep already used.
    assert.equal(lessonForPoint(125, lessons), null);
    assert.equal(lessonForPoint(119, lessons), null);
    assert.equal(lessonForPage(null, 125, lessons), null);
  });

  test("a point past the recorded end still belongs to that lesson", () => {
    // last_point only grows as pages arrive. Refusing 118 because lesson 22
    // has only reached 114 would refuse a point for a reason that is about
    // what has been uploaded, not about the book.
    assert.equal(lessonForPoint(115, lessons)?.number, 22);
    assert.equal(lessonForPoint(118, lessons)?.number, 22);
  });

  test("a point before every lesson is unknown, and is asked about", () => {
    assert.equal(lessonForPoint(108, lessons), null);
    assert.equal(lessonForPoint(53, lessons), null);
    assert.equal(lessonForPoint(116, []), null);
  });
});

describe("lessonForPage", () => {
  test("the header of the upload wins, being the page itself", () => {
    assert.equal(lessonForPage(23, 116, STORED), 23);
  });

  test("with no header, the stored lessons answer", () => {
    assert.equal(lessonForPage(null, 116, STORED), 22);
  });

  test("with neither, nobody knows and the screen has to ask", () => {
    assert.equal(lessonForPage(null, 116, []), null);
    assert.equal(lessonForPage(null, null, STORED), null);
  });

  test("nor when nothing recorded says where the lesson stops", () => {
    // Lesson 23 not written yet: 116 may be in 22 or in a lesson between them
    // that nobody has uploaded. Uploading the whole book at once never reaches
    // here — every header is in the batch and the first step answers.
    assert.equal(lessonForPage(null, 116, STORED.slice(0, 1)), null);
  });
});

describe("orphansToAttach", () => {
  const lessons: readonly LessonRange[] = [
    { id: "l22", number: 22, firstPoint: 114, lastPoint: 114 },
    { id: "l23", number: 23, firstPoint: 119, lastPoint: 121 },
  ];

  test("points written before their lesson existed are attached to it", () => {
    // 116, 117 and 118 were confirmed while lesson 22 did not exist yet. Once
    // it does, and lesson 23 says where it stops, they stop being orphans.
    assert.deepEqual(orphansToAttach(lessons, [116, 117, 118]), [
      { point: 116, lessonId: "l22" },
      { point: 117, lessonId: "l22" },
      { point: 118, lessonId: "l22" },
    ]);
  });

  test("each orphan goes to its own lesson, not to the newest one", () => {
    const withNext: readonly LessonRange[] = [
      ...lessons,
      { id: "l24", number: 24, firstPoint: 124, lastPoint: 124 },
    ];
    assert.deepEqual(orphansToAttach(withNext, [120, 115]), [
      { point: 115, lessonId: "l22" },
      { point: 120, lessonId: "l23" },
    ]);
  });

  test("an orphan past the last lesson that opens is left for later", () => {
    // Nothing recorded says where lesson 23 stops, so 122 may belong to it or
    // to a lesson nobody has uploaded. Nobody is looking at this row, so it
    // waits: an orphan can still be repaired, a wrong attachment cannot.
    assert.deepEqual(orphansToAttach(lessons, [122, 300]), []);
    assert.deepEqual(orphansToAttach(lessons, [119]), []);
  });

  test("an orphan before every lesson is left alone", () => {
    assert.deepEqual(orphansToAttach(lessons, [100]), []);
    assert.deepEqual(orphansToAttach([], [116]), []);
    assert.deepEqual(orphansToAttach(lessons, []), []);
  });
});

describe("groupByLesson", () => {
  const lessons: readonly LessonRange[] = [
    { id: "l22", number: 22, firstPoint: 114, lastPoint: 118 },
    { id: "l23", number: 23, firstPoint: 119, lastPoint: 121 },
  ];
  const points = [113, 114, 115, 119, 120].map((number) => ({ number }));

  test("the points are cut where a lesson opens", () => {
    assert.deepEqual(
      groupByLesson(points, lessons).map((group) => [
        group.lesson,
        group.points.map((point) => point.number),
      ]),
      [
        [null, [113]],
        [22, [114, 115]],
        [23, [119, 120]],
      ],
    );
  });

  test("with no lesson recorded, the whole book is one run with no number", () => {
    assert.deepEqual(
      groupByLesson(points, []).map((group) => group.lesson),
      [null],
    );
    assert.deepEqual(groupByLesson([], lessons), []);
  });
});
