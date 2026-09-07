/**
 * Measures the blank that tells a printed space from the space between letters.
 *
 * FUSED_WORD_GAP is what parts "itis" back into "it is" without a list of words
 * to substitute, and like the other panel constants it is only as good as the
 * two populations it sits between. This is the tool behind it. It reads the
 * panels the way the pipeline does, and prints, in page pixels:
 *
 *   - every blank inside a token the engine returned, which is the space
 *     between two letters of one word;
 *   - every blank between two tokens the engine did separate on the same
 *     printed line, which is a space the engine honoured;
 *   - the tokens whose own box holds a blank of the second kind, which are the
 *     ones the engine welded, and what the rule makes of each.
 *
 * The cut has to fall in the void between the first population's top and the
 * second's floor. A book whose print is tighter would close that void, and this
 * is what says so before a wrong space reaches a vocabulary_item.
 *
 * A book is named on the command line because the panels of one book are not
 * the panels of another. The pages live outside the repository, so this is a
 * local tool and never runs in CI.
 *
 *   node scripts/measure-fused-words.ts
 *   node scripts/measure-fused-words.ts --fixtures fixtures/real/book1
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import { boxes } from "../src/lib/extraction/boxes.ts";
import {
  BOX_PAGE_SEGMENTATION,
  FUSED_WORD_GAP,
  INK_LEVEL,
  TABLE_HEIGHT,
} from "../src/lib/extraction/constants.ts";
import { splitFusedWords } from "../src/lib/extraction/fused-words.ts";
import {
  boxLeft,
  crop,
  luma,
  normalise,
  resize,
  shadedMask,
} from "../src/lib/extraction/image.ts";
import { createTesseractReader } from "../src/lib/extraction/ocr-tesseract.ts";
import type { Bitmap, OcrWord } from "../src/lib/extraction/types.ts";
import { fixturesOption } from "./books.ts";

/** The same enlargement the pipeline reads a panel at. */
const SCALE = 2;
/** Wider than this between two tokens is a column, not a word space. */
const COLUMN = 40;
/** Two tokens whose middles are further apart than this are on separate lines. */
const SAME_LINE = 20;
const FIXTURES = fixturesOption();

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

/** The blanks between the first and last ink of a token's box, in page pixels. */
function blanks(image: Bitmap, word: OcrWord): readonly number[] {
  const from = Math.max(0, Math.round(word.x));
  const to = Math.min(image.width, Math.round(word.x + word.width));
  const top = Math.max(0, Math.round(word.y));
  const bottom = Math.min(image.height, Math.round(word.y + word.height));

  const inked: boolean[] = [];
  for (let x = from; x < to; x += 1) {
    let ink = false;
    for (let y = top; y < bottom && !ink; y += 1) {
      const pixel = (y * image.width + x) * 4;
      ink =
        luma(image.data[pixel], image.data[pixel + 1], image.data[pixel + 2]) <
        INK_LEVEL;
    }
    inked.push(ink);
  }

  const first = inked.indexOf(true);
  const last = inked.lastIndexOf(true);
  const found: number[] = [];
  let run = 0;
  for (let index = first; index <= last; index += 1) {
    if (!inked[index]) {
      run += 1;
      continue;
    }
    if (run > 0) {
      found.push(run / SCALE);
    }
    run = 0;
  }
  return found;
}

function histogram(label: string, values: readonly number[]): void {
  const counted = new Map<number, number>();
  for (const value of values) {
    const bucket = Math.floor(value);
    counted.set(bucket, (counted.get(bucket) ?? 0) + 1);
  }
  console.log(`\n${label} (${values.length} medidas)`);
  for (const bucket of [...counted.keys()].sort((a, b) => a - b)) {
    const count = counted.get(bucket) as number;
    console.log(
      `  ${String(bucket).padStart(3)}px  ${"#".repeat(Math.min(50, count))} ${count}`,
    );
  }
}

const reader = createTesseractReader({ encode });
const files = readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".png"))
  .sort();

const insideWord: number[] = [];
const betweenWords: number[] = [];
const welded: string[] = [];
let panels = 0;
let tokens = 0;

for (const file of files) {
  const page = normalise(decode(join(FIXTURES, file)));
  const mask = shadedMask(page);
  const left = boxLeft(mask);

  for (const band of boxes(mask)) {
    panels += 1;
    const region = crop(page, left, band.top, page.width, band.bottom);
    const enlarged = resize(
      region,
      region.width * SCALE,
      region.height * SCALE,
    );
    const isTable = band.bottom - band.top > TABLE_HEIGHT;
    const read = await reader.read(
      enlarged,
      isTable ? undefined : { pageSegmentation: BOX_PAGE_SEGMENTATION },
    );
    const words = read.filter((word) => word.text.trim() !== "");
    tokens += words.length;

    for (const word of words) {
      const found = blanks(enlarged, word);
      for (const blank of found) {
        insideWord.push(blank);
      }
      if (found.some((blank) => blank >= FUSED_WORD_GAP)) {
        const pieces = splitFusedWords(enlarged, [word], SCALE);
        welded.push(
          `  ${file}  ${JSON.stringify(word.text)} -> ` +
            `${JSON.stringify(pieces.map((piece) => piece.text).join(" "))}` +
            `  vãos ${found.join(", ")}`,
        );
      }
    }

    const middle = (word: OcrWord) => word.y + word.height / 2;
    const ordered = [...words].sort((a, b) =>
      Math.abs(middle(a) - middle(b)) > SAME_LINE * SCALE
        ? middle(a) - middle(b)
        : a.x - b.x,
    );
    for (let at = 1; at < ordered.length; at += 1) {
      const previous = ordered[at - 1];
      const word = ordered[at];
      if (Math.abs(middle(word) - middle(previous)) > SAME_LINE * SCALE) {
        continue;
      }
      const gap = (word.x - (previous.x + previous.width)) / SCALE;
      if (gap > 0 && gap < COLUMN) {
        betweenWords.push(gap);
      }
    }
  }
  process.stderr.write(`  lida ${file}\n`);
}
await reader.close();

console.log(
  `${FIXTURES}: ${files.length} páginas, ${panels} painéis, ${tokens} tokens`,
);
histogram("dentro de um token", insideWord);
histogram("entre dois tokens que o motor separou", betweenWords);

const widestInside = Math.max(...insideWord.filter((v) => v < FUSED_WORD_GAP));
const narrowestBetween = Math.min(...betweenWords);
console.log(
  `\nFUSED_WORD_GAP ${FUSED_WORD_GAP}: dentro até ${widestInside}px, ` +
    `entre desde ${narrowestBetween}px`,
);
console.log(`\n${welded.length} tokens soldados:`);
for (const line of welded) {
  console.log(line);
}
