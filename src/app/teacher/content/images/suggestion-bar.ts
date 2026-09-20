/**
 * What the suggestion bar is filled to, and how far it may creep past that.
 *
 * The bar is the pass: it appears at zero when a run starts, climbs to the
 * lesson's total, and stays full when the run ends. It was briefly the state
 * of the lesson instead, which was worse in the case that matters — on a
 * lesson whose words all carry a suggestion the state cannot move, so the bar
 * stood full and still for the whole run, saying nothing at the one moment
 * there was something to say.
 *
 * Before the first click there is no bar at all. The state is in the sentence
 * beside it, which says how many of the lesson's words carry a suggestion
 * whether anything has run or not.
 *
 * "Never goes backwards" is a rule inside a pass and not between passes.
 * Zeroing to start a new one is not undoing work; it is measuring a different
 * thing.
 */

/**
 * A pass as the bar sees it: how far it has got, how big the lesson is, the
 * end of the batch in flight, and whether the fill may animate at all.
 */
export type Pass = {
  readonly covered: number;
  readonly total: number;
  readonly racingTo: number | null;
  /** True for the one frame a pass is being put back to zero. */
  readonly instant: boolean;
};

/**
 * Where every pass starts, and the reason it is a function rather than an
 * object literal written at the call site.
 *
 * `instant` is the whole of it. A pass beginning after another one finished
 * finds the fill at 100%, and putting covered back to zero while the element
 * still wears the settling class animates a 220ms descent — so the forced
 * layout that is meant to fix zero as the value to come from reads a point
 * half way down it, and the race begins from the middle of a retreat. The
 * first pass of a page load looked right only because there was nothing to
 * descend from.
 *
 * Two calls give the same thing whatever happened in between, which is the
 * property the test holds: every pass starts from the same place.
 */
export function beginPass(total: number): Pass {
  return { covered: 0, total, racingTo: null, instant: true };
}

/**
 * Which of the three the fill wears.
 *
 * This is the boundary of what this module can be held to. Everything else
 * here is numbers, and confirmedWords is tested for never going backwards
 * inside a pass — but the bug that made a second run start from the middle
 * had every confirmed number right. What moved wrongly was the width in the
 * DOM, under a transition nobody had asked for. A monotone-numbers test does
 * not cover the animation, and reading it as though it did is how that bug
 * got written in the first place.
 */
export function fillClass(
  pass: Pass,
): "is-instant" | "is-racing" | "is-settling" {
  if (pass.instant) return "is-instant";
  return pass.racingTo === null ? "is-settling" : "is-racing";
}

/** How far into the batch in flight the fill may creep, as a fraction. */
export const RACE_REACH = 0.9;

/**
 * How long the fill takes to slide onto a confirmed number, and how long the
 * loop waits before asking for the next batch.
 *
 * One number for both, because they are the same moment seen from two sides.
 * The settle used to be set and immediately overwritten: React batches two
 * updates in one tick, and there was no await between settling a batch and
 * starting the next race, so the settling frame was never committed and the
 * fill went straight from one estimate to the next. The confirmed number —
 * the only true thing the bar ever shows — was never drawn during a pass.
 *
 * The stylesheet reads this through the --settle custom property rather than
 * carrying a copy of it: a duration written in two places that have to agree
 * is one of the pairs that drifts without anything failing.
 */
export const SETTLE_MS = 220;

/**
 * The confirmed fill, held to never going backwards inside a run.
 *
 * The count comes from the server on every re-render, and a run only ever
 * adds suggestions, so it should climb on its own. `floor` is here because
 * "should" is not "does": a re-render carrying an older count, for any reason
 * at all, would walk the bar back in front of the teacher, and a bar that
 * goes backwards while a run is going reads as work being undone.
 *
 * Outside a run there is no floor to hold and the count is simply the truth,
 * which is what a floor of zero gives.
 */
export function confirmedWords(serverCount: number, floor: number): number {
  return Math.max(0, Math.max(serverCount, floor));
}

/**
 * Where the fill may creep to while a batch is in flight, or null for no race.
 *
 * Null in the two cases that matter. Nothing in flight, so there is nothing to
 * estimate; and a lesson whose words all carry a suggestion already, where the
 * batch in flight cannot add one — there the bar is full, it stays full, and a
 * race would be motion invented out of nothing.
 *
 * The reach is what keeps the estimate short of the end of its own segment, so
 * the fill cannot arrive at a number the server has not confirmed however long
 * the batch takes.
 */
export function raceTarget(
  confirmed: number,
  total: number,
  batchWords: number | null,
): number | null {
  if (batchWords === null || batchWords <= 0) return null;
  const room = Math.min(batchWords, total - confirmed);
  if (room <= 0) return null;
  return confirmed + RACE_REACH * room;
}

/** A percentage string for a width, guarded against a lesson of no words. */
export function widthOf(part: number, total: number): string {
  if (total <= 0) return "0%";
  const fraction = Math.min(1, Math.max(0, part / total));
  return `${(fraction * 100).toFixed(2)}%`;
}
