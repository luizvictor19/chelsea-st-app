/**
 * Rereads the one-character cells of a table panel with a punctuation alphabet.
 *
 * The punctuation grid of point 36 comes back with its terms right and its
 * glyphs wrong: the comma reads "5", the semi-colon reads ".", the colon reads
 * "-". Alone in a cell, a punctuation mark has no word around it for the engine
 * to lean on, and it is offered the whole alphabet to choose from.
 *
 * The margin reader answers the same shape of problem by asking again with the
 * alphabet closed down to digits, and the second-read trick has now paid twice
 * in this pipeline. This asks what it would be worth here, and asks it of every
 * one-character cell in every grid panel of both books, not only of the three
 * that are known to be wrong: a rereading that mends those three and breaks a
 * correct "." somewhere else is not a mend.
 *
 * Measures and changes nothing. Every cell is printed before and after so the
 * two can be judged against the book, which is the only authority on what is
 * printed there. The pages live outside the repository, so this is a local tool
 * and never runs in CI.
 *
 *   node scripts/measure-punctuation-glyphs.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import { boxes } from "../src/lib/extraction/boxes.ts";
import {
  BOX_PAGE_SEGMENTATION,
  TABLE_COLUMN_GAP,
  TABLE_HEIGHT,
  TABLE_LINE_TOLERANCE,
  TABLE_SECOND_PAGE_SEGMENTATION,
} from "../src/lib/extraction/constants.ts";
import { cleanCell } from "../src/lib/extraction/grammar-table.ts";
import { splitFusedWords } from "../src/lib/extraction/fused-words.ts";
import {
  boxLeft,
  crop,
  normalise,
  resize,
  shadedMask,
} from "../src/lib/extraction/image.ts";
import { createTesseractReader } from "../src/lib/extraction/ocr-tesseract.ts";
import { mergeReads } from "../src/lib/extraction/second-read.ts";
import {
  printedLines,
  tableContent,
} from "../src/lib/extraction/table-layout.ts";
import type { Bitmap, OcrWord } from "../src/lib/extraction/types.ts";
import { BOOK_1, BOOK_2 } from "./books.ts";

/** The same enlargement the pipeline reads a panel at. */
const SCALE = 2;

/**
 * The alphabet the reread is offered.
 *
 * The marks this book teaches, and nothing else. A digit or a letter left in
 * would put back the very choice the restriction exists to take away.
 */
const PUNCTUATION = ".,;:?!'\"-";

/** A lone glyph is enlarged again before the reread, as the margin strip is. */
const GLYPH_UPSCALE = 5;

/**
 * Tesseract's "raw line", which is the mode that reads most of these.
 *
 * Chosen by sweeping the five plausible modes against the punctuation panel of
 * point 36, at two upscales and two paddings. Modes 6, 7, 8 and 10 return the
 * "?" and nothing else at every combination. Mode 13 returns the "?", the full
 * stop and the colon; no mode and no combination returns the comma or the
 * semi-colon. This is the best of them, so that what the tool reports is the
 * trick at its best rather than the first setting tried.
 */
const SINGLE_CHARACTER_SEGMENTATION = 13;

/**
 * White around the glyph, in the panel's already-enlarged pixels.
 *
 * The same sweep: at 12 the wider modes lose the "?" as well, at 40 they keep
 * it. A lone mark needs white around it before the engine will call it a line.
 */
const GLYPH_PADDING = 40;

/**
 * The words that are a cell of one character, all on their own.
 *
 * The question is about a glyph alone in a cell, so the population has to be
 * cells and not words. Filtering the engine's words directly counts the "l" of
 * "l am" and the "a" of "a light", which are letters inside a cell of several
 * words: a punctuation-only reread can only destroy those, and counting them
 * among the failures would hide whether the reread costs anything real.
 *
 * The two rules `tableContent` cuts a panel with, in the same order: the run
 * cut at TABLE_COLUMN_GAP, then the panel's columns over it. A run split by a
 * column boundary yields more than one cell, which is why the columns are
 * needed here and the run alone will not do: the "?" of point 36 sits 25px from
 * "mark" and is still a cell of its own.
 */
function oneCharacterCells(words: readonly OcrWord[]): readonly OcrWord[] {
  const placed = words
    .map((word) => ({
      word,
      left: word.x / SCALE,
      right: (word.x + word.width) / SCALE,
      middle: (word.y + word.height / 2) / SCALE,
      height: word.height / SCALE,
    }))
    .filter((one) => one.word.text.trim() !== "");
  if (placed.length === 0) {
    return [];
  }
  const tolerance =
    median(placed.map((one) => one.height)) * TABLE_LINE_TOLERANCE;

  const lines: (typeof placed)[] = [];
  for (const one of [...placed].sort((a, b) => a.middle - b.middle)) {
    const current = lines[lines.length - 1];
    if (
      current === undefined ||
      Math.abs(one.middle - median(current.map((each) => each.middle))) >
        tolerance
    ) {
      lines.push([one]);
    } else {
      current.push(one);
    }
  }

  const starts: number[] = [];
  const across = lines.map((line) => [...line].sort((a, b) => a.left - b.left));
  for (const line of across) {
    starts.push(line[0].left);
    let previousRight = line[0].right;
    for (const one of line.slice(1)) {
      if (one.left - previousRight >= TABLE_COLUMN_GAP) {
        starts.push(one.left);
      }
      previousRight = one.right;
    }
  }
  const columns: number[] = [];
  for (const start of [...starts].sort((a, b) => a - b)) {
    if (
      columns.length === 0 ||
      start - columns[columns.length - 1] >= TABLE_COLUMN_GAP
    ) {
      columns.push(start);
    }
  }
  const columnAt = (left: number) => {
    let at = 0;
    for (let index = 1; index < columns.length; index += 1) {
      if (columns[index] <= left) {
        at = index;
      }
    }
    return at;
  };

  const alone: OcrWord[] = [];
  for (const line of across) {
    const cells = new Map<number, (typeof line)[number][]>();
    for (const one of line) {
      const at = columnAt(one.left);
      cells.set(at, [...(cells.get(at) ?? []), one]);
    }
    for (const cell of cells.values()) {
      if (cell.length === 1 && cleanCell(cell[0].word.text).length === 1) {
        alone.push(cell[0].word);
      }
    }
  }
  return alone;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function decode(path: string): Bitmap {
  const png = PNG.sync.read(readFileSync(path));
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data),
  };
}

