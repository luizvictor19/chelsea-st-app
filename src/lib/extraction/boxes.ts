import { MERGE_GAP, MIN_BOX_HEIGHT, ROW_SHADED_FRACTION } from "./constants.ts";
import type { Mask } from "./image.ts";
import type { Band } from "./types.ts";

/**
 * Groups the shaded rows into the boxes they belong to.
 *
 * Three steps, and the middle one is the whole reason this is not a one-liner:
 *
 * 1. A row counts as shaded when enough of it is, which turns the mask into
 *    contiguous runs.
 * 2. Runs separated by a small gap are rejoined. A line packed with words loses
 *    enough shaded pixels to fall under the row threshold, so a single dense box
 *    arrives as two or three runs with thin gaps between them. Without this the
 *    same box is ingested several times, each holding part of the content.
 * 3. Runs left shorter than the minimum are dropped: they are underline
 *    artifacts, never content.
 */
export function boxes(mask: Mask): readonly Band[] {
  const runs: { top: number; bottom: number }[] = [];
  let start: number | null = null;

  for (let y = 0; y < mask.height; y += 1) {
    let shaded = 0;
    const row = y * mask.width;
    for (let x = 0; x < mask.width; x += 1) {
      shaded += mask.data[row + x];
    }
    const isShaded = shaded / mask.width > ROW_SHADED_FRACTION;

    if (isShaded && start === null) {
      start = y;
    } else if (!isShaded && start !== null) {
      runs.push({ top: start, bottom: y });
      start = null;
    }
  }
  if (start !== null) {
    runs.push({ top: start, bottom: mask.height });
  }

  const merged: { top: number; bottom: number }[] = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && run.top - previous.bottom <= MERGE_GAP) {
      previous.bottom = run.bottom;
    } else {
      merged.push({ ...run });
    }
  }

  return merged
    .filter((band) => band.bottom - band.top >= MIN_BOX_HEIGHT)
    .map((band) => ({ top: band.top, bottom: band.bottom }));
}
