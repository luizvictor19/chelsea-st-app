import { createWorker, type Worker } from "tesseract.js";

import type { Bitmap, OcrReader, OcrWord } from "./types.ts";

/** Whatever the engine accepts as an image, named through its own signature. */
export type TesseractSource = Parameters<Worker["recognize"]>[0];

export type TesseractReaderOptions = {
  /**
   * Turns pixels into something the engine will take. Injected because the two
   * places this runs differ: node encodes a PNG buffer, the browser hands over
   * a canvas. The pipeline itself never learns which.
   */
  readonly encode: (image: Bitmap) => Promise<TesseractSource>;
  readonly language?: string;
};

export type ClosableOcrReader = OcrReader & {
  /** Terminates the worker. Leaving it running keeps the process alive. */
  close(): Promise<void>;
};

/**
 * The real engine behind the OcrReader port.
 *
 * One worker, created on first use and reused, because starting one costs far
 * more than a page does. Parameters are set per call: the margin reader needs
 * different segmentation modes and a digits-only alphabet, and both have to be
 * cleared afterwards or they leak into the next read.
 */
export function createTesseractReader(
  options: TesseractReaderOptions,
): ClosableOcrReader {
  const language = options.language ?? "eng";
  let worker: Worker | null = null;

  async function ensureWorker(): Promise<Worker> {
    if (worker === null) {
      worker = await createWorker(language);
    }
    return worker;
  }

  return {
    async read(image, readOptions) {
      const active = await ensureWorker();
      await active.setParameters({
        tessedit_pageseg_mode: String(
          readOptions?.pageSegmentation ?? 3,
          // The enum is a string union of the same digits; the cast keeps the
          // segmentation mode a number everywhere else in the pipeline.
        ) as Parameters<Worker["setParameters"]>[0]["tessedit_pageseg_mode"],
        tessedit_char_whitelist: readOptions?.allowedCharacters ?? "",
      });

      const source = await options.encode(image);
      const { data } = await active.recognize(source, {}, { blocks: true });

      const words: OcrWord[] = [];
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            for (const word of line.words) {
              const text = word.text.trim();
              if (text.length > 0) {
                words.push({
                  text,
                  x: word.bbox.x0,
                  y: word.bbox.y0,
                  width: word.bbox.x1 - word.bbox.x0,
                  height: word.bbox.y1 - word.bbox.y0,
                  confidence: word.confidence,
                  // Normalised the same way the word's own text is, because
                  // the two are compared against each other before either is
                  // cut. The word is trimmed on the line above, so a whitespace
                  // character left in here would make them disagree and turn
                  // the splitting off without saying so.
                  symbols: (word.symbols ?? [])
                    .filter((symbol) => symbol.text.trim().length > 0)
                    .map((symbol) => ({
                      text: symbol.text,
                      x: symbol.bbox.x0,
                      width: symbol.bbox.x1 - symbol.bbox.x0,
                    })),
                });
              }
            }
          }
        }
      }
      return words;
    },

    async close() {
      if (worker !== null) {
        await worker.terminate();
        worker = null;
      }
    },
  };
}
