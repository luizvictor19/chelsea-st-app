import {
  EXPLANATION_LEFT_TOLERANCE,
  EXPLANATION_MAX_GAP,
  INK_LEVEL,
  MARGIN_JITTER,
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

/** Left-hand ink column of a line, or -1 when the line is blank. */
function firstInkColumn(ink: Uint8Array, width: number, band: Band): number {
  for (let x = 0; x < width; x += 1) {
    for (let y = band.top; y < band.bottom; y += 1) {
      if (ink[y * width + x] === 1) {
        return x;
      }
    }
  }
  return -1;
}

/**
 * Where the text column starts, taken from the text itself.
 *
 * Not the same thing as the left edge of a shaded panel, though the two agree
 * whenever a page has one, and that coincidence hid the difference. Measured
 * across the book, prose begins at the same column on every page; the panel
 * begins there only when there is a panel. A page without one was falling back
 * to a tenth of the width, twenty-one pixels out, which is enough to fail a
 * fifteen-pixel tolerance and reject every line on the page.
 *
 * The mode rather than the minimum, because an indented heading or a stray mark
 * further left would drag a minimum with it. Lines within a couple of pixels
 * count together: a glyph starting on a round letter sits a pixel in from one
 * starting on a stem.
 */
export function textMargin(image: Bitmap): number {
  const { spans, ink, width } = collect(image);
  const starts = spans
    .map((span) => firstInkColumn(ink, width, span))
    .filter((column) => column >= 0);

  if (starts.length === 0) {
    return Math.trunc(width * 0.1);
  }

  let best = starts[0];
  let bestCount = -1;
  for (const candidate of starts) {
    const count = starts.filter(
      (start) => Math.abs(start - candidate) <= MARGIN_JITTER,
    ).length;
    if (count > bestCount || (count === bestCount && candidate < best)) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Every run of rows carrying ink outside the shaded panels: the page's text
 * lines, before any judgement about what kind of text they are.
 *
 * Separate from explanationLines because the two answer different questions.
 * This one asks where the text is; that one asks which of it is justified prose
 * rather than a two-column question and answer. A dictation needs the first and
 * must not be gated on the second.
 */
export function inkLines(image: Bitmap): readonly Band[] {
  return collect(image).spans;
}

function collect(image: Bitmap) {
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

  return { spans, ink, width, height };
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
export function explanationLines(image: Bitmap): readonly Band[] {
  const { spans, ink, width } = collect(image);
  // Taken from the text, not from the shaded panel. They agree on a page that
  // has a panel, which is why the difference went unnoticed until a page
  // without one rejected every line it had.
  const left = textMargin(image);

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
