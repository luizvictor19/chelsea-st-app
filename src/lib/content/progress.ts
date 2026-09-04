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
  /** Zero when the book has no ceiling yet, so a bar can render at all. */
  readonly fraction: number;
};

/** How far a book is, against the ceiling the teacher typed. */
export function progress(
  points: readonly PointProgress[],
  lastPoint: number | null,
): Progress {
  const total = lastPoint ?? 0;
  const filled = points.filter((point) => point.filled).length;
  return {
    filled,
    total,
    fraction: total === 0 ? 0 : Math.min(1, filled / total),
  };
}

/** Every point of a book, filled or not, so a screen can list them all. */
export function pointsUpTo(
  filledNumbers: readonly number[],
  lastPoint: number | null,
): readonly PointProgress[] {
  if (lastPoint === null || lastPoint < 1) {
    return [];
  }
  const filled = new Set(filledNumbers);
  return Array.from({ length: lastPoint }, (_, index) => ({
    number: index + 1,
    filled: filled.has(index + 1),
  }));
}
