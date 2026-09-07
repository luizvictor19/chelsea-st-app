/**
 * Asks whether a panel's second line stands in the same columns as its first.
 *
 * The book pairs a word with its written form inside a shaded panel:
 *
 *   question mark  ?     full stop  .
 *   comma          ,     colon      :
 *   semi-colon     ;
 *
 * That is a grid, and the only grid rule the pipeline has is TABLE_HEIGHT. This
 * one is three lines tall, so it goes down the vocabulary path, gets flattened
 * into a list of terms, and welds words from different lines together: point 36
 * came out holding a term reading "question comma semi-colon mark 5 . ?". It is
 * not flagged, so nothing on the screen says so.
 *
 * The candidate rule is that a grid keeps its columns between lines and a
 * vocabulary panel that merely ran out of width does not. Book 1 is what can
 * refuse it: it carries multi-line vocabulary panels that book 2 does not, so
 * if the two populations overlap anywhere they overlap there.
 *
 * What is measured, per panel of more than one line: every column start on
 * every line after the first, against the nearest column start on the first
 * line. The worst of those distances is the panel's number. A grid's lines
 * begin where the first line begins, so its worst is small; a panel that
 * wrapped begins its second line wherever the terms happen to fall.
 *
 * Columns are cut with TERM_COLUMN_GAP, which is the cut the vocabulary reader
 * these panels currently go through actually uses. Measuring against a
 * different one would describe a path they do not take.
 *
 * Two things the first run of this showed, which the reader should know before
 * trusting a number here. The first line is a poor reference: these panels
 * routinely print a heading as their first line, one centred column, and then
 * every row of a perfectly square grid is measured against it and reports a
 * large distance. And a line whose columns the engine merged, because a gap
 * fell under TERM_COLUMN_GAP, has no start where the line below has one. Both
 * push a grid towards the wrapped-vocabulary end. The per-panel dump below
 * prints every column start so that this is visible rather than buried in the
 * pooled figure.
 *
 * Reports both books, and reports them apart. Book 1 decides, because book 1 is
 * where the hard case lives; book 2 is there so a cut is not chosen against one
 * book alone.
 *
 * Measures and changes nothing. The pages live outside the repository, so this
 * is a local tool and never runs in CI.
 *
 *   node scripts/measure-column-alignment.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import { boxes } from "../src/lib/extraction/boxes.ts";
import {
  BOX_PAGE_SEGMENTATION,
  TABLE_HEIGHT,
  TABLE_LINE_TOLERANCE,
  TABLE_SECOND_PAGE_SEGMENTATION,
  TABLE_STEM_HEIGHT,
  TERM_COLUMN_GAP,
} from "../src/lib/extraction/constants.ts";
import { splitFusedWords } from "../src/lib/extraction/fused-words.ts";
import { mergeReads } from "../src/lib/extraction/second-read.ts";
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

type Panel = {
  readonly book: string;
  readonly file: string;
  readonly top: number;
  readonly height: number;
  /** Already flagged today, by height alone. */
  readonly tall: boolean;
  /** How many printed lines the panel has. */
  readonly lines: number;
  /** Column starts per line, in page pixels. */
  readonly columns: readonly (readonly number[])[];
  /**
   * The worst distance from a column start after the first line to the nearest
   * column start on the first line, in page pixels.
   */
  readonly worst: number;
  readonly text: readonly string[];
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
  const pages = readdirSync(root)
    .filter((name) => name.endsWith(".png"))
    .sort();
  if (pages.length === 0) {
    throw new Error(
      `${root} existe mas não tem nenhum .png. Arquivo ausente, não defeito.`,
    );
  }
  return pages;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[at - 1] + sorted[at]) / 2
    : sorted[at];
}

const middleOf = (word: OcrWord) => word.y + word.height / 2;

/** A token that is nothing but a bare vertical stem, whatever drew it. */
const isStem = (word: OcrWord) => /^\|+$/.test(word.text.trim());

/**
 * The panel without the bracket that groups its subjects and the rule that
 * closes it, the way `table-layout` drops them before grouping anything.
 *
 * Kept, a bracket is one token as tall as the group it holds, so it lifts the
 * median word height that sets the line tolerance, and it puts a column start
 * at the panel's left edge on whichever line it lands on. Both push a grid
 * towards looking like a panel that wrapped, which is the population the
 * candidate rule has to keep.
 */
function withoutFurniture(words: readonly OcrWord[]): readonly OcrWord[] {
  const body = words.filter((word) => !isStem(word));
  if (body.length === 0) {
    return words;
  }
  const height = median(body.map((word) => word.height));
  return words.filter(
    (word) => !isStem(word) || word.height <= height * TABLE_STEM_HEIGHT,
  );
}

/** The words grouped into the lines they are printed on, as table-layout does. */
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

/** Where each column of one line begins, cut the way `termsFrom` cuts terms. */
function columnStarts(line: readonly OcrWord[], scale: number): number[] {
  const ordered = [...line].sort((a, b) => a.x - b.x);
  const starts: number[] = [ordered[0].x / scale];
  let previousEnd = (ordered[0].x + ordered[0].width) / scale;
  for (const word of ordered.slice(1)) {
    const start = word.x / scale;
    if (start - previousEnd >= TERM_COLUMN_GAP) {
      starts.push(start);
    }
    previousEnd = (word.x + word.width) / scale;
  }
  return starts;
}

