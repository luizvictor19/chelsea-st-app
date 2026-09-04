import type { Bitmap } from "../types.ts";

/**
 * Draws pages with the anatomy measured on the real book, in original content.
 *
 * Synthetic on purpose. A fixture cut from the book would make the reference
 * truth something a person squinted at and wrote down, and would put page
 * images in the repository. Here the truth is constructed: the test states the
 * geometry it drew, so a failure names the rule that broke rather than a
 * difference from whatever the extractor happened to do last time.
 *
 * Nothing here draws glyphs. Every pixel stage in the pipeline is geometric, so
 * a word is faithfully modelled by a dark rectangle, and the stages that do read
 * text are given a scripted OcrReader instead.
 */
export type Rgb = readonly [number, number, number];

export const PAGE_WHITE: Rgb = [255, 255, 255];
/** The shaded panel, measured at (232,235,243). */
export const PANEL: Rgb = [232, 235, 243];
export const INK: Rgb = [24, 24, 24];

export type MutablePage = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
};

export function blankPage(
  width: number,
  height: number,
  colour: Rgb = PAGE_WHITE,
): MutablePage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = colour[0];
    data[i * 4 + 1] = colour[1];
    data[i * 4 + 2] = colour[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

export function fillRect(
  page: MutablePage,
  left: number,
  top: number,
  width: number,
  height: number,
  colour: Rgb,
): void {
  for (let y = top; y < top + height; y += 1) {
    if (y < 0 || y >= page.height) {
      continue;
    }
    for (let x = left; x < left + width; x += 1) {
      if (x < 0 || x >= page.width) {
        continue;
      }
      const offset = (y * page.width + x) * 4;
      page.data[offset] = colour[0];
      page.data[offset + 1] = colour[1];
      page.data[offset + 2] = colour[2];
      page.data[offset + 3] = 255;
    }
  }
}

/** A shaded vocabulary or grammar panel, spanning to the right page edge. */
export function shadedBox(
  page: MutablePage,
  left: number,
  top: number,
  height: number,
): void {
  fillRect(page, left, top, page.width - left, height, PANEL);
}

export type LineOptions = {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly height?: number;
  /** Width of each drawn word. */
  readonly wordWidth?: number;
  /** Blank pixels between words. Ordinary word spacing is small. */
  readonly wordGap?: number;
  /** A single wide blank placed mid-line, which is what a two-column layout leaves. */
  readonly centreGap?: number;
};

/**
 * Draws one line of "text" as a run of dark rectangles.
 *
 * `centreGap` is the knob that separates an explanation from a question and
 * answer: prose runs the width of the column with only word spacing in it,
 * while two columns always leave a wide hole in the middle.
 */
export function inkLine(page: MutablePage, options: LineOptions): void {
  const height = options.height ?? 10;
  const wordWidth = options.wordWidth ?? 30;
  const wordGap = options.wordGap ?? 8;
  const centreGap = options.centreGap ?? 0;

  // Words are clipped to end exactly on the segment boundary, so the blank a
  // caller asks for is the blank it gets. Letting a word straddle the centre
  // would silently close the gap the test is about.
  const drawWords = (from: number, to: number) => {
    let x = from;
    while (x < to) {
      const width = Math.min(wordWidth, to - x);
      if (width <= 0) {
        break;
      }
      fillRect(page, x, options.top, width, height, INK);
      x += width + wordGap;
    }
  };

  if (centreGap > 0) {
    const centre = Math.trunc((options.left + options.right) / 2);
    drawWords(options.left, centre);
    drawWords(centre + centreGap, options.right);
  } else {
    drawWords(options.left, options.right);
  }
}

/** Hands the drawn page to the pipeline, which only ever sees a Bitmap. */
export function toBitmap(page: MutablePage): Bitmap {
  return { width: page.width, height: page.height, data: page.data };
}