async function encode(image: Bitmap): Promise<Buffer> {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(
    image.data.buffer,
    image.data.byteOffset,
    image.data.length,
  );
  return PNG.sync.write(png);
}

const reader = createTesseractReader({ encode });

type Reread = {
  readonly file: string;
  readonly top: number;
  readonly before: string;
  readonly after: string;
  readonly confidence: number;
};

const rereads: Reread[] = [];

for (const fixtures of [BOOK_1, BOOK_2]) {
  if (!existsSync(fixtures)) {
    console.log(`${fixtures}: ausente, pulado`);
    continue;
  }
  const files = readdirSync(fixtures)
    .filter((file) => file.endsWith(".png"))
    .sort();

  for (const file of files) {
    const page = normalise(decode(join(fixtures, file)));
    const mask = shadedMask(page);
    const left = boxLeft(mask);

    for (const band of boxes(mask)) {
      const region = crop(page, left, band.top, page.width, band.bottom);
      const enlarged = resize(
        region,
        region.width * SCALE,
        region.height * SCALE,
      );
      // The pipeline's own reading, so the cells rereard here are the cells the
      // teacher is looking at.
      const isTall = band.bottom - band.top > TABLE_HEIGHT;
      const once = await reader.read(
        enlarged,
        isTall ? undefined : { pageSegmentation: BOX_PAGE_SEGMENTATION },
      );
      const seen = isTall
        ? mergeReads(
            once,
            await reader.read(enlarged, {
              pageSegmentation: TABLE_SECOND_PAGE_SEGMENTATION,
            }),
          )
        : once;
      const read = splitFusedWords(enlarged, seen, SCALE);
      if (!isTall && printedLines(read, SCALE) <= 1) {
        continue;
      }

      const lone = oneCharacterCells(read);
      if (lone.length === 0) {
        continue;
      }
      console.log(`\n${file} @${band.top}`);
      for (const line of tableContent(read, SCALE).split("\n")) {
        console.log(`   ${line}`);
      }

      for (const word of lone) {
        const x = Math.max(0, Math.round(word.x) - GLYPH_PADDING);
        const y = Math.max(0, Math.round(word.y) - GLYPH_PADDING);
        const right = Math.min(
          enlarged.width,
          Math.round(word.x + word.width) + GLYPH_PADDING,
        );
        const bottom = Math.min(
          enlarged.height,
          Math.round(word.y + word.height) + GLYPH_PADDING,
        );
        const cell = crop(enlarged, x, y, right, bottom);
        const bigger = resize(
          cell,
          cell.width * GLYPH_UPSCALE,
          cell.height * GLYPH_UPSCALE,
        );
        const again = await reader.read(bigger, {
          pageSegmentation: SINGLE_CHARACTER_SEGMENTATION,
          allowedCharacters: PUNCTUATION,
        });
        const after = again
          .map((one) => one.text.trim())
          .join("")
          .trim();
        // The lowest of the words that make up `after`, so the number cannot
        // claim more than the whole reading is worth.
        const confidence =
          again.length > 0
            ? Math.min(...again.map((one) => one.confidence))
            : 0;
        rereads.push({
          file,
          top: band.top,
          before: cleanCell(word.text),
          after,
          confidence,
        });
        console.log(
          `      "${cleanCell(word.text)}" -> "${after}"  ` +
            `(confiança ${confidence.toFixed(0)}, ` +
            `x=${Math.round(word.x / SCALE)} y=${Math.round(word.y / SCALE)})`,
        );
      }
    }
    process.stderr.write(`  lida ${file}\n`);
  }
}

await reader.close();

const changed = rereads.filter((one) => one.after !== one.before);
const emptied = rereads.filter((one) => one.after === "");
console.log(
  `\n${rereads.length} células de um caractere em painel de grade, ` +
    `${changed.length} leram diferente, ${emptied.length} não leram nada`,
);
console.log("\nantes -> depois, por par:");
const pairs = new Map<string, number>();
for (const one of rereads) {
  const key = `"${one.before}" -> "${one.after}"`;
  pairs.set(key, (pairs.get(key) ?? 0) + 1);
}
for (const [pair, count] of [...pairs].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${pair}  ×${count}`);
}
