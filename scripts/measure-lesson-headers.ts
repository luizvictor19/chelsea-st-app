/**
 * Measures where the "LESSON N" header sits against the point numbers of its
 * own page.
 *
 * The header decides which lesson a page opens, and it is read for the whole
 * image. Whether that is right depends on where it is printed: a header below
 * one of the page's own numbers would mean that number belongs to the lesson
 * before it, and first_point, the key every other point is resolved against,
 * would be one point too low. This is what answers that, and the answer is
 * recorded in docs/spec-ingestao.md. The pages live outside the repository, so
 * this is a local tool and never runs in CI.
 *
 *   node scripts/measure-lesson-headers.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import { boxLeft, normalise, shadedMask } from "../src/lib/extraction/image.ts";
import { marginReadings } from "../src/lib/extraction/margin-numbers.ts";
import { findMarkers } from "../src/lib/extraction/markers.ts";
import { createTesseractReader } from "../src/lib/extraction/ocr-tesseract.ts";
import type { Bitmap } from "../src/lib/extraction/types.ts";
import { fixturesOption } from "./books.ts";

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

/** The numbers the pages actually carry, so OCR noise is not measured. */
const manifest = JSON.parse(
  readFileSync(join(FIXTURES, "manifest.json"), "utf8"),
) as { pages_detail: { file: string; points: number[] }[] };
const pointsOf = new Map(
  manifest.pages_detail.map((page) => [page.file, page.points]),
);

const reader = createTesseractReader({ encode });
let pages = 0;
let below = 0;
let clearance = Infinity;

for (const file of readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".png"))
  .sort()) {
  const page = normalise(decode(join(FIXTURES, file)));
  const left = boxLeft(shadedMask(page));
  const readings = await marginReadings(page, left, reader);
  const words = await reader.read(page);
  const headers = findMarkers(words).filter(
    (marker) => marker.kind === "lesson_header",
  );
  if (headers.length === 0) {
    continue;
  }
  pages += 1;

  const header = headers[0];
  const numbers = [...readings]
    .filter((reading) => (pointsOf.get(file) ?? []).includes(reading.value))
    .sort((a, b) => a.y - b.y);
  for (const number of numbers) {
    if (number.y < header.band.top) {
      below += 1;
    }
  }
  if (numbers.length > 0) {
    clearance = Math.min(clearance, numbers[0].y - header.band.bottom);
  }
  console.log(
    `${file.padEnd(20)} lição ${String(header.number).padEnd(3)} ` +
      `cabeçalho ${String(header.band.top).padStart(4)}  ` +
      `números ${numbers.map((one) => `${one.value}@${one.y}`).join(" ")}`,
  );
}

// The worker holds the process open, so the summary printed and nothing
// exited. Chaining this script after another one simply hung.
await reader.close();

console.log(
  `\n${pages} pages carry a LESSON header. ${below} of their own point numbers ` +
    `are printed above it; the smallest gap between the header and the first ` +
    `number below it is ${clearance}px.`,
);
