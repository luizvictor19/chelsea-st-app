/**
 * Asks what a pair of slashes inside a vocabulary term turns out to be.
 *
 * On point 38 of book 1 the book prints
 *
 *   a    an    the /ðə/    the /ðiː/
 *
 * and the panel comes back as the terms "a", "an", "the /0a/", "the /0i/". The
 * slashes hold a pronunciation, in IPA, which this engine does not read: the
 * transcription is rubbish however it is read, and it is rubbish welded onto a
 * term that would otherwise be right. Both of those terms are "the".
 *
 * Before a rule strips them, the thing worth knowing is whether every slashed
 * run in a term is a transcription. If one of them is something else, a rule
 * that removes the run removes content, and it has to change shape first.
 *
 * So this reports every term of every vocabulary panel of both books that holds
 * a "/.../" run, with the whole term and the page it came from, and counts
 * them. It judges nothing: the list is short enough to read.
 *
 * Vocabulary panels only, which is the whole point of measuring here rather
 * than over blocks. On a dictation page the slash is the reading pause and is
 * content, and a rule about slashes that wandered into a dictation would delete
 * the thing the page is for. The dictations are counted separately below, so
 * the size of what is being kept away from is visible rather than assumed.
 *
 * Measures and changes nothing. The pages live outside the repository, so this
 * is a local tool and never runs in CI.
 *
 *   node scripts/measure-slashed-terms.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import { normalise } from "../src/lib/extraction/image.ts";
import { createTesseractReader } from "../src/lib/extraction/ocr-tesseract.ts";
import { extractPage } from "../src/lib/extraction/pipeline.ts";
import { splitTerms } from "../src/lib/extraction/terms.ts";
import type { Bitmap } from "../src/lib/extraction/types.ts";
import { BOOK_1, BOOK_2 } from "./books.ts";

/**
 * A run between two slashes.
 *
 * Deliberately loose: anything at all between them, so that a transcription the
 * engine mangled beyond recognition is still counted. A tighter pattern would
 * only find the runs that came out well, which is the opposite of the question.
 */
const SLASHED = /\/[^/]*\//;

type Sighting = {
  readonly book: string;
  readonly file: string;
  readonly term: string;
  /** The other terms of the same panel, so the pairing can be seen. */
  readonly panel: readonly string[];
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

const reader = createTesseractReader({ encode });
const slashed: Sighting[] = [];
let terms = 0;
let panels = 0;
let dictations = 0;
let dictationSlashes = 0;

for (const [book, root] of [
  ["livro 1", BOOK_1],
  ["livro 2", BOOK_2],
] as const) {
  for (const [index, file] of pagesOf(root).entries()) {
    const image = normalise(decode(join(root, file)));
    const page = await extractPage(file, index, image, reader);
    for (const block of page.blocks) {
      if (block.kind === "dictation") {
        dictations += 1;
        dictationSlashes += (block.content.match(/\//g) ?? []).length;
        continue;
      }
      if (block.kind !== "vocabulary") {
        continue;
      }
      panels += 1;
      const inPanel = splitTerms(block.content);
      for (const term of inPanel) {
        terms += 1;
        if (SLASHED.test(term)) {
          slashed.push({ book, file, term, panel: inPanel });
        }
      }
    }
    process.stderr.write(`  ${book} ${file}\n`);
  }
}
await reader.close();

console.log(
  `\n${panels} painéis de vocabulário nos dois livros, ${terms} termos. ` +
    `${slashed.length} deles contêm um trecho entre barras.\n`,
);

console.log("=== cada um, com o painel inteiro em volta ===\n");
for (const one of slashed) {
  console.log(`  ${one.book}  ${one.file}`);
  console.log(`     termo:  ${JSON.stringify(one.term)}`);
  console.log(
    `     painel: ${one.panel.map((term) => JSON.stringify(term)).join(", ")}`,
  );
}
if (slashed.length === 0) {
  console.log("  nenhum");
}

console.log("\n=== o que a regra não pode encostar ===\n");
console.log(
  `  ${dictations} blocos de ditado, com ${dictationSlashes} barras entre eles.\n` +
    "  Lá a barra é a pausa de leitura e é conteúdo. Este é o tamanho do que\n" +
    "  fica de fora, e é por isso que a medição é sobre termos e não sobre blocos.",
);
