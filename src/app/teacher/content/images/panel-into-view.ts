/**
 * Whether choosing a word or a scene should bring the panel into view (#341,
 * #343).
 *
 * Below lg the list and the panel are one column, the panel after the whole
 * list, and choosing a word near the top changed nothing on screen: the panel
 * opened a long way down and the window stayed where it was. From lg the
 * panel sits beside the list and is always in view, and moving the window
 * there would only shake the screen.
 *
 * The answer is read from the boxes on screen at the moment of the click and
 * not from a breakpoint copied out of the stylesheet: a copy of lg here is one
 * more pair of numbers that has to agree, and nothing would fail the day the
 * grid changed.
 */

/** The id of the list column, so the click can measure it. */
export const WORD_LIST_ID = "lista";

/**
 * The id of a row in the list, on its link, so "Voltar à lista" can find it
 * (#351). A word and a scene may share no uuid, but the prefix keeps the two
 * apart all the same.
 */
export function rowId(kind: "word" | "scene", id: string): string {
  return `linha-${kind === "word" ? "palavra" : "cena"}-${id}`;
}

/** The part of a DOMRect this needs; plain numbers so a test can make one. */
export type Box = {
  readonly left: number;
  readonly right: number;
};

/**
 * True when the panel shares the list's column, which is what one column
 * means: the panel starts left of where the list ends, so it can only be
 * above or below it, and it is below.
 *
 * Side by side the grid keeps a gap of 2rem between the two, so the panel's
 * left edge is past the list's right edge by that much and no rounding of a
 * fractional pixel can bring them together. That is why this compares the
 * two edges and not the heights: the list column stretches to the row's
 * height on wide screens and runs as long as the lesson below lg, and neither
 * height says anything about where the panel is.
 */
export function panelBelowList(list: Box, panel: Box): boolean {
  return panel.left < list.right;
}

/** Smooth, unless the teacher asked the system for less motion. */
export function scrollBehaviour(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth";
}
