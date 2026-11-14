/**
 * The choice that waits for its panel (#353). In one column a click on a
 * row scrolls to the panel at once (#341), but the panel that arrives is not
 * the one that was measured: on the first choice it was the short "Escolha
 * uma palavra" and the page ended before its top could reach the top of the
 * screen, and a smooth scroll could be cut short when the panel changed. The
 * click marks the row here, and the new panel, when it mounts, takes the mark
 * and scrolls once more to where it really is.
 *
 * Only a click that scrolled marks: opening a link with the panel already
 * open, or reloading, moves nobody's screen.
 *
 * Module state, so a plain module both the link and the panels import.
 */

let pending: string | null = null;

export function markArrival(rowId: string): void {
  pending = rowId;
}

/** True once for the marked row, and then never again until a new mark. */
export function takeArrival(rowId: string): boolean {
  if (pending !== rowId) return false;
  pending = null;
  return true;
}
