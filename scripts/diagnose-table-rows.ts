/**
 * Follows a grammar table's rows from the page to the stored grid.
 *
 * A conjugation panel of nine subjects came back with six rows, and the four it
 * lost are not a pattern anyone can read off the result. There are four places
 * a row can go missing between the paper and `blocks.content`, and this walks a
 * panel past all four so the answer is a stage and not a guess:
 *
 *   1. the engine never read the line;
 *   2. `groupLines` folded it into the line above or below, at
 *      TABLE_LINE_TOLERANCE;
 *   3. every token on it was dropped before grouping, which is what `isRule`
 *      does to a lone "|" — and a printed "I" comes back as "|";
 *   4. the line survived to `tableContent` and produced no non-empty cell.
 *
 * The image's own lines are counted from ink, so the first stage has something
 * to be measured against rather than being inferred from the ones after it.
 *
 * Measures and changes nothing. The pages live outside the repository, so this
 * is a local tool and never runs in CI.
 *
 *   node scripts/diagnose-table-rows.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import { boxes } from "../src/lib/extraction/boxes.ts";
import {
  INK_LEVEL,
  MIN_LINE_HEIGHT,
  MIN_ROW_INK,
  TABLE_COLUMN_GAP,
  TABLE_HEIGHT,
  TABLE_LINE_TOLERANCE,
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
import { tableContent } from "../src/lib/extraction/table-layout.ts";
import type { Bitmap, OcrWord } from "../src/lib/extraction/types.ts";
import { BOOK_1, BOOK_2 } from "./books.ts";

/** The same enlargement the pipeline reads a panel at. */
const SCALE = 2;
/** What `table-layout` drops before it groups anything: a token that is only rule. */
const RULE = /^\|+$/;

type Band = { readonly top: number; readonly bottom: number };

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

/**
 * The bands of rows that carry ink, which is what a line of type looks like.
 *
 * The table's own vertical rule has to come out first. It is printed the full
 * height of the panel, so every row crosses it, every row counts as inked, and
 * the whole panel reads as one band: counted with the rules in, a 610px panel
 * of nine lines came back as four. A column inked down more than half the panel
 * is a rule, since no letter is, and it is left out of the row's count.
 */
function inkBands(image: Bitmap): readonly Band[] {
  const isInk = (x: number, y: number) => {
    const pixel = (y * image.width + x) * 4;
    return (
      luma(image.data[pixel], image.data[pixel + 1], image.data[pixel + 2]) <
      INK_LEVEL
    );
  };

  const rule: boolean[] = [];
  for (let x = 0; x < image.width; x += 1) {
    let down = 0;
    for (let y = 0; y < image.height; y += 1) {
      if (isInk(x, y)) {
        down += 1;
      }
    }
    rule.push(down > image.height / 2);
  }

  const inked: boolean[] = [];
  for (let y = 0; y < image.height; y += 1) {
    let count = 0;
    for (let x = 0; x < image.width && count < MIN_ROW_INK; x += 1) {
      if (!rule[x] && isInk(x, y)) {
        count += 1;
      }
    }
    inked.push(count >= MIN_ROW_INK);
  }
  const bands: Band[] = [];
  let start = -1;
  for (let y = 0; y <= inked.length; y += 1) {
    if (y < inked.length && inked[y]) {
      if (start < 0) {
        start = y;
      }
      continue;
    }
    if (start >= 0) {
      // The panel is read enlarged, so the minimum line height is too.
      if (y - start >= MIN_LINE_HEIGHT * SCALE) {
        bands.push({ top: start, bottom: y });
      }
      start = -1;
    }
  }
  return bands;
}

