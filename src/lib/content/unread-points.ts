/**
 * The question a page asks when a number printed in its margin was never read.
 *
 * A page carrying blocks above its own first number is ordinary: what is
 * printed there was printed under the last point of the page before, and
 * `pointForBlock` files it there. What is not ordinary is a page where the
 * book's own order says a number stands between the two. Then the blocks above
 * the first number may belong to the point before or to the unread one, nothing
 * on the page decides, and `pointForBlock` answers null rather than guessing.
 *
 * Null is where this begins. The screen used to treat it as a dead end and tell
 * the teacher to upload the previous page, which is the wrong instruction: the
 * previous page is already in the upload, that is where the point before came
 * from. The number is missing from *this* page, and the only thing nobody knows
 * is which block it starts at. That is a question a person can answer by
 * looking, so it is asked.
 *
 * The answer is deliberately shaped as a placement and nothing more. A number
 * and the height it starts at is exactly what the margin reader would have
 * produced had it read the number, so the answer joins the settled placements
 * and every rule downstream carries on unchanged. Nothing here files a block;
 * `pointForBlock` still does all of it.
 */
import type { PageOpening, Placement } from "../extraction/reconcile.ts";

/**
 * Where a point the reader missed begins, as the teacher answered it.
 *
 * `top` is the top of the block the point starts at. Null is the explicit way
 * out: the point does not begin on this page at all. Without that answer the
 * screen would force a wrong one whenever the number really is printed
 * somewhere else, and a wrong placement here is a misfiling nothing later can
 * see.
 */
export type PointStart = {
  readonly number: number;
  readonly top: number | null;
};

/**
 * The numbers the book printed between the page before and this page's first.
 *
 * Points run consecutively, which is how the book is printed and not a guess
 * about it, so the interval between two of them names its members exactly.
 *
 * Empty in three cases, each for its own reason. With nothing before the page
 * there is no interval: the page opens the upload, and what it needs is the
 * page before rather than an answer. With no number on the page there is no
 * upper end. And with a first number at or below the point before there is no
 * interval either: that is a misreading, not a number nobody read, and listing
 * points here would ask the teacher to place ones that are not missing.
 */
export function unreadNumbers(
  opening: PageOpening,
  placements: readonly Placement[],
): readonly number[] {
  if (opening.precedingPoint === null || placements.length === 0) {
    return [];
  }
  const first = placements.reduce((lowest, placement) =>
    placement.y < lowest.y ? placement : lowest,
  );
  const numbers: number[] = [];
  for (
    let number = opening.precedingPoint + 1;
    number < first.number;
    number += 1
  ) {
    numbers.push(number);
  }
  return numbers;
}

/** The missing numbers the teacher has not answered for yet. */
export function pendingNumbers(
  missing: readonly number[],
  starts: readonly PointStart[],
): readonly number[] {
  return missing.filter(
    (number) => !starts.some((start) => start.number === number),
  );
}

/**
 * The answers that place something, as placements the page now carries.
 *
 * "It does not start on this page" places nothing, on purpose: it is an answer
 * to the question and not an answer about a height. The page then still has a
 * number missing above its first, `pointForBlock` still returns null for the
 * blocks up there, and the screen still holds the page. That is the behaviour
 * the teacher asked for by choosing it.
 */
export function startPlacements(
  starts: readonly PointStart[],
): readonly Placement[] {
  return starts
    .filter(
      (start): start is PointStart & { readonly top: number } =>
        start.top !== null,
    )
    .map((start) => ({ number: start.number, y: start.top }));
}

/** The numbers an answer actually placed, which are the ones the page writes. */
export function answeredNumbers(
  starts: readonly PointStart[],
): readonly number[] {
  return startPlacements(starts).map((placement) => placement.number);
}

/**
 * Why the blocks above a page's first number cannot be filed.
 *
 * Three causes, and the point of naming them apart is that only one of them is
 * ever true at a time. The screen used to offer two of them in a single
 * sentence and lead with the wrong one: it told the teacher to upload the
 * previous page whenever a block could not be filed, on a page whose previous
 * page is what the point above it came from. A page cannot be missing and
 * present at once, and the field that says which is already on the page.
 *
 *   - `no-page-before`: nothing in the book precedes this page. The point above
 *     it is genuinely somewhere else, and only the page carrying it can say.
 *   - `unread-numbers`: the page before is here, and the book's own order says
 *     a number stands between it and this page's first. Nobody read it, so it
 *     is printed on this page with nothing naming it. This one is a question,
 *     not a message.
 *   - `elsewhere`: the same, after the teacher answered that the number does
 *     not begin on this page. Then it begins on one that is not in the upload,
 *     or the page before was read wrong. Either way the answer is another page.
 *
 * Null when nothing is wrong, which is the ordinary case.
 */
export type UnplacedCause =
  | { readonly kind: "no-page-before" }
  | { readonly kind: "unread-numbers"; readonly numbers: readonly number[] }
  | { readonly kind: "elsewhere"; readonly numbers: readonly number[] };

/**
 * @param unplaced how many blocks the page cannot file. Passed in rather than
 *   recomputed, because `pointForBlock` owns that answer and a second copy of
 *   the rule here is a second thing to keep in step.
 */
export function unplacedCause(
  opening: PageOpening,
  placements: readonly Placement[],
  starts: readonly PointStart[],
  unplaced: number,
): UnplacedCause | null {
  if (unplaced === 0) {
    return null;
  }
  if (opening.precedingPoint === null) {
    return { kind: "no-page-before" };
  }
  const missing = unreadNumbers(opening, placements);
  if (missing.length === 0) {
    // The page before is here and the numbers leave no gap, yet something is
    // still unfiled. Nothing on the page can name a cause, so none is invented.
    return { kind: "no-page-before" };
  }
  const pending = pendingNumbers(missing, starts);
  return pending.length > 0
    ? { kind: "unread-numbers", numbers: pending }
    : { kind: "elsewhere", numbers: missing };
}
