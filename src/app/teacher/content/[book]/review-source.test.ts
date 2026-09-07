import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  asksThePoint,
  fromStored,
  toStored,
  authoredPoints,
  headerFor,
  headingFor,
  isSavedOnOpening,
  isWritable,
  mayHoldAnotherPagesWork,
  lessonIsThePageBefores,
  summaryFor,
  targetsOf,
  writesTheSame,
  writtenNumbers,
  type ReviewSourcePage,
} from "./review-source.ts";
import type { PointStart } from "../../../../lib/content/unread-points.ts";

function page(overrides: Partial<ReviewSourcePage> = {}): ReviewSourcePage {
  return {
    id: "p117-118.png",
    fileName: "p117-118.png",
    uploadIndex: 0,
    points: [117],
    placements: [{ number: 117, y: 80 }],
    inheritedPoint: null,
    precedingPoint: null,
    openingPoint: null,
    opensLesson: false,
    duplicateOf: null,
    lessonNumber: 22,
    disputes: [],
    unsupported: null,
    refused: false,
    blocks: [],
    savedPoints: [],
    pointStarts: [],
    changedSinceSaving: false,
    hasImage: true,
    ...overrides,
  } as ReviewSourcePage;
}

describe("writtenNumbers", () => {
  test("an answered dispute is named alongside the settled number", () => {
    // The page writes both. Reading the heading off the settled numbers alone
    // named only one of them, and for a spread it named the wrong one.
    const spread = page({
      points: [117],
      disputes: [{ y: 1219, candidates: [118, 119] }],
    });
    assert.deepEqual(writtenNumbers(spread, 118, false), [117, 118]);
    assert.equal(headingFor(spread, 118, false), "Pontos 117 e 118");
  });

  test("a page that settled both keeps both", () => {
    const both = page({ points: [117, 118] });
    assert.equal(headingFor(both, 117, false), "Pontos 117 e 118");
  });

  test("a page with one number reads as one", () => {
    assert.equal(headingFor(page({ points: [121] }), 121, false), "Ponto 121");
  });

  test("a continuation belongs to one point, whatever the page settled", () => {
    const carried = page({ points: [], placements: [], inheritedPoint: 118 });
    assert.deepEqual(writtenNumbers(carried, 118, true), [118]);
    assert.equal(headingFor(carried, 118, true), "Continuação do ponto 118");
  });

  test("only the page's own numbers may be replaced, never the one before", () => {
    // targetsOf names every point the page writes to, which is what the check
    // for "this point already holds content" has to see. What may be replaced
    // is narrower: the opening point belongs to the page before, and this page
    // only adds to it.
    const opening = page({
      points: [116],
      placements: [{ number: 116, y: 663 }],
      precedingPoint: 115,
      openingPoint: 115,
      blocks: [
        {
          kind: "vocabulary",
          content: "cheap",
          needsReview: false,
          crop: null,
          top: 62,
        },
      ],
    });
    assert.deepEqual(targetsOf(opening), [115, 116]);
    assert.deepEqual(authoredPoints(opening), [116]);
    const carried = page({ points: [], placements: [], inheritedPoint: 118 });
    assert.deepEqual(authoredPoints(carried), [118]);
  });

  test("a page also names the point it opens in, when it writes there", () => {
    // p116 of book 2: two panels printed above its only margin number, both
    // belonging to 115. The page writes to 115 as well as to 116, and saying
    // only "Ponto 116" is the half of the truth that hides the other point.
    const opening = page({
      id: "p116.png",
      fileName: "p116.png",
      points: [116],
      placements: [{ number: 116, y: 663 }],
      precedingPoint: 115,
      openingPoint: 115,
      blocks: [
        {
          kind: "vocabulary",
          content: "cheap",
          needsReview: false,
          crop: null,
          top: 62,
        },
        {
          kind: "vocabulary",
          content: "the fewest",
          needsReview: false,
          crop: null,
          top: 347,
        },
        {
          kind: "vocabulary",
          content: "building",
          needsReview: false,
          crop: null,
          top: 814,
        },
      ],
    });
    assert.deepEqual(targetsOf(opening), [115, 116]);
    assert.deepEqual(writtenNumbers(opening, 116, false), [115, 116]);
    assert.equal(headingFor(opening, 116, false), "Pontos 115 e 116");
  });

  test("a page keeps naming only its own number when nothing spills up", () => {
    const tidy = page({
      points: [117],
      placements: [{ number: 117, y: 80 }],
      precedingPoint: 116,
      openingPoint: 116,
      blocks: [
        {
          kind: "vocabulary",
          content: "a, some",
          needsReview: false,
          crop: null,
          top: 64,
        },
      ],
    });
    assert.deepEqual(targetsOf(tidy), [117]);
    assert.equal(headingFor(tidy, 117, false), "Ponto 117");
  });

  test("a page with no number of its own keeps the lesson the upload gave it", () => {
    // A continuation page opens in the point it inherits, and the two are the
    // same number, so a rule written as "the header does not speak for the opening
    // point" threw away the header for the whole page, and every continuation
    // in an upload started asking for a lesson the batch had already answered.
    const carried = page({
      points: [],
      placements: [],
      inheritedPoint: 118,
      precedingPoint: 118,
      openingPoint: 118,
      lessonNumber: 22,
      opensLesson: false,
    });
    assert.equal(headerFor(carried, 118), 22);
  });

  test("a page that does not open a lesson speaks for what it opens in", () => {
    // p116 of book 2 carries no header; its lesson was inherited from an
    // earlier page of the same upload, and no boundary sits between 115 and
    // 116. Refusing the header here asked the teacher about a lesson that was
    // never in doubt.
    const inside = page({
      points: [116],
      placements: [{ number: 116, y: 663 }],
      precedingPoint: 115,
      openingPoint: 115,
      lessonNumber: 22,
      opensLesson: false,
    });
    assert.equal(headerFor(inside, 115), 22);
    assert.equal(headerFor(inside, 116), 22);
  });

  test("a LESSON header does not speak for the point the page opens in", () => {
    // A page that opens a lesson carries the header for the points printed
    // under it. The point it opens in was printed on the page before, on the
    // other side of that header, and belongs to the lesson before. Reading the
    // header for it filed the last point of one lesson under the next.
    const opens = page({
      points: [8, 9],
      placements: [
        { number: 8, y: 270 },
        { number: 9, y: 948 },
      ],
      precedingPoint: 7,
      openingPoint: 7,
      lessonNumber: 2,
      opensLesson: true,
    });
    assert.equal(headerFor(opens, 8), 2);
    assert.equal(headerFor(opens, 9), 2);
    assert.equal(headerFor(opens, 7), null, "point 7 is the lesson before");
  });

  test("a page opening the book's own first point has no lesson before it", () => {
    // The first page of book 1: LESSON 1 printed at the top, then 1, 2 and 3.
    // Nothing in the book precedes point 1, so there is no page on the other
    // side of that header and no earlier lesson for it to belong to. Read as
    // "the point this page opens in is the page before's", the screen held the
    // page and asked for a previous page that does not exist.
    const first = page({
      points: [1, 2, 3],
      placements: [
        { number: 1, y: 300 },
        { number: 2, y: 700 },
        { number: 3, y: 1100 },
      ],
      // The whole of the difference: the page carries point 1 and nothing in
      // the book comes before it.
      precedingPoint: null,
      openingPoint: 1,
      lessonNumber: 1,
      opensLesson: true,
    });
    assert.equal(lessonIsThePageBefores(first, 1), false);
    assert.equal(headerFor(first, 1), 1);
  });

  test("unanswered stays a state of its own", () => {
    const unresolved = page({
      points: [],
      placements: [],
      disputes: [{ y: 300, candidates: [4, 45, 74] }],
    });
    assert.deepEqual(writtenNumbers(unresolved, null, false), []);
    assert.equal(
      headingFor(unresolved, null, false),
      "Número do ponto não resolvido",
    );
  });
});

