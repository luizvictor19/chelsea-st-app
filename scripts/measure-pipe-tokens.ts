/**
 * Asks what the engine means when it returns a "|", and whether geometry says.
 *
 * The character arrives from two different things on the page and the two want
 * opposite treatment:
 *
 *   - a printed "I", the pronoun, which this face draws as a bare stem. It is
 *     a letter and has to survive into the block.
 *   - the panel's own furniture: the rule that closes a shaded box on the
 *     right, and the tall bracket that groups the subjects of a conjugation
 *     table. Neither is text, and "|" is also the column separator of our own
 *     stored form, so one left in a cell comes back as a boundary of ours in
 *     the middle of a row.
 *
 * `table-layout` today drops every token matching /^\|+$/ before it groups
 * anything, which mends the second and deletes the first without a trace.
 *
 * Two candidate discriminators are measured here, side by side, so the choice
 * is made against the populations rather than against an intuition:
 *
 *   1. context. Is there another word to the right of it on the same line? A
 *      pronoun opens a clause and something follows it; the rule closes the
 *      panel and nothing does.
 *   2. height. The rule is printed down the whole group of lines it brackets;
 *      an "I" is one line of type tall.
 *
 * The report prints both populations with their extremes, so the void between
 * them can be seen, or seen not to exist.
 *
 * All three places a "|" can reach a block, read exactly as `extractPage` reads
 * them: the ordinary panels under TABLE_HEIGHT with the fixed segmentation, the
 * tall ones with the automatic mode, welded words parted in both, and the
 * full-page read that the explanations and the dictation come off. The prose is
 * not an afterthought here, it is where most of them are.
 *
 * Measures and changes nothing. The pages live outside the repository, so this
 * is a local tool and never runs in CI.
 *
 *   node scripts/measure-pipe-tokens.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import { boxes } from "../src/lib/extraction/boxes.ts";
import {
  BOX_PAGE_SEGMENTATION,
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
/** A token that is nothing but the shape in question. */
const BARE_PIPE = /^\|+$/;

/**
 * Where on the page the token was read.
 *
 * Three populations and not one, because the pipeline reads them with three
 * different settings and only the panels get the welded words parted. Most of
 * the "|" that reach a block come from the prose, which the panel-only pass
 * missed entirely: `scripts/measure-impossible-characters.ts` counts 18 of them
 * in 14 blocks, and only 3 of those blocks are panels.
 */
type Where = "painel comum" | "painel alto" | "prosa";

