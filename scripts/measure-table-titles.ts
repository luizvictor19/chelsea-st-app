/**
 * Asks whether the heading of a conjugation panel is bigger than its rows.
 *
 * `tableContent` emits nothing but rows. The panel's printed heading, "Present
 * simple (positive)", becomes a row of one cell, `serializeTable` writes it as
 * "Present simple (positive) |", and `parseTable` reads it back as a row rather
 * than as the title the format already has a shape for. The teacher then has to
 * demote it by hand on every table.
 *
 * The format's own rule cannot help: it calls a line without a separator a
 * title, and the heading arrives with one because it is written as a row. So
 * the panel has to say which line is the heading before it is serialised, and
 * the candidate signal is the printed body size, since the heading is set
 * larger than the rows under it.
 *
 * This prints every line of every tall panel with the median height of its
 * words, so the two populations can be compared and the void between them, if
 * there is one, can be seen rather than assumed. The first line of a panel is
 * marked, because that is where a heading is printed, but nothing here assumes
 * the first line is one: a panel with no heading has to look like a panel with
 * no heading.
 *
 * Heights are reported as a ratio to the panel's own median word height, not in
 * pixels. The panels are read enlarged and each book sets its own type size, so
 * a pixel cut would describe these fixtures and not the rule.
 *
 * Measures and changes nothing. The pages live outside the repository, so this
 * is a local tool and never runs in CI.
 *
 *   node scripts/measure-table-titles.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import { boxes } from "../src/lib/extraction/boxes.ts";
import {
  TABLE_COLUMN_GAP,
  TABLE_HEIGHT,
  TABLE_LINE_TOLERANCE,
} from "../src/lib/extraction/constants.ts";
import { splitFusedWords } from "../src/lib/extraction/fused-words.ts";
import {
  boxLeft,
  crop,
  normalise,
  resize,
  shadedMask,
} from "../src/lib/extraction/image.ts";
import { createTesseractReader } from "../src/lib/extraction/ocr-tesseract.ts";
import type { Bitmap, OcrWord } from "../src/lib/extraction/types.ts";
import { BOOK_1, BOOK_2 } from "./books.ts";

/** The same enlargement the pipeline reads a panel at. */
const SCALE = 2;

type Line = {
  readonly first: boolean;
  /** Median word height on this line, over the panel's own median. */
  readonly ratio: number;
  /**
   * Tallest word on this line, over the panel's median.
   *
   * Reported beside the median because a heading is not set in one size: the
   * pages print "Present simple" large and "(negative)" small beside it, and a
   * median over the line averages the heading back down to its own rows.
   */
  readonly tallest: number;
  /** How many cells the line would make, which is what a grid row has. */
  readonly cells: number;
  readonly text: string;
};

type Panel = {
  readonly book: string;
  readonly file: string;
  readonly top: number;
  readonly height: number;
  readonly lines: readonly Line[];
};

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

function pagesOf(root: string): readonly string[] {
  if (!existsSync(root)) {
    throw new Error(
      `Não encontrei ${root}. As páginas ficam fora do repositório e o git as ignora, ` +
        `então isto é arquivo ausente e não defeito: ponha as fixtures em ${root}.`,
    );
  }
  return readdirSync(root)
    .filter((name) => name.endsWith(".png"))
    .sort();
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[at - 1] + sorted[at]) / 2
    : sorted[at];
}

const middleOf = (word: OcrWord) => word.y + word.height / 2;

/** How many cells `tableContent` would cut this line into. */
function cellsOf(line: readonly OcrWord[]): number {
  const ordered = [...line].sort((a, b) => a.x - b.x);
  let cells = 1;
  let previousRight = ordered[0].x + ordered[0].width;
  for (const word of ordered.slice(1)) {
    if ((word.x - previousRight) / SCALE >= TABLE_COLUMN_GAP) {
      cells += 1;
    }
    previousRight = word.x + word.width;
  }
  return cells;
}

/** `groupLines` of table-layout, replicated so each group can be named here. */
function groupLines(
  words: readonly OcrWord[],
): readonly (readonly OcrWord[])[] {
  if (words.length === 0) {
    return [];
  }
  const tolerance =
    median(words.map((word) => word.height)) * TABLE_LINE_TOLERANCE;
  const ordered = [...words].sort((a, b) => middleOf(a) - middleOf(b));
  const lines: OcrWord[][] = [];
  let current: OcrWord[] = [ordered[0]];
  for (const word of ordered.slice(1)) {
    const centre = median(current.map(middleOf));
    if (Math.abs(middleOf(word) - centre) > tolerance) {
      lines.push(current);
      current = [word];
    } else {
      current.push(word);
    }
  }
  lines.push(current);
  return lines;
}

