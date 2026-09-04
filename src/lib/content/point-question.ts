/**
 * Whether the review screen still has to ask which point a page is, and which
 * point it will be written to.
 *
 * Pulled out of the screen because the two answers must not be tangled. The
 * question's visibility depends only on the page, which does not change while
 * the teacher types; the target depends on the answer, which does. Deriving the
 * visibility from the target unmounted the input on the first keystroke, so
 * "118" could never be typed and the page silently became point 1.
 */
export type PageQuestion = {
  readonly points: readonly number[];
  readonly inheritedPoint: number | null;
  readonly disputeCandidates: readonly number[];
};

export type PointChoice = {
  /** A number the page carries, or one the teacher picked from the candidates. */
  readonly pointNumber: number | null;
  readonly continuation: boolean;
  /** Free text, because it is being typed and may be half a number. */
  readonly typedPoint: string;
};

/**
 * True while the page needs an answer from the teacher.
 *
 * Derived from the page alone: either the batch left candidates it could not
 * choose between, or the page carries no number and the upload gave it nothing
 * to inherit from.
 */
export function asksForPoint(page: PageQuestion): boolean {
  return (
    page.disputeCandidates.length > 0 ||
    (page.points.length === 0 && page.inheritedPoint === null)
  );
}

/**
 * The point the page's content will be written to, or null while unanswered.
 *
 * A half-typed number is not an answer, so nothing may be written on it.
 */
export function chosenPoint(
  page: PageQuestion,
  choice: PointChoice,
): number | null {
  if (choice.continuation) {
    const typed = Number(choice.typedPoint);
    if (
      choice.typedPoint.trim() !== "" &&
      Number.isInteger(typed) &&
      typed > 0
    ) {
      return typed;
    }
    return page.inheritedPoint;
  }
  return choice.pointNumber;
}

/** Nothing may be confirmed until the page has a point to be written to. */
export function canConfirm(page: PageQuestion, choice: PointChoice): boolean {
  return chosenPoint(page, choice) !== null;
}