describe("what the screen may ask of a page", () => {
  /** A page with nothing on it to say which point it is. */
  const unanswered = { points: [], placements: [], inheritedPoint: null };

  test("a second scan is not asked which point it is", () => {
    // The bug this pins: the page said "nothing of it will be written" and
    // then, directly under that, asked which point it was. Only one of the two
    // can be true, and it is the first: a re-upload is not the teacher's to
    // answer, whatever its numbers did or did not say.
    const second = page({ ...unanswered, duplicateOf: "p116.png" });
    assert.equal(asksThePoint(second, false), false);
    assert.equal(isWritable(second), false);
  });

  test("a refused image and a kind we do not read are not asked either", () => {
    const photo = page({ ...unanswered, refused: true });
    const exercise = page({ ...unanswered, unsupported: "revision_exercise" });
    assert.equal(asksThePoint(photo, false), false);
    assert.equal(asksThePoint(exercise, false), false);
  });

  test("an ordinary page with nothing to go on is still asked", () => {
    // The question has to survive the precedence, or the pages that really need
    // it stop being asked and are written to whatever number came nearest.
    assert.equal(asksThePoint(page(unanswered), false), true);
  });

  test("a page already written is not asked again", () => {
    assert.equal(asksThePoint(page(unanswered), true), false);
  });

  test("a page whose number the batch settled is not asked at all", () => {
    assert.equal(asksThePoint(page(), false), false);
  });
});