const reader = createTesseractReader({ encode });
const panels: Panel[] = [];

for (const [book, root] of [
  ["livro 1", BOOK_1],
  ["livro 2", BOOK_2],
] as const) {
  for (const file of pagesOf(root)) {
    const page = normalise(decode(join(root, file)));
    const mask = shadedMask(page);
    const left = boxLeft(mask);

    for (const band of boxes(mask)) {
      if (band.bottom - band.top <= TABLE_HEIGHT) {
        continue;
      }
      const region = crop(page, left, band.top, page.width, band.bottom);
      const enlarged = resize(
        region,
        region.width * SCALE,
        region.height * SCALE,
      );
      // Tables take the automatic segmentation, as extractPage gives them. The
      // bare rule is left out of the heights: it is as tall as the panel and
      // would drag the line it sits on with it.
      const read = splitFusedWords(
        enlarged,
        await reader.read(enlarged),
        SCALE,
      ).filter(
        (word) => word.text.trim() !== "" && !/^\|+$/.test(word.text.trim()),
      );
      if (read.length === 0) {
        continue;
      }

      const lines = groupLines(read);
      const panelMedian = median(read.map((word) => word.height));
      panels.push({
        book,
        file,
        top: band.top,
        height: band.bottom - band.top,
        lines: lines.map((line, at) => ({
          first: at === 0,
          ratio: median(line.map((word) => word.height)) / panelMedian,
          tallest: Math.max(...line.map((word) => word.height)) / panelMedian,
          cells: cellsOf(line),
          text: [...line]
            .sort((a, b) => a.x - b.x)
            .map((word) => word.text.trim())
            .join(" "),
        })),
      });
    }
    process.stderr.write(`  ${book} ${file}\n`);
  }
}
await reader.close();

console.log(`\n=== ${panels.length} painéis altos, linha a linha ===\n`);
for (const panel of panels) {
  console.log(
    `\n${panel.book}  ${panel.file}  painel@${panel.top} (${panel.height}px)`,
  );
  for (const line of panel.lines) {
    console.log(
      `  ${line.first ? "1ª" : "  "} mediana ${line.ratio.toFixed(2).padStart(5)}x` +
        `  maior ${line.tallest.toFixed(2).padStart(5)}x` +
        `  ${line.cells} célula(s)  ${JSON.stringify(line.text)}`,
    );
  }
}

const firsts = panels.flatMap((panel) =>
  panel.lines.filter((line) => line.first),
);
const rest = panels.flatMap((panel) =>
  panel.lines.filter((line) => !line.first),
);

const span = (name: string, group: readonly Line[]) => {
  if (group.length === 0) {
    console.log(`  ${name}: nenhuma`);
    return;
  }
  const ratios = group.map((line) => line.ratio).sort((a, b) => a - b);
  const tallest = group.map((line) => line.tallest).sort((a, b) => a - b);
  console.log(
    `  ${name}: ${group.length} linhas\n` +
      `    mediana da linha: ${ratios[0].toFixed(2)} a ${ratios[ratios.length - 1].toFixed(2)}\n` +
      `    maior da linha:   ${tallest[0].toFixed(2)} a ${tallest[tallest.length - 1].toFixed(2)}\n` +
      `    com uma célula só: ${group.filter((line) => line.cells === 1).length} de ${group.length}`,
  );
};

console.log("\n\n=== as duas populações ===\n");
console.log(
  "  Razão entre a altura mediana das palavras da linha e a mediana do painel.\n" +
    "  A primeira linha é onde um título é impresso; não é a mesma coisa que ser um.\n",
);
span("primeira linha de cada painel", firsts);
span("demais linhas", rest);

console.log("\n  todas as razões, em ordem:\n");
const all = [
  ...firsts.map((line) => ({ line, where: "1ª" })),
  ...rest.map((line) => ({ line, where: "  " })),
].sort((a, b) => b.line.tallest - a.line.tallest);
for (const one of all) {
  console.log(
    `    mediana ${one.line.ratio.toFixed(2).padStart(5)}x  maior ${one.line.tallest.toFixed(2).padStart(5)}x` +
      `  ${one.line.cells} cél.  ${one.where}  ${JSON.stringify(one.line.text).slice(0, 70)}`,
  );
}
