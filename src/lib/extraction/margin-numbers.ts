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
export async function marginNumbers(
  image: Bitmap,
  left: number,
  reader: OcrReader,
): Promise<readonly MarginNumber[]> {
  // First y wins, so a number found by more than one configuration keeps the
  // position of the configuration that saw it first.
  const found = new Map<number, number>();

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
      if (!found.has(value)) {
        found.set(value, Math.trunc(word.y / MARGIN_UPSCALE));
      }
    }
  }

  return [...found.entries()]
    .map(([value, y]) => ({ value, y }))
    .sort((a, b) => a.y - b.y || a.value - b.value);
}
