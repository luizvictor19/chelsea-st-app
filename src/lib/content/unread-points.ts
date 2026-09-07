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

/**
 * Whether one missing number may begin at a given block, given the rest.
 *
 * The numbers run down the margin in increasing order, which is how the book is
 * printed and not a guess about it. So an answer that puts a bigger number
 * above a smaller one, or two numbers at the same block, describes a page that
 * cannot exist.
 *
 * It has to be checked both ways round, and only one way was. Guarding a number
 * against the ones already placed below it leaves the whole thing reachable by
 * answering in the other order: place 6 at the first block, then 5 at the
 * second, and the placements are 6 above 5. Nothing downstream catches it,
 * because a page whose numbers descend is not a page with a hole in it.
 * `pointForBlock` files every block happily, `unplacedBlocks` finds none,
 * the page confirms, and the heading reads "Pontos 5, 6 e 7" while the two
 * points are written to each other's blocks. That is the silent misfiling this
 * question exists to prevent, arrived at from the other side.
 *
 * A number's own answer never rules out the block it is on: the block the
 * teacher chose has to stay visible, or the answer cannot be seen or changed.
 * An answer of "it does not start on this page" placed nothing, so it says
 * nothing about where anything else sits.
 */
export function mayStartAt(
  value: number,
  top: number,
  starts: readonly PointStart[],
): boolean {
  return starts.every((start) => {
    if (start.top === null || start.number === value) {
      return true;
    }
    return start.number < value ? top > start.top : top < start.top;
  });
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
 * Four causes, and the point of naming them apart is that only one of them is
 * ever true at a time. The screen used to offer two of them in a single
 * sentence and lead with the wrong one: it told the teacher to upload the
 * previous page whenever a block could not be filed, on a page whose previous
 * page is what the point above it came from. A page cannot be missing and
 * present at once, and the field that says which is already on the page.
 *
 *   - `no-page-before`: nothing in the book precedes this page. The point above
 *     it is genuinely somewhere else, and only the page carrying it can say.
 *   - `unexplained`: a page before it, no gap between the two, and a block that
 *     still cannot be filed. Nothing on the page names a cause, so this one
 *     names none either. It used to be folded into `no-page-before`, which made
 *     the screen say "there is no previous page in this upload" about a page
 *     whose previous page is where its preceding point came from: the same
 *     false instruction this whole cause exists to have stopped giving.
 *   - `unread-numbers`: the page before is here, and the book's own order says
 *     a number stands between it and this page's first. Nobody read it, so it
 *     is printed on this page with nothing naming it. This one is a question,
 *     not a message.
 *   - `elsewhere`: the same, after the teacher answered that a number does not
 *     begin on this page. Then it begins on one that is not in the upload, or
 *     the page before was read wrong. Either way the answer is another page.
 *     It carries only the numbers actually answered that way: naming one the
 *     teacher had just placed on this page told them it was somewhere else.
 *
 * Always a cause, never null: this is asked only about a page that already has
 * a block it cannot file, and the caller has that count. Answering "no cause"
 * would be a third thing to test for at every call and it could never happen.
 */
export type UnplacedCause =
  | { readonly kind: "no-page-before" }
  | { readonly kind: "unexplained" }
  | { readonly kind: "unread-numbers"; readonly numbers: readonly number[] }
  | { readonly kind: "elsewhere"; readonly numbers: readonly number[] };

export function unplacedCause(
  opening: PageOpening,
  placements: readonly Placement[],
  starts: readonly PointStart[],
): UnplacedCause {
  if (opening.precedingPoint === null) {
    return { kind: "no-page-before" };
  }
  const missing = unreadNumbers(opening, placements);
  if (missing.length === 0) {
    // The page before is here and the numbers leave no gap, yet something is
    // still unfiled. Nothing on the page can name a cause, so none is invented.
    return { kind: "unexplained" };
  }
  const pending = pendingNumbers(missing, starts);
  if (pending.length > 0) {
    return { kind: "unread-numbers", numbers: pending };
  }
  return {
    kind: "elsewhere",
    numbers: missing.filter((number) =>
      starts.some((start) => start.number === number && start.top === null),
    ),
  };
}
