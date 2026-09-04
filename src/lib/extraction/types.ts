/**
 * RGBA pixels, row-major, four bytes per pixel.
 *
 * Deliberately the same shape as the browser's ImageData, so a canvas can hand
 * one over with no conversion, and a decoded PNG in a test can be built by hand.
 * Nothing in the pipeline knows where the pixels came from.
 */
export type Bitmap = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
};

/** A vertical run of rows, `bottom` exclusive. */
export type Band = {
  readonly top: number;
  readonly bottom: number;
};

/** A number read from the left margin, with the row it was found on. */
export type MarginNumber = {
  readonly value: number;
  readonly y: number;
};

/** One word as the OCR engine reported it, in the coordinates it was given. */
export type OcrWord = {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  /** Needed to measure the gap between words, which is where a column shows. */
  readonly width: number;
  readonly height: number;
  readonly confidence: number;
};

/**
 * What the pipeline needs from an OCR engine, and nothing more.
 *
 * Injected rather than imported so the pixel stages can be tested with no engine
 * at all, and so the engine can be swapped without touching the pipeline. The
 * browser passes a tesseract.js adapter; tests pass a scripted one.
 */
export type OcrReader = {
  /**
   * @param pageSegmentation Tesseract's psm. The margin reader needs more than
   *   one, because no single mode finds every number.
   * @param allowedCharacters Restricts the alphabet, used to read digits only.
   */
  read(
    image: Bitmap,
    options?: {
      readonly pageSegmentation?: number;
      readonly allowedCharacters?: string;
    },
  ): Promise<readonly OcrWord[]>;
};
