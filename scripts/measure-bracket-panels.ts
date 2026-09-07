/**
 * Finds the panels whose text carries a bracket as a token of its own.
 *
 * The conjugation tables group their pronouns with a printed bracket, and it
 * reaches the stored text as a loose token. What to do about that depends on
 * something measurable first: whether those panels are already flagged for the
 * teacher to review.
 *
 * A panel is flagged by its height alone. `extractPage` calls anything taller
 * than TABLE_HEIGHT a table, reads it with the automatic segmentation and sends
 * it to the review screen as a grid the teacher rebuilds; anything shorter is an
 * ordinary panel of terms, read with the fixed segmentation and trusted. So the
 * question is which side of 250px each bracket-bearing panel falls on, and the
 * answer worth having is the list that falls short of it: those are the panels
 * where a stray bracket is written without anyone being asked to look.
 *
 * Measures and changes nothing. The tokens are counted as the panel readers
 * receive them, which is the engine's output with the welded words parted, since
 * that is what becomes content.
 *
 * The pages live outside the repository, so this is a local tool and never runs
 * in CI.
 *
 *   node scripts/measure-bracket-panels.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import { boxes } from "../src/lib/extraction/boxes.ts";
import {
  BOX_PAGE_SEGMENTATION,
  TABLE_HEIGHT,
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
import type { Bitmap } from "../src/lib/extraction/types.ts";
import { BOOK_1, BOOK_2 } from "./books.ts";

/** The same enlargement the pipeline reads a panel at. */
const SCALE = 2;
/** The shapes the printed bracket and the printed rule come back as. */
const BRACKETS = ["]", "[", "|"];

type BracketPanel = {
  readonly book: string;
  readonly file: string;
  readonly top: number;
  readonly height: number;
  readonly flagged: boolean;
  /** Each bracket found, with the confidence the engine gave it. */
  readonly brackets: readonly { character: string; confidence: number }[];
  /** The panel's tokens in reading order, so the row can be read here. */
  readonly tokens: readonly string[];
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
        `então isto é arquivo ausente e não defeito: ponha as fixtures em ${root} ` +
        `antes de rodar esta medição.`,
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

const reader = createTesseractReader({ encode });
const withBrackets: BracketPanel[] = [];
const panelCount = new Map<string, number>();

for (const [book, root] of [
  ["livro 1", BOOK_1],
  ["livro 2", BOOK_2],
] as const) {
  panelCount.set(book, 0);

  for (const file of pagesOf(root)) {
    const page = normalise(decode(join(root, file)));
    const mask = shadedMask(page);
    const left = boxLeft(mask);

    for (const band of boxes(mask)) {
      panelCount.set(book, (panelCount.get(book) as number) + 1);
      const height = band.bottom - band.top;
      const region = crop(page, left, band.top, page.width, band.bottom);
      const enlarged = resize(
        region,
        region.width * SCALE,
        region.height * SCALE,
      );
      // The same test extractPage makes, and the same reader it picks by it.
      const flagged = height > TABLE_HEIGHT;
      const read = await reader.read(
        enlarged,
        flagged ? undefined : { pageSegmentation: BOX_PAGE_SEGMENTATION },
      );
      const words = splitFusedWords(
        enlarged,
        read.filter((word) => word.text.trim() !== ""),
        SCALE,
      );
      const middle = (word: (typeof words)[number]) => word.y + word.height / 2;
      const ordered = [...words].sort((a, b) =>
        Math.abs(middle(a) - middle(b)) > 20 * SCALE
          ? middle(a) - middle(b)
          : a.x - b.x,
      );

      const brackets = ordered
        .filter((word) => BRACKETS.includes(word.text.trim()))
        .map((word) => ({
          character: word.text.trim(),
          confidence: Math.round(word.confidence),
        }));
      if (brackets.length > 0) {
        withBrackets.push({
          book,
          file,
          top: band.top,
          height,
          flagged,
          brackets,
          tokens: ordered.map((word) => word.text),
        });
      }
    }
    process.stderr.write(`  ${book} ${file}\n`);
  }
}
await reader.close();

function describe(one: BracketPanel): string {
  const found = one.brackets
    .map((each) => `${JSON.stringify(each.character)}@${each.confidence}`)
    .join(" ");
  return (
    `  ${one.book}  ${one.file.padEnd(34)} topo ${String(one.top).padStart(5)}` +
    `  altura ${String(one.height).padStart(4)}px  ` +
    `${one.flagged ? "MARCADO   " : "não marcado"}  ${found}`
  );
}

console.log(
  `${panelCount.get("livro 1")} painéis no livro 1 e ${panelCount.get("livro 2")} no livro 2. ` +
    `TABLE_HEIGHT = ${TABLE_HEIGHT}.`,
);

console.log("\n=== 1. cada painel com colchete ===\n");
for (const one of withBrackets) {
  console.log(describe(one));
}

console.log("\n=== 2. quantos, por livro ===\n");
for (const book of ["livro 1", "livro 2"]) {
  const list = withBrackets.filter((one) => one.book === book);
  const flagged = list.filter((one) => one.flagged).length;
  console.log(
    `  ${book}: ${list.length} painéis com colchete, de ${panelCount.get(book)} ` +
      `(${flagged} marcados, ${list.length - flagged} não marcados)`,
  );
}
console.log(
  `  total: ${withBrackets.length} painéis com colchete, ` +
    `${withBrackets.filter((one) => one.flagged).length} marcados, ` +
    `${withBrackets.filter((one) => !one.flagged).length} não marcados`,
);

console.log(
  `\n=== 3. os que NÃO passam de ${TABLE_HEIGHT}px, e portanto não vão para revisão ===\n`,
);
const unflagged = withBrackets.filter((one) => !one.flagged);
if (unflagged.length === 0) {
  console.log(
    `  LISTA VAZIA. Todo painel que carrega um colchete passa de ${TABLE_HEIGHT}px ` +
      "e já vai marcado para revisão.",
  );
} else {
  for (const one of unflagged) {
    console.log(describe(one));
    console.log(`     ${one.tokens.join(" ")}`);
  }
}
