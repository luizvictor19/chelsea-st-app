import {
  EXPLANATION_LEFT_TOLERANCE,
  EXPLANATION_MAX_GAP,
  INK_LEVEL,
  MIN_LINE_HEIGHT,
  MIN_ROW_INK,
} from "./constants.ts";
import { shadedMask } from "./image.ts";
import type { Bitmap, Band } from "./types.ts";

/**
 * Luma exactly as PIL computes it for convert("L"), fixed point and all.
 *
 * The ink threshold was measured against PIL's numbers, so a different rounding
 * here would quietly move the threshold with it.
 */
function luma(red: number, green: number, blue: number): number {
  return (red * 19595 + green * 38470 + blue * 7471 + 0x8000) >> 16;
}

/**
 * Finds the lines that are explanation text rather than question and answer.
 *
 * The distinction is geometric, not linguistic. An explanation is justified
 * across the whole column: it starts on the text margin and has no wide gap
 * inside it. Question and answer are set in two columns, so they either start
 * well right of the margin or carry a gap in the middle. Nothing here reads a
 * word, which is why it survives the OCR being imperfect.
 */
export function explanationLines(image: Bitmap, left: number): readonly Band[] {
  const mask = shadedMask(image);
  const { width, height } = image;

  // Ink is dark and outside the shaded panel: panel text is a box, not prose.
  const ink = new Uint8Array(width * height);
  for (let i = 0, pixel = 0; i < ink.length; i += 1, pixel += 4) {
    const dark =
      luma(image.data[pixel], image.data[pixel + 1], image.data[pixel + 2]) <
      INK_LEVEL;
    ink[i] = dark && mask.data[i] === 0 ? 1 : 0;
  }

  const spans: Band[] = [];
  let start: number | null = null;
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      count += ink[row + x];
    }
    const hasInk = count > MIN_ROW_INK;
    if (hasInk && start === null) {
      start = y;
    } else if (!hasInk && start !== null) {
      if (y - start >= MIN_LINE_HEIGHT) {
        spans.push({ top: start, bottom: y });
      }
      start = null;
    }
  }
  if (start !== null && height - start >= MIN_LINE_HEIGHT) {
    spans.push({ top: start, bottom: height });
  }

  return spans.filter((span) => {
    // Collapse the line to the columns it touches anywhere in its height.
    const column = new Uint8Array(width);
    for (let y = span.top; y < span.bottom; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        if (ink[row + x] === 1) {
          column[x] = 1;
        }
      }
    }

    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x += 1) {
      if (column[x] === 1) {
        if (first === -1) {
          first = x;
        }
        last = x;
      }
    }
    if (first === -1) {
      return false;
    }

    let widestGap = 0;
    let run = 0;
    for (let x = first; x <= last; x += 1) {
      if (column[x] === 0) {
        run += 1;
        if (run > widestGap) {
          widestGap = run;
        }
      } else {
        run = 0;
      }
    }

    return (
      Math.abs(first - left) <= EXPLANATION_LEFT_TOLERANCE &&
      widestGap <= EXPLANATION_MAX_GAP
    );
  });
}
