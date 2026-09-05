/**
 * Measures the geometry of the table panels of the real pages.
 *
 * TABLE_COLUMN_GAP and TABLE_LINE_TOLERANCE are the two numbers that turn a
 * panel back into a grid, and both were chosen from what this prints: the gap
 * between two words on the same line, and how far a word sits from the centre
 * of its line. The pages live outside the repository, so this is a local tool
 * and never runs in CI.
 *
 *   node scripts/measure-table-columns.ts [--limit N]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import { boxes } from "../src/lib/extraction/boxes.ts";
import {
  TABLE_COLUMN_GAP,
  TABLE_HEIGHT,
  TABLE_LINE_TOLERANCE,
} from "../src/lib/extraction/constants.ts";
import {
  boxLeft,
  crop,
  normalise,
  resize,
  shadedMask,
} from "../src/lib/extraction/image.ts";
import { createTesseractReader } from "../src/lib/extraction/ocr-tesseract.ts";
import { tableContent } from "../src/lib/extraction/table-layout.ts";
import type { Bitmap } from "../src/lib/extraction/types.ts";
import { fixturesOption } from "./books.ts";

/** The same enlargement the pipeline reads a panel at. */
const SCALE = 2;
/** Which book's pages to read, and why that is never left implicit: books.ts. */
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

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

const args = process.argv.slice(2);
const limit = args.includes("--limit")
  ? Number(args[args.indexOf("--limit") + 1])
  : Infinity;

const reader = createTesseractReader({ encode });
const files = readdirSync(FIXTURES)
  .filter((file) => file.endsWith(".png"))
  .sort()
  .slice(0, limit);

const gaps: number[] = [];
const offsets: number[] = [];
const pitches: number[] = [];
let panels = 0;
let rules = 0;

for (const file of files) {
  const page = normalise(decode(join(FIXTURES, file)));
  const mask = shadedMask(page);
  const left = boxLeft(mask);
  for (const band of boxes(mask)) {
    if (band.bottom - band.top <= TABLE_HEIGHT) {
      continue;
    }
    panels += 1;
    const region = crop(page, left, band.top, page.width, band.bottom);
    const enlarged = resize(
      region,
      region.width * SCALE,
      region.height * SCALE,
    );
    const read = await reader.read(enlarged);
    const words = read
      .map((word) => ({
        text: word.text.trim(),
        left: word.x / SCALE,
        right: (word.x + word.width) / SCALE,
        middle: (word.y + word.height / 2) / SCALE,
        height: word.height / SCALE,
      }))
      .filter((word) => {
        const isRule = /^\|+$/.test(word.text);
        if (isRule) {
          rules += 1;
        }
        return word.text !== "" && !isRule;
      });
    if (words.length === 0) {
      continue;
    }

    const height = median(words.map((word) => word.height));
    const ordered = [...words].sort((a, b) => a.middle - b.middle);
    const lines: (typeof ordered)[] = [];
    let current = [ordered[0]];
    for (const word of ordered.slice(1)) {
      const centre = median(current.map((one) => one.middle));
      if (Math.abs(word.middle - centre) > height * TABLE_LINE_TOLERANCE) {
        lines.push(current);
        current = [word];
      } else {
        current.push(word);
      }
    }
    lines.push(current);

    const centres: number[] = [];
    for (const line of lines) {
      const centre = median(line.map((word) => word.middle));
      centres.push(centre);
      for (const word of line) {
        offsets.push(Math.abs(word.middle - centre) / height);
      }
      const across = [...line].sort((a, b) => a.left - b.left);
      for (let i = 1; i < across.length; i += 1) {
        gaps.push(across[i].left - across[i - 1].right);
      }
    }
    for (let i = 1; i < centres.length; i += 1) {
      pitches.push((centres[i] - centres[i - 1]) / height);
    }

    console.log(`\n${file}  ${band.top}-${band.bottom}`);
    for (const line of tableContent(read, SCALE).split("\n")) {
      console.log(`   ${line}`);
    }
  }
}

const within = gaps.filter((gap) => gap < TABLE_COLUMN_GAP);
const between = gaps.filter((gap) => gap >= TABLE_COLUMN_GAP);
console.log(`\n${panels} table panels, ${rules} rule tokens dropped`);
console.log(
  `columns: ${within.length} gaps up to ${Math.max(...within)}px inside a cell, ` +
    `${between.length} from ${Math.min(...between)}px between columns, ` +
    `void ${(Math.min(...between) - Math.max(...within)).toFixed(1)}px, cut at ${TABLE_COLUMN_GAP}`,
);
console.log(
  `lines: ${offsets.length} words at most ${Math.max(...offsets).toFixed(2)} of a word height ` +
    `off centre, closest two lines ${Math.min(...pitches).toFixed(2)} apart, cut at ${TABLE_LINE_TOLERANCE}`,
);
