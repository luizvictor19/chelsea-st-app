/**
 * Runs the ported extractor over the real pages and compares it to the manifest
 * that shipped with them.
 *
 * The manifest is the target, never the extractor's own previous output:
 * comparing a run to the run before it only proves nothing changed. The pages
 * live outside the repository, so this is a local tool and never runs in CI.
 *
 *   node scripts/calibrate-extraction.ts [--limit N] [--out FILE]
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import {
  CHART_REFERENCE,
  DICTATION_SLASH_RATIO,
  LESSON_HEADER,
  REVISION_EXERCISE_MARKER,
  TABLE_HEIGHT,
} from "../src/lib/extraction/constants.ts";
import { boxes } from "../src/lib/extraction/boxes.ts";
import { explanationLines } from "../src/lib/extraction/explanation-lines.ts";
import { boxLeft, normalise, shadedMask } from "../src/lib/extraction/image.ts";
import { marginReadings } from "../src/lib/extraction/margin-numbers.ts";
import { createTesseractReader } from "../src/lib/extraction/ocr-tesseract.ts";
import type { Bitmap } from "../src/lib/extraction/types.ts";

const FIXTURES = "fixtures/real";

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

function matchAll(text: string, pattern: RegExp): number[] {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags))].map(
    (m) => Number(m[1]),
  );
}

const args = process.argv.slice(2);
const limit = args.includes("--limit")
  ? Number(args[args.indexOf("--limit") + 1])
  : Infinity;
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : "";

const manifest = JSON.parse(
  readFileSync(join(FIXTURES, "manifest.json"), "utf8"),
) as {
  pages_detail: {
    file: string;
    points: number[];
    raw_margin_readings: number[];
    lesson_header: number[];
    revision_exercise: number[];
    chart_ref: number[];
    is_dictation: boolean;
    slash_ratio: number;
    box_count: number;
    needs_review_count: number;
    explanation_line_count: number;
  }[];
};

const expected = new Map(manifest.pages_detail.map((p) => [p.file, p]));
const files = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".png"))
  .sort()
  .slice(0, limit);

const reader = createTesseractReader({ encode });
const results: Record<string, unknown>[] = [];

for (const [index, file] of files.entries()) {
  const started = Date.now();
  const page = normalise(decode(join(FIXTURES, file)));
  const mask = shadedMask(page);
  const left = boxLeft(mask);
  const bands = boxes(mask);

  const raw = await marginReadings(page, left, reader);
  const words = await reader.read(page);
  const tokens = words.map((w) => w.text);
  const text = tokens.join(" ");
  const slashRatio =
    tokens.filter((t) => t.includes("/")).length / Math.max(tokens.length, 1);

  const observed = {
    file,
    raw_margin_readings: [...raw].map((r) => r.value).sort((a, b) => a - b),
    raw_with_y: [...raw].map((r) => [r.value, r.y]),
    raw_with_agreement: [...raw].map((r) => [r.value, r.y, r.agreement]),
    lesson_header: matchAll(text, LESSON_HEADER),
    revision_exercise: matchAll(text, REVISION_EXERCISE_MARKER),
    chart_ref: matchAll(text, CHART_REFERENCE),
    is_dictation: slashRatio >= DICTATION_SLASH_RATIO,
    slash_ratio: Number(slashRatio.toFixed(3)),
    box_count: bands.length,
    needs_review_count: bands.filter((b) => b.bottom - b.top > TABLE_HEIGHT)
      .length,
    explanation_line_count: explanationLines(page).length,
    box_heights: bands.map((b) => b.bottom - b.top),
    box_left: left,
  };
  results.push(observed);

  const want = expected.get(file);
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b) ? "ok" : "DIFF";
  console.log(
    [
      `[${index + 1}/${files.length}]`,
      file.padEnd(18),
      `${((Date.now() - started) / 1000).toFixed(1)}s`,
      want === undefined
        ? "no manifest entry"
        : [
            `boxes ${same(observed.box_count, want.box_count)}`,
            `review ${same(observed.needs_review_count, want.needs_review_count)}`,
            `dict ${same(observed.is_dictation, want.is_dictation)}`,
            `expl ${same(observed.explanation_line_count, want.explanation_line_count)}`,
            `margin ${same(observed.raw_margin_readings, want.raw_margin_readings)}`,
          ].join(" "),
    ].join("  "),
  );
}

await reader.close();

if (outPath !== "") {
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${outPath}`);
}
