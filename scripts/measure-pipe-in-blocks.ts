/**
 * Counts the "|" that actually reach a block, and asks what follows each one.
 *
 * `scripts/measure-pipe-tokens.ts` counts every "|" the engine returns anywhere
 * on the page, which is 271 of them. That is the wrong population for a rule
 * about stored content: most of those tokens sit on question-and-answer lines
 * that never become a block, and a rule can only be judged against the text it
 * would actually rewrite.
 *
 * So this runs the whole pipeline and looks only at `blocks.content`, which is
 * what gets written. For every "|" in it, it reports whether a word follows on
 * the same printed line, which is the discriminator being weighed:
 *
 *   - a printed "I" opens a clause, so something follows it;
 *   - the vertical rule closing a shaded panel is the last thing on its line.
 *
 * "Same line" is read off the content rather than off the engine's boxes,
 * because by the time a block exists the boxes are gone and the content is all
 * there is. A vocabulary panel writes its terms separated by ", " and a
 * paragraph writes its lines joined by " ", so what follows a "|" in the string
 * is what followed it on the page.
 *
 * The stored form's own separator is not counted: inside a grammar_table block
 * the "|" is `serializeTable` doing its job, not the engine's.
 *
 * Measures and changes nothing. The pages live outside the repository, so this
 * is a local tool and never runs in CI.
 *
 *   node scripts/measure-pipe-in-blocks.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import type { BlockKind } from "../src/lib/extraction/classify.ts";
import { normalise } from "../src/lib/extraction/image.ts";
import { createTesseractReader } from "../src/lib/extraction/ocr-tesseract.ts";
import { extractPage } from "../src/lib/extraction/pipeline.ts";
import type { Bitmap } from "../src/lib/extraction/types.ts";
import { BOOK_1, BOOK_2 } from "./books.ts";

const PIPE = "|";
/** What counts as a word following: a letter or a digit, in any script. */
const WORD = /[\p{L}\p{N}]/u;
/**
 * What may sit between a "|" and the word after it without being that word.
 *
 * The term separator a vocabulary panel is written with, ordinary space, and
 * the newline a table row ends on. Anything else, punctuation included, means
 * the "|" was not the last thing on its line.
 */
const BETWEEN = /^[\s,]*$/;

type Sighting = {
  readonly book: string;
  readonly file: string;
  readonly kind: BlockKind;
  readonly needsReview: boolean;
  /** The word that follows on the same line, or null when nothing does. */
  readonly after: string | null;
  /** The content around it, so the case can be judged without the image. */
  readonly around: string;
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

/** The word after this "|" on the same line, or null when the line ends there. */
function wordAfter(content: string, at: number): string | null {
  const rest = content.slice(at + 1);
  const lineEnd = rest.indexOf("\n");
  const line = lineEnd < 0 ? rest : rest.slice(0, lineEnd);
  const word = line.match(/[\p{L}\p{N}][^\s,]*/u);
  if (word === null || !WORD.test(word[0])) {
    return null;
  }
  // Only when nothing but separators stands between, so a "|" that ends its
  // line is not credited with the first word of the line after it.
  return BETWEEN.test(line.slice(0, word.index)) ? word[0] : null;
}

const reader = createTesseractReader({ encode });
const sightings: Sighting[] = [];
const blocksWithPipe = new Set<string>();
let blocks = 0;

for (const [book, root] of [
  ["livro 1", BOOK_1],
  ["livro 2", BOOK_2],
] as const) {
  for (const [index, file] of pagesOf(root).entries()) {
    const image = normalise(decode(join(root, file)));
    const page = await extractPage(file, index, image, reader);
    for (const [at, block] of page.blocks.entries()) {
      blocks += 1;
      if (block.kind === "grammar_table") {
        continue;
      }
      for (let cut = 0; cut < block.content.length; cut += 1) {
        if (block.content[cut] !== PIPE) {
          continue;
        }
        blocksWithPipe.add(`${book}/${file}#${at}`);
        sightings.push({
          book,
          file,
          kind: block.kind,
          needsReview: block.needsReview,
          after: wordAfter(block.content, cut),
          around: block.content
            .slice(Math.max(0, cut - 45), cut + 45)
            .replace(/\n/g, " ⏎ "),
        });
      }
    }
    process.stderr.write(`  ${book} ${file}\n`);
  }
}
await reader.close();

const followed = sightings.filter((one) => one.after !== null);
const ending = sightings.filter((one) => one.after === null);

console.log(
  `\n${blocks} blocos nos dois livros. ` +
    `${sightings.length} ocorrências de "|" fora das tabelas, em ${blocksWithPipe.size} blocos.\n`,
);

console.log("=== por tipo de bloco ===\n");
for (const kind of new Set(sightings.map((one) => one.kind))) {
  const of = sightings.filter((one) => one.kind === kind);
  console.log(
    `  ${kind.padEnd(14)} ${String(of.length).padStart(3)} ocorrências, ` +
      `${of.filter((one) => one.after !== null).length} com palavra depois`,
  );
}

console.log(`\n=== com palavra depois: ${followed.length} ===\n`);
for (const one of followed) {
  console.log(
    `  ${one.book}  ${one.file.padEnd(34)} ${one.kind.padEnd(12)} depois=${JSON.stringify(one.after)}`,
  );
  console.log(`     ...${one.around}...`);
}

console.log(`\n=== sem nada depois na mesma linha: ${ending.length} ===\n`);
for (const one of ending) {
  console.log(`  ${one.book}  ${one.file.padEnd(34)} ${one.kind.padEnd(12)}`);
  console.log(`     ...${one.around}...`);
}