type Sighting = {
  readonly book: string;
  readonly file: string;
  readonly panelTop: number;
  readonly where: Where;
  readonly text: string;
  /** Height of the token itself, in page pixels. */
  readonly height: number;
  /** Median height of the other tokens sharing its line, in page pixels. */
  readonly lineHeight: number;
  /**
   * Median height of every other token in the whole region, in page pixels.
   *
   * Steadier than the line's own median, which is what the question needs: the
   * line a bracket sits on is short and often holds the bracket's twin, so the
   * line median is pulled up by the very population being separated.
   */
  readonly bodyHeight: number;
  /** Height of the whole panel, in page pixels. */
  readonly panelHeight: number;
  /** Text of the nearest token to its right on the same line, if any. */
  readonly after: string | null;
  /** The line it sits on, as text, so the case can be read without the image. */
  readonly line: string;
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

/**
 * The words grouped into printed lines, the way `table-layout` groups them.
 *
 * Replicated rather than imported because the grouping there is private and
 * this has to name each group to report it. The tolerance is the same constant,
 * so the lines reported here are the lines the pipeline sees.
 */
function groupLines(
  words: readonly OcrWord[],
): readonly (readonly OcrWord[])[] {
  if (words.length === 0) {
    return [];
  }
  // A fraction of the region's own median word height, so the same tolerance
  // serves a panel read at twice size and a page read at its own.
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
const bare: Sighting[] = [];
const fused: Sighting[] = [];
let panels = 0;

for (const [book, root] of [
  ["livro 1", BOOK_1],
  ["livro 2", BOOK_2],
] as const) {
  for (const file of pagesOf(root)) {
    const page = normalise(decode(join(root, file)));
    const mask = shadedMask(page);
    const left = boxLeft(mask);

    /** Every "|" of one already-read region, with the line it sits on. */
    const harvest = (
      read: readonly OcrWord[],
      where: Where,
      panelTop: number,
      panelHeight: number,
      scale: number,
    ) => {
      const body = read.filter((word) => !word.text.includes("|"));
      const bodyHeight =
        body.length > 0
          ? median(body.map((word) => word.height)) / scale
          : Number.NaN;
      for (const line of groupLines(read)) {
        const ordered = [...line].sort((a, b) => a.x - b.x);
        const others = ordered.filter((word) => !word.text.includes("|"));
        const lineHeight =
          others.length > 0
            ? median(others.map((word) => word.height)) / scale
            : Number.NaN;
        for (const [at, word] of ordered.entries()) {
          const text = word.text.trim();
          if (!text.includes("|")) {
            continue;
          }
          const next = ordered[at + 1];
          const sighting: Sighting = {
            book,
            file,
            panelTop,
            where,
            text,
            height: word.height / scale,
            lineHeight,
            bodyHeight,
            panelHeight,
            after: next === undefined ? null : next.text.trim(),
            line: ordered.map((one) => one.text.trim()).join(" "),
          };
          (BARE_PIPE.test(text) ? bare : fused).push(sighting);
        }
      }
    };

    for (const band of boxes(mask)) {
      panels += 1;
      const tall = band.bottom - band.top > TABLE_HEIGHT;
      const region = crop(page, left, band.top, page.width, band.bottom);
      const enlarged = resize(
        region,
        region.width * SCALE,
        region.height * SCALE,
      );
      const read = splitFusedWords(
        enlarged,
        await reader.read(
          enlarged,
          tall ? undefined : { pageSegmentation: BOX_PAGE_SEGMENTATION },
        ),
        SCALE,
      ).filter((word) => word.text.trim() !== "");

      harvest(
        read,
        tall ? "painel alto" : "painel comum",
        band.top,
        band.bottom - band.top,
        SCALE,
      );
    }

    /*
     * And the full-page read, which is where the explanations and the dictation
     * come from. Read once, at page scale, with no segmentation of ours and no
     * word parting, exactly as `extractPage` reads it: the prose "|" have to be
     * judged as the pipeline actually sees them, not as a panel would show them.
     */
    const whole = (await reader.read(page)).filter(
      (word) => word.text.trim() !== "",
    );
    harvest(whole, "prosa", 0, page.height, 1);
    process.stderr.write(`  ${book} ${file}\n`);
  }
}
await reader.close();

const withWordAfter = bare.filter((one) => one.after !== null);
const endingTheLine = bare.filter((one) => one.after === null);
const byWhere = (where: Where) => bare.filter((one) => one.where === where);

console.log(
  "\n  onde cada token foi lido:\n" +
    (["painel comum", "painel alto", "prosa"] as const)
      .map((where) => `    ${where.padEnd(14)} ${byWhere(where).length}`)
      .join("\n"),
);
console.log(
  `\n${panels} painéis lidos nos dois livros. ` +
    `${bare.length} tokens que são só "|", em ${new Set(bare.map((one) => `${one.file}@${one.panelTop}`)).size} painéis. ` +
    `${fused.length} com "|" colado dentro de um token maior.`,
);

console.log("\n=== 1. contexto: tem palavra depois na mesma linha? ===\n");
console.log(`  com palavra depois: ${withWordAfter.length}`);
for (const one of withWordAfter) {
  console.log(
    `    ${one.book}  ${one.file.padEnd(34)} ${one.where.padEnd(13)} @${String(one.panelTop).padStart(4)} ` +
      `depois=${JSON.stringify(one.after)}`,
  );
  console.log(`       linha: ${JSON.stringify(one.line)}`);
}
console.log(`\n  no fim da linha, sem nada depois: ${endingTheLine.length}`);
for (const one of endingTheLine) {
  console.log(
    `    ${one.book}  ${one.file.padEnd(34)} ${one.where.padEnd(13)} @${String(one.panelTop).padStart(4)}`,
  );
  console.log(`       linha: ${JSON.stringify(one.line)}`);
}

console.log(
  "\n=== 2. geometria: altura do token contra a linha e o painel ===\n",
);
console.log(
  "  Uma régua impressa desce o painel inteiro; um I tem a altura de uma linha de texto.\n" +
    "  As duas populações abaixo são as mesmas do teste de contexto, separadas por ele,\n" +
    "  para que dê para ver se a altura separa igual.\n",
);
const describe = (name: string, group: readonly Sighting[]) => {
  if (group.length === 0) {
    console.log(`  ${name}: nenhum`);
    return;
  }
  const ratios = group
    .filter((one) => Number.isFinite(one.lineHeight))
    .map((one) => one.height / one.lineHeight);
  const heights = group.map((one) => one.height);
  console.log(
    `  ${name}: ${group.length} tokens\n` +
      `    altura em px:            ${Math.min(...heights).toFixed(1)} a ${Math.max(...heights).toFixed(1)}\n` +
      (ratios.length === 0
        ? "    razão altura/linha:      sem outra palavra na linha para comparar\n"
        : `    razão altura/linha:      ${Math.min(...ratios).toFixed(2)} a ${Math.max(...ratios).toFixed(2)}\n`) +
      (() => {
        const body = group
          .filter((one) => Number.isFinite(one.bodyHeight))
          .map((one) => one.height / one.bodyHeight);
        return body.length === 0
          ? "    razão altura/corpo:      sem corpo de texto para comparar\n"
          : `    razão altura/corpo:      ${Math.min(...body).toFixed(2)} a ${Math.max(...body).toFixed(2)}\n`;
      })() +
      `    onde:                    ${[...new Set(group.map((one) => one.where))].join(", ")}`,
  );
};
describe("com palavra depois (candidatos a I)", withWordAfter);
describe("no fim da linha (candidatos a régua)", endingTheLine);

console.log("\n  cada token, por altura crescente:\n");
console.log(
  "  altura  linha  /lin.  /corpo  onde           depois  livro    arquivo                            linha lida",
);
for (const one of [...bare].sort((a, b) => a.height - b.height)) {
  const ratio = Number.isFinite(one.lineHeight)
    ? (one.height / one.lineHeight).toFixed(2)
    : "  -  ";
  const body = Number.isFinite(one.bodyHeight)
    ? (one.height / one.bodyHeight).toFixed(2)
    : "  -  ";
  console.log(
    `  ${one.height.toFixed(1).padStart(6)}  ${(Number.isFinite(one.lineHeight) ? one.lineHeight.toFixed(1) : "-").padStart(5)}  ` +
      `${ratio.padStart(5)}  ${body.padStart(5)}  ${one.where.padEnd(13)}  ` +
      `${(one.after === null ? "não" : "sim").padEnd(6)}  ${one.book.padEnd(7)}  ${one.file.padEnd(34)} ${JSON.stringify(one.line).slice(0, 70)}`,
  );
}

console.log('\n=== 3. "|" colado dentro de um token maior ===\n');
for (const one of fused) {
  console.log(
    `  ${one.book}  ${one.file.padEnd(34)} painel@${String(one.panelTop).padStart(4)} ` +
      `token=${JSON.stringify(one.text)} depois=${JSON.stringify(one.after)}`,
  );
  console.log(`     linha: ${JSON.stringify(one.line)}`);
}
