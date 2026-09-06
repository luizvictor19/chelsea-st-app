/**
 * Writes down which point each block of each page is filed under.
 *
 * The rule that decides it, `pointForBlock`, is content attribution: a block
 * filed under the wrong point is wrong on the screen the student reads, and it
 * is wrong silently. So when that rule changes, "the tests pass" is not enough.
 * This dumps the answer for every block of a book's pages, and two dumps taken
 * across a change list exactly which blocks moved and where to.
 *
 * The placements used are the ones the batch settled by itself. A page still
 * holding a dispute needs the teacher before anything is written, and is dumped
 * with `needsAnswer` rather than with a guess.
 *
 * The pages live outside the repository, so this is a local tool and never runs
 * in CI.
 *
 *   node scripts/dump-block-points.ts --fixtures fixtures/real/book1 \
 *     --first 1 --last 52 --out before-book1.json
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import { normalise } from "../src/lib/extraction/image.ts";
import { createTesseractReader } from "../src/lib/extraction/ocr-tesseract.ts";
import {
  extractPage,
  isRefused,
  pointForBlock,
  resolveBatch,
  type ExtractedPage,
} from "../src/lib/extraction/pipeline.ts";
import type { Bitmap } from "../src/lib/extraction/types.ts";
import { BOOK_2 } from "./books.ts";

const args = process.argv.slice(2);
function option(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
}

const FIXTURES = option("fixtures", BOOK_2);
const RANGE = {
  first: Number(option("first", "53")),
  last: Number(option("last", "128")),
};
const OUT = option("out", "");

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
const files = readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".png"))
  .sort();

const extractions: ExtractedPage[] = [];
for (const [index, file] of files.entries()) {
  const image = normalise(decode(join(FIXTURES, file)));
  extractions.push(await extractPage(file, index, image, reader));
  process.stderr.write(`  lida ${file}\n`);
}
await reader.close();

const dump = resolveBatch(extractions, RANGE).map((page) => ({
  file: page.extraction.id,
  points: page.points,
  placements: page.placements,
  inheritedPoint: page.inheritedPoint,
  precedingPoint: page.precedingPoint,
  openingPoint: page.openingPoint,
  duplicateOf: page.duplicateOf,
  needsAnswer: page.disputes.length > 0,
  skipped:
    page.duplicateOf !== null ||
    page.extraction.unsupported !== null ||
    isRefused(page.extraction),
  blocks: page.extraction.blocks.map((block) => ({
    kind: block.kind,
    top: block.band.top,
    content: block.content.slice(0, 60),
    point: pointForBlock(page.placements, block.band.top, page),
  })),
}));

if (OUT !== "") {
  writeFileSync(OUT, JSON.stringify(dump, null, 1));
}
console.log(
  `${FIXTURES}: ${dump.length} páginas, ` +
    `${dump.reduce((total, page) => total + page.blocks.length, 0)} blocos` +
    (OUT === "" ? "" : `, gravado em ${OUT}`),
);