describe("summaryFor", () => {
  const waiting = (flagged: number) =>
    summaryFor({
      page: page(),
      state: "waiting",
      target: 117,
      continuation: false,
      flagged,
    });

  test("says nothing extra when nothing is flagged", () => {
    assert.equal(waiting(0), "ponto 117");
  });

  test("names blocks, not tables", () => {
    // The height flag used to be the only one, so the rail called every flagged
    // block a table. Since a vocabulary panel or an explanation can be flagged
    // for holding a character the book cannot print, that sent the teacher
    // looking for a table that is not on the page.
    assert.equal(waiting(1), "ponto 117 · 1 bloco a conferir");
    assert.equal(waiting(3), "ponto 117 · 3 blocos a conferir");
  });
});

describe("a point the margin reader missed, once the teacher places it", () => {
  /*
   * The real book 1 page: 6 and 7 printed in the margin, only the 7 read. Six
   * blocks above it, the first of them printed under point 5 and the rest under
   * the 6. The heights are what scripts/dump-block-points.ts reports.
   */
  const unread = (starts: readonly PointStart[]) =>
    page({
      id: "Screenshot From 2026-09-05 17-29-56.png",
      points: [7],
      placements: [{ number: 7, y: 1008 }],
      precedingPoint: 5,
      openingPoint: 5,
      lessonNumber: 1,
      pointStarts: starts,
      blocks: [65, 320, 405, 758, 839, 913, 1090, 1209].map((top) => ({
        kind: "vocabulary" as const,
        content: "x",
        needsReview: false,
        crop: null,
        top,
      })),
    });

  test("unanswered, the page names only the number it carries", () => {
    // Everything above the 7 is unfiled, so the page opens in no point yet and
    // the heading must not promise one.
    assert.deepEqual(targetsOf(unread([])), [7]);
    assert.equal(headingFor(unread([]), 7, false), "Ponto 7");
  });

  test("answered, the page names all three points it writes", () => {
    const answered = unread([{ number: 6, top: 320 }]);
    assert.deepEqual(targetsOf(answered), [5, 6, 7]);
    assert.equal(headingFor(answered, 7, false), "Pontos 5, 6 e 7");
  });

  test("placing the point at the first block leaves nothing for the one before", () => {
    const answered = unread([{ number: 6, top: 65 }]);
    assert.deepEqual(targetsOf(answered), [6, 7]);
    assert.equal(headingFor(answered, 7, false), "Pontos 6 e 7");
  });

  test('"not on this page" writes nothing new', () => {
    const answered = unread([{ number: 6, top: null }]);
    assert.deepEqual(targetsOf(answered), [7]);
  });

  test("the rail says the same numbers as the heading", () => {
    assert.equal(
      summaryFor({
        page: unread([{ number: 6, top: 320 }]),
        state: "waiting",
        target: 7,
        continuation: false,
        flagged: 0,
        starts: [{ number: 6, top: 320 }],
      }),
      "5, 6 e 7",
    );
  });
});

describe("the batch round-trip", () => {
  test("the unread-point answer survives being stored and read back", () => {
    // The answer is the one thing on this screen nothing can derive again. A
    // reload that dropped it would put the same question back on an answered
    // page and unfile the blocks it had placed.
    const answered = page({
      points: [7],
      placements: [{ number: 7, y: 1008 }],
      precedingPoint: 5,
      openingPoint: 5,
      pointStarts: [
        { number: 6, top: 320 },
        { number: 5, top: null },
      ],
    });
    const stored = toStored(answered, {
      blocks: [],
      savedPoints: [],
      changedSinceSaving: false,
      pointStarts: answered.pointStarts,
    });
    assert.deepEqual(stored.pointStarts, [
      { number: 6, top: 320 },
      { number: 5, top: null },
    ]);
    assert.deepEqual(fromStored(stored).pointStarts, answered.pointStarts);
  });

  test("a batch just read has been asked nothing yet", () => {
    const stored = toStored(page(), {
      blocks: [],
      savedPoints: [],
      changedSinceSaving: false,
      pointStarts: [],
    });
    assert.deepEqual(fromStored(stored).pointStarts, []);
  });
});