/**
 * The widest gap in a sorted run, said in words.
 *
 * Says there is none rather than pointing at one: with fewer than two values,
 * or with every value equal, there is no gap, and a report that named one
 * anyway would be inventing the void it exists to look for.
 */
function widestGap(sorted: readonly number[]): string {
  let widest = 0;
  let at = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index] - sorted[index - 1];
    if (gap > widest) {
      widest = gap;
      at = index;
    }
  }
  if (at === 0) {
    return sorted.length < 2
      ? "nada a comparar: menos de dois painéis"
      : "nenhum vazio: todos os painéis dão o mesmo número";
  }
  return `maior vazio: ${widest.toFixed(1)}px, entre ${sorted[at - 1].toFixed(1)} e ${sorted[at].toFixed(1)}`;
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
      const tall = band.bottom - band.top > TABLE_HEIGHT;
      const region = crop(page, left, band.top, page.width, band.bottom);
      const enlarged = resize(
        region,
        region.width * SCALE,
        region.height * SCALE,
      );
      // Read exactly as the pipeline reads it, which for a tall panel is
      // twice: the automatic mode returns no token at all for some two-letter
      // subjects, and those are columns. Read once, a conjugation panel is
      // measured on a reading the pipeline never produces.
      const once = await reader.read(
        enlarged,
        tall ? undefined : { pageSegmentation: BOX_PAGE_SEGMENTATION },
      );
      const seen = tall
        ? mergeReads(
            once,
            await reader.read(enlarged, {
              pageSegmentation: TABLE_SECOND_PAGE_SEGMENTATION,
            }),
          )
        : once;
      const read = withoutFurniture(
        splitFusedWords(enlarged, seen, SCALE).filter(
          (word) => word.text.trim() !== "",
        ),
      );
      if (read.length === 0) {
        continue;
      }

      const lines = groupLines(read);
      if (lines.length < 2) {
        continue;
      }
      const columns = lines.map((line) => columnStarts(line, SCALE));
      const first = columns[0];
      let worst = 0;
      for (const line of columns.slice(1)) {
        for (const start of line) {
          const nearest = Math.min(
            ...first.map((one) => Math.abs(one - start)),
          );
          worst = Math.max(worst, nearest);
        }
      }

      panels.push({
        book,
        file,
        top: band.top,
        height: band.bottom - band.top,
        tall,
        lines: lines.length,
        columns,
        worst,
        text: lines.map((line) =>
          [...line]
            .sort((a, b) => a.x - b.x)
            .map((word) => word.text.trim())
            .join(" "),
        ),
      });
    }
    process.stderr.write(`  ${book} ${file}\n`);
  }
}
await reader.close();

for (const book of ["livro 1", "livro 2"] as const) {
  const of = panels.filter((panel) => panel.book === book);
  const short = of.filter((panel) => !panel.tall);
  console.log(`\n\n########## ${book} ##########`);
  console.log(
    `\n${of.length} painéis de mais de uma linha, ${short.length} deles abaixo de ` +
      `TABLE_HEIGHT e portanto sem marcação nenhuma hoje.\n`,
  );
  console.log(
    "  pior desalinhamento, em pixels da página, do começo de coluna de uma",
  );
  console.log(
    "  linha até o começo de coluna mais próximo da primeira linha:\n",
  );
  console.log(
    "   pior  linhas  colunas por linha  altura  marcado hoje  painel",
  );
  for (const panel of [...of].sort((a, b) => a.worst - b.worst)) {
    console.log(
      `  ${panel.worst.toFixed(1).padStart(5)}  ${String(panel.lines).padStart(6)}  ` +
        `${panel.columns
          .map((line) => line.length)
          .join(",")
          .padEnd(17)}  ${String(panel.height).padStart(6)}  ` +
        `${(panel.tall ? "sim" : "não").padEnd(12)}  ${panel.file}@${panel.top}`,
    );
    for (const [at, line] of panel.text.entries()) {
      console.log(
        `        ${panel.columns[at].map((one) => one.toFixed(0).padStart(4)).join("")}  ` +
          JSON.stringify(line).slice(0, 88),
      );
    }
  }
}

console.log("\n\n########## as duas populações ##########\n");
console.log(
  "  Nada aqui rotula um painel de grade ou de vocabulário: só ordena os piores\n" +
    "  desalinhamentos, para que um vazio apareça ou não apareça.\n",
);
for (const book of ["livro 1", "livro 2"] as const) {
  const of = panels.filter((panel) => panel.book === book);
  const sorted = [...of].map((panel) => panel.worst).sort((a, b) => a - b);
  console.log(`  ${book}: ${sorted.map((one) => one.toFixed(1)).join(" ")}`);
  console.log(`    ${widestGap(sorted)}`);
}
console.log(
  `\n  os dois juntos: ${widestGap(panels.map((panel) => panel.worst).sort((a, b) => a - b))}`,
);