const middleOf = (word: OcrWord) => word.y + word.height / 2;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[at - 1] + sorted[at]) / 2
    : sorted[at];
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
let panels = 0;
let panelsWithOcrPipe = 0;
let panelsWithPipeInsideToken = 0;
let droppedTotal = 0;
const lossByStage = new Map<string, number>();
const note = (stage: string, count = 1) =>
  lossByStage.set(stage, (lossByStage.get(stage) ?? 0) + count);

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
      panels += 1;
      const region = crop(page, left, band.top, page.width, band.bottom);
      const enlarged = resize(
        region,
        region.width * SCALE,
        region.height * SCALE,
      );
      // Tables take the automatic segmentation, as extractPage gives them.
      const read = splitFusedWords(
        enlarged,
        (await reader.read(enlarged)).filter((word) => word.text.trim() !== ""),
        SCALE,
      );

      const lines = inkBands(enlarged);
      const rules = read.filter((word) => RULE.test(word.text.trim()));
      const inside = read.filter(
        (word) => !RULE.test(word.text.trim()) && word.text.includes("|"),
      );
      const kept = read.filter((word) => !RULE.test(word.text.trim()));
      const groups = groupLines(kept);
      const content = tableContent(read, SCALE);
      const rows = content.split("\n").filter((row) => row.trim() !== "");

      if (rules.length > 0) {
        panelsWithOcrPipe += 1;
        droppedTotal += rules.length;
      }
      if (inside.length > 0) {
        panelsWithPipeInsideToken += 1;
      }

      // Which image line each surviving word landed on, and which lines the
      // engine left empty. A line with no word at all is stage 1; two lines
      // sharing one group is stage 2.
      const lineOf = (word: OcrWord) =>
        lines.findIndex(
          (one) => middleOf(word) >= one.top && middleOf(word) <= one.bottom,
        );
      const linesWithAnyWord = new Set(
        read.map(lineOf).filter((at) => at >= 0),
      );
      const unread = lines.length - linesWithAnyWord.size;
      const linesLosingEveryToken = new Set(
        rules.map(lineOf).filter((at) => at >= 0),
      );
      for (const at of linesLosingEveryToken) {
        if (kept.every((word) => lineOf(word) !== at)) {
          note("3. todo token da linha era regra e foi descartado");
        }
      }
      if (unread > 0) {
        note("1. o OCR não leu a linha", unread);
      }
      const merged = linesWithAnyWord.size - groups.length;
      if (merged > 0) {
        note("2. o agrupamento juntou linhas", merged);
      }
      if (groups.length > rows.length) {
        note(
          "4. a linha não produziu célula nenhuma",
          groups.length - rows.length,
        );
      }

      console.log(
        `\n${book}  ${file}  painel@${band.top} (${band.bottom - band.top}px)`,
      );
      console.log(
        `  linhas na imagem ${lines.length}` +
          `   tokens lidos ${read.length}` +
          `   descartados como régua ${rules.length}` +
          `   grupos ${groups.length}` +
          `   linhas na grade ${rows.length}`,
      );
      if (rules.length > 0) {
        console.log(
          `  tokens "|" vindos do OCR, descartados antes de agrupar: ${rules.length}` +
            `   (linhas ${[...linesLosingEveryToken].sort((a, b) => a - b).join(", ")})`,
        );
      }
      if (inside.length > 0) {
        console.log(
          `  "|" dentro de um token maior, virará espaço em cleanCell: ` +
            inside.map((word) => JSON.stringify(word.text)).join(" "),
        );
      }
      for (const [at, group] of groups.entries()) {
        const ordered = [...group].sort((a, b) => a.x - b.x);
        const cells: string[][] = [[ordered[0].text]];
        let previousRight = ordered[0].x + ordered[0].width;
        for (const word of ordered.slice(1)) {
          if ((word.x - previousRight) / SCALE >= TABLE_COLUMN_GAP) {
            cells.push([word.text]);
          } else {
            cells[cells.length - 1].push(word.text);
          }
          previousRight = word.x + word.width;
        }
        console.log(
          `    grupo ${String(at).padStart(2)}: ${cells.map((cell) => cell.join(" ")).join("  |  ")}`,
        );
      }
      console.log(`  grade:`);
      for (const row of rows) {
        console.log(`    ${row}`);
      }
    }
    process.stderr.write(`  ${book} ${file}\n`);
  }
}
await reader.close();

console.log(`\n\n=== resumo, ${panels} painéis de tabela ===\n`);
console.log(
  `  painéis com "|" vindo do OCR (não do nosso serializador): ${panelsWithOcrPipe}` +
    `, ${droppedTotal} tokens descartados ao todo`,
);
console.log(
  `  painéis com "|" colado dentro de um token maior: ${panelsWithPipeInsideToken}`,
);
console.log("\n  onde a linha se perde:");
for (const [stage, count] of [...lossByStage.entries()].sort()) {
  console.log(`    ${stage}: ${count}`);
}