describe("a page that was answered and written, across a reload", () => {
  /*
   * The whole cycle the teacher goes through: the book 1 page carrying 6 and 7
   * with only the 7 read, answered, confirmed, kept, and reopened. Every step
   * uses the function the screen uses, so a break anywhere along it shows here
   * rather than on the teacher's screen a week later.
   */
  const answered = page({
    id: "Screenshot From 2026-09-05 17-29-56.png",
    points: [7],
    placements: [{ number: 7, y: 1008 }],
    precedingPoint: 5,
    openingPoint: 5,
    lessonNumber: 1,
    pointStarts: [{ number: 6, top: 320 }],
  });

  const reopened = fromStored(
    toStored(answered, {
      blocks: [],
      savedPoints: [5, 6, 7],
      changedSinceSaving: false,
      pointStarts: answered.pointStarts,
    }),
  );

  test("the answer about where point 6 starts is still there", () => {
    assert.deepEqual(reopened.pointStarts, [{ number: 6, top: 320 }]);
  });

  test("the page still knows this batch wrote it", () => {
    assert.deepEqual(reopened.savedPoints, [5, 6, 7]);
    assert.equal(reopened.changedSinceSaving, false);
  });

  test("so it opens saved, and asks nothing again", () => {
    // Both reported symptoms hang on this one boolean. False, the page goes
    // back to "waiting": the unread-point question is put again to a page that
    // answered it, the batch counter reads zero written, and the note about
    // replacing somebody else's work appears over content this very batch put
    // there five minutes ago.
    assert.equal(isSavedOnOpening(reopened), true);
  });

  test("a page written and then edited is not saved, and keeps its points", () => {
    const edited = fromStored(
      toStored(answered, {
        blocks: [],
        savedPoints: [5, 6, 7],
        changedSinceSaving: true,
        pointStarts: answered.pointStarts,
      }),
    );
    assert.equal(isSavedOnOpening(edited), false);
    assert.deepEqual(edited.savedPoints, [5, 6, 7]);
  });

  test("a flag the screen sets on its own is not an edit", () => {
    /*
     * What made the page forget it had been written. Confirming compares the
     * draft it wrote against the draft on screen when the answer comes back,
     * and it compared them by object identity. The screen asks the database
     * which points already hold content, and when that answer lands it puts an
     * `alreadyInDatabase` flag on the drafts, which makes a new object out of
     * every one of them. A save in flight while that landed came back to a
     * draft it no longer recognised, called itself unsaved, and was kept as
     * "written and edited since". On the next open the page was waiting again,
     * the counter read zero written, and the question it had answered was put
     * to it a second time.
     */
    const wrote = {
      blocks: [
        {
          kind: "vocabulary" as const,
          content: "on, under",
          top: 65,
          needsReview: false,
        },
      ],
      pointNumber: 7,
      continuation: false,
      typedPoint: "",
      typedLesson: "",
      pointStarts: [{ number: 6, top: 320 }],
    };
    assert.equal(writesTheSame(wrote, { ...wrote }), true);
    assert.equal(
      writesTheSame(wrote, { ...wrote, blocks: [...wrote.blocks] }),
      true,
    );
  });

  test("a real edit is an edit", () => {
    const wrote = {
      blocks: [
        {
          kind: "vocabulary" as const,
          content: "on, under",
          top: 65,
          needsReview: false,
        },
      ],
      pointNumber: 7,
      continuation: false,
      typedPoint: "",
      typedLesson: "",
      pointStarts: [{ number: 6, top: 320 }],
    };
    assert.equal(
      writesTheSame(wrote, {
        ...wrote,
        blocks: [{ ...wrote.blocks[0], content: "on, under, in" }],
      }),
      false,
    );
    assert.equal(
      writesTheSame(wrote, { ...wrote, pointStarts: [{ number: 6, top: 65 }] }),
      false,
    );
    assert.equal(writesTheSame(wrote, { ...wrote, pointNumber: 8 }), false);
    assert.equal(writesTheSame(wrote, { ...wrote, blocks: [] }), false);
  });

  test("this batch's own writing is not somebody else's", () => {
    // The note exists for a point another upload filled. A page that knows it
    // wrote those points must not be warned about its own work.
    assert.equal(mayHoldAnotherPagesWork(reopened, 6), false);
    assert.equal(mayHoldAnotherPagesWork(page(), 6), true);
    // Point by point: a page that wrote 5 and 6 and stopped there says nothing
    // about who filled 8, which is the case the note exists for.
    assert.equal(mayHoldAnotherPagesWork(reopened, 8), true);
  });
});
