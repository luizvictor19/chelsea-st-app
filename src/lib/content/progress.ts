/** One point of a book, as the screens need it. */
export type PointProgress = {
  readonly number: number;
  readonly filled: boolean;
};

export type Gap = {
  readonly from: number;
  readonly to: number;
};

/**
 * The runs of empty points that sit between filled ones.
 *
 * Only enclosed runs count. Points after the last filled one are simply not
 * uploaded yet, and calling those a gap would report the whole rest of the book
 * as missing from the first upload onwards. A gap means the teacher uploaded
 * around something, which is the case worth pointing at.
 */
export function gaps(points: readonly PointProgress[]): readonly Gap[] {
  const ordered = [...points].sort((a, b) => a.number - b.number);
  const firstFilled = ordered.findIndex((point) => point.filled);
  const lastFilled = ordered.findLastIndex((point) => point.filled);
  if (firstFilled === -1 || lastFilled <= firstFilled) {
    return [];
  }

  const found: Gap[] = [];
  let start: number | null = null;
  for (let i = firstFilled; i <= lastFilled; i += 1) {
    if (!ordered[i].filled) {
      if (start === null) {
        start = ordered[i].number;
      }
    } else if (start !== null) {
      found.push({ from: start, to: ordered[i - 1].number });
      start = null;
    }
  }
  return found;
}

export type Progress = {
  readonly filled: number;
  readonly total: number;
  /** What is left, so the screen does not make the teacher subtract. */
  readonly remaining: number;
  /** Zero when the book has no range yet, so a bar can render at all. */
  readonly fraction: number;
};

/**
 * How far a book is, over the span it actually uses.
 *
 * Counted across first to last inclusive, not up to the last: book 5 runs from
 * 250 to 320, which is 71 points and not 320.
 */
export function progress(
  points: readonly PointProgress[],
  firstPoint: number | null,
  lastPoint: number | null,
): Progress {
  const total =
    firstPoint === null || lastPoint === null || lastPoint < firstPoint
      ? 0
      : lastPoint - firstPoint + 1;
  const filled = points.filter((point) => point.filled).length;
  return {
    filled,
    total,
    remaining: Math.max(0, total - filled),
    fraction: total === 0 ? 0 : Math.min(1, filled / total),
  };
}

/** Every point of a book, filled or not, so a screen can list them all. */
export function pointsInRange(
  filledNumbers: readonly number[],
  firstPoint: number | null,
  lastPoint: number | null,
): readonly PointProgress[] {
  if (
    firstPoint === null ||
    lastPoint === null ||
    firstPoint < 1 ||
    lastPoint < firstPoint
  ) {
    return [];
  }
  const filled = new Set(filledNumbers);
  return Array.from({ length: lastPoint - firstPoint + 1 }, (_, index) => ({
    number: firstPoint + index,
    filled: filled.has(firstPoint + index),
  }));
}
