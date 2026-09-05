/**
 * Which lesson of a book a point belongs to.
 *
 * A lesson opens with a "LESSON N" header printed on a page, and runs until the
 * next header. When the header page is in the upload, the batch settles this on
 * its own. When it is not — and the teacher is promised the pages may be
 * uploaded in any order — the lessons already written answer instead, and if
 * they cannot, the screen asks. What is never done is writing a point with no
 * lesson and saying nothing: that is a hole in the data nobody sees until the
 * lesson screen is built, months later.
 */
export type LessonRange = {
  readonly id: string;
  readonly number: number;
  /** The point the lesson opens on, which is the only boundary that is fixed. */
  readonly firstPoint: number;
  /**
   * The furthest point written to it so far.
   *
   * Deliberately unread by everything below. It is not the end of the lesson,
   * it is how far the uploads have reached: bounding by it would refuse point
   * 118 of a lesson whose pages stop at 114, for a reason that is about the
   * upload and not about the book.
   */
  readonly lastPoint: number;
};

/**
 * The lesson a point falls in: the last one that opens at or before it, when
 * another recorded lesson opens after it.
 *
 * Both halves are needed and neither uses last_point. The lesson that opens
 * before says which one it is; a lesson opening after is what says this one has
 * ended, and without it nothing recorded tells where the point stops belonging.
 * With only lesson 22 written, point 125 could be in it or in a lesson nobody
 * has uploaded, so this says nothing and the screen asks — the same answer the
 * orphan sweep has always given, and now the same rule.
 */
export function lessonForPoint(
  point: number,
  lessons: readonly LessonRange[],
): LessonRange | null {
  let found: LessonRange | null = null;
  let closed = false;
  for (const lesson of lessons) {
    if (lesson.firstPoint > point) {
      closed = true;
    } else if (found === null || lesson.firstPoint > found.firstPoint) {
      found = lesson;
    }
  }
  return closed ? found : null;
}

/**
 * The three steps, in order: the upload, then the database, then nobody.
 *
 * `fromHeader` is what the batch worked out from a "LESSON N" printed on this
 * page or on an earlier one of the same upload. Null from this function means
 * the screen has to ask.
 */
export function lessonForPage(
  fromHeader: number | null,
  point: number | null,
  lessons: readonly LessonRange[],
): number | null {
  if (fromHeader !== null) {
    return fromHeader;
  }
  if (point === null) {
    return null;
  }
  return lessonForPoint(point, lessons)?.number ?? null;
}

/** A point that was written before its lesson existed, and where it belongs. */
export type OrphanAttachment = {
  readonly point: number;
  readonly lessonId: string;
};

/**
 * Where each orphaned point belongs, once the lessons are known.
 *
 * Confirming a page writes its point whether or not its lesson has been seen
 * yet, and a lesson appears the first time one of its own pages is written. So
 * points arrive before their lesson does, and this is what goes back for them.
 *
 * The rule above and nothing more. A point above the last lesson recorded has
 * nothing to say where it stops belonging, so it stays an orphan until a lesson
 * arrives above it — an orphan is repairable, and a point attached to the wrong
 * lesson never is.
 */
export function orphansToAttach(
  lessons: readonly LessonRange[],
  orphans: readonly number[],
): readonly OrphanAttachment[] {
  return [...orphans]
    .sort((a, b) => a - b)
    .flatMap((point) => {
      const lesson = lessonForPoint(point, lessons);
      return lesson === null ? [] : [{ point, lessonId: lesson.id }];
    });
}

/** A run of points that belong to the same lesson, in book order. */
export type LessonGroup<T> = {
  /** Null for the points before any recorded lesson opens. */
  readonly lesson: number | null;
  readonly points: readonly T[];
};

/**
 * The points of a book cut into the lessons they fall in.
 *
 * By the rule the ingestion uses, so the screen shows what the database would
 * answer — a first_point one square off, or a lesson nobody recorded, becomes a
 * boundary in the wrong place instead of a silence.
 *
 * With one addition that only a drawing may make: the last lesson recorded has
 * nothing above it to close it, so its own points would all read as belonging
 * to nobody. The points it has actually been written to, up to its last_point,
 * are shown under it. Drawing where a point already is costs nothing; deciding
 * where to write one on the same reasoning is what the rule above refuses.
 */
export function groupByLesson<T extends { readonly number: number }>(
  points: readonly T[],
  lessons: readonly LessonRange[],
): readonly LessonGroup<T>[] {
  const groups: LessonGroup<T>[] = [];
  let current: { lesson: number | null; points: T[] } | null = null;

  const reached = (point: number): LessonRange | null =>
    lessons.find(
      (lesson) => lesson.firstPoint <= point && point <= lesson.lastPoint,
    ) ?? null;

  for (const point of [...points].sort((a, b) => a.number - b.number)) {
    const lesson =
      (lessonForPoint(point.number, lessons) ?? reached(point.number))
        ?.number ?? null;
    if (current === null || current.lesson !== lesson) {
      current = { lesson, points: [] };
      groups.push(current);
    }
    current.points.push(point);
  }
  return groups;
}
