/**
 * Measures the gap that separates one vocabulary term from the next.
 *
 * TERM_COLUMN_GAP is what stops `a day` becoming two terms and `flower plant`
 * staying one, and the constant cites a measurement that had no tool behind it.
 * This is that tool. It reads the ordinary panels, the ones under TABLE_HEIGHT
 * that the pipeline reads with the fixed segmentation and trusts without
 * review, and prints the two populations the cut has to sit between: the space
 * inside a term, and the column that ends one.
 *
 * A book is named on the command line because the panels of one book are not
 * the panels of another. The pages live outside the repository, so this is a
 * local tool and never runs in CI.
 *
 *   node scripts/measure-term-columns.ts
 *   node scripts/measure-term-columns.ts --fixtures fixtures/real/book1
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import { boxes } from "../src/lib/extraction/boxes.ts";
import {
  BOX_PAGE_SEGMENTATION,
  TABLE_HEIGHT,
  TERM_COLUMN_GAP,
} from "../src/lib/extraction/constants.ts";
import {
  boxLeft,
  crop,
  normalise,
  resize,
  shadedMask,
} from "../src/lib/extraction/image.ts";
import { createTesseractReader } from "../src/lib/extraction/ocr-tesseract.ts";
import type { Bitmap } from "../src/lib/extraction/types.ts";
import { fixturesOption } from "./books.ts";

/** The same enlargement the pipeline reads a panel at. */
const SCALE = 2;
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

const reader = createTesseractReader({ encode });
const gaps: number[] = [];
let panels = 0;

for (const file of readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".png"))
  .sort()) {
  const page = normalise(decode(join(FIXTURES, file)));
  const mask = shadedMask(page);
  const left = boxLeft(mask);
  for (const band of boxes(mask)) {
    if (band.bottom - band.top > TABLE_HEIGHT) {
      continue;
    }
    panels += 1;
    const region = crop(page, left, band.top, page.width, band.bottom);
    const enlarged = resize(
      region,
      region.width * SCALE,
      region.height * SCALE,
    );
    const words = (
      await reader.read(enlarged, {
        pageSegmentation: BOX_PAGE_SEGMENTATION,
      })
    )
      .map((word) => ({
        text: word.text.trim(),
        start: word.x / SCALE,
        end: (word.x + word.width) / SCALE,
      }))
      .filter((word) => word.text !== "")
      .sort((a, b) => a.start - b.start);
    for (let at = 1; at < words.length; at += 1) {
      gaps.push(words[at].start - words[at - 1].end);
    }
  }
}

const within = gaps.filter((gap) => gap < TERM_COLUMN_GAP);
const between = gaps.filter((gap) => gap >= TERM_COLUMN_GAP);
console.log(`\n${FIXTURES}: ${panels} painéis normais, ${gaps.length} vãos`);
console.log(
  `termos: ${within.length} vãos até ${within.length > 0 ? Math.max(...within) : "-"}px dentro de um termo, ` +
    `${between.length} a partir de ${between.length > 0 ? Math.min(...between) : "-"}px entre termos, ` +
    `vazio ${
      within.length > 0 && between.length > 0
        ? (Math.min(...between) - Math.max(...within)).toFixed(1)
        : "-"
    }px, corte em ${TERM_COLUMN_GAP}`,
);

await reader.close();
