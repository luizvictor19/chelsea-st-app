import {
  MARGIN_MAX_DIGITS,
  MARGIN_READ_CONFIGS,
  MARGIN_RIGHT_TOLERANCE,
  MARGIN_UPSCALE,
} from "./constants.ts";
import { crop, resize } from "./image.ts";
import type { Bitmap, MarginNumber, OcrReader } from "./types.ts";

const DIGITS = "0123456789";

/**
 * Reads the point numbers printed in the left margin.
 *
 * Three crops with different page segmentation modes, unioned. That is not
 * belt and braces: no single combination finds every number, and the three
 * together found all 76 across the measured set. The strip is enlarged first
 * because the digits are small enough that the engine misses them at page
 * scale.
 *
 * Everything returned here is a raw reading, noise included. Deciding which
 * readings are real is the sequence filter's job, not this one's: confidence is
 * useless for it, since a legitimate 123 came back with confidence 0 while a
 * spurious 1 came back with 68.
 */
export type MarginReading = MarginNumber & {
  /** How many of the configured crops saw this number. */
  readonly agreement: number;
};

/**
 * The full detail of what the margin crops saw, agreement count included.
 *
 * Kept separate from marginNumbers because the count is a diagnostic, not yet a
 * decision: no rule uses it until there is a measurement saying it separates
 * signal from noise.
 */
export async function marginReadings(
  image: Bitmap,
  left: number,
  reader: OcrReader,
): Promise<readonly MarginReading[]> {
  // First y wins, so a number found by more than one configuration keeps the
  // position of the configuration that saw it first.
  const found = new Map<number, { y: number; agreement: number }>();

  for (const config of MARGIN_READ_CONFIGS) {
    const right = Math.max(left + config.padding, 8);
    const strip = crop(image, 0, 0, right, image.height);
    if (strip.width === 0 || strip.height === 0) {
      continue;
    }
    const enlarged = resize(
      strip,
      strip.width * MARGIN_UPSCALE,
      strip.height * MARGIN_UPSCALE,
    );

    const words = await reader.read(enlarged, {
      pageSegmentation: config.pageSegmentation,
      allowedCharacters: DIGITS,
    });

    const seenHere = new Set<number>();
    for (const word of words) {
      const digits = word.text.replace(/\D/g, "");
      if (digits.length === 0 || digits.length > MARGIN_MAX_DIGITS) {
        continue;
      }
      // Must begin in the margin. A number starting level with the text column
      // is part of the page, not the ruler down its side.
      if (
        Math.trunc(word.x / MARGIN_UPSCALE) >=
        left - MARGIN_RIGHT_TOLERANCE
      ) {
        continue;
      }
      const value = Number(digits);
      const existing = found.get(value);
      if (existing === undefined) {
        found.set(value, {
          y: Math.trunc(word.y / MARGIN_UPSCALE),
          agreement: 1,
        });
        seenHere.add(value);
      } else if (!seenHere.has(value)) {
        existing.agreement += 1;
        seenHere.add(value);
      }
    }
  }

  return [...found.entries()]
    .map(([value, { y, agreement }]) => ({ value, y, agreement }))
    .sort((a, b) => a.y - b.y || a.value - b.value);
}

/**
 * Reads the point numbers printed in the left margin.
 *
 * Three crops with different page segmentation modes, unioned. That is not
 * belt and braces: no single combination finds every number, and the three
 * together found all 76 across the measured set. The strip is enlarged first
 * because the digits are small enough that the engine misses them at page
 * scale.
 *
 * Everything returned here is a raw reading, noise included. Deciding which
 * readings are real is reconcilePoints's job, not this one's: confidence is
 * useless for it, since a legitimate 123 came back with confidence 0 while a
 * spurious 1 came back with 68.
 */
export async function marginNumbers(
  image: Bitmap,
  left: number,
  reader: OcrReader,
): Promise<readonly MarginNumber[]> {
  const readings = await marginReadings(image, left, reader);
  return readings.map(({ value, y }) => ({ value, y }));
}
