/**
 * Asks whether one rule could flag every character the book cannot print.
 *
 * The engine returns shapes that are not English: a "|" standing in for an "I",
 * a "*" glued to a word, a table's bracket arriving as a cell of its own. The
 * tempting rule is a set of characters the book is allowed to contain and a
 * flag on every block holding anything else. Whether that rule is worth having
 * depends on one number: how much of the corpus it would flag. A rule that
 * flags nearly everything is not a rule, it is noise with a threshold.
 *
 * So this measures and changes nothing. It runs the whole extraction over both
 * books and reports, over the blocks it produces:
 *
 *   - how many blocks hold at least one character outside the set;
 *   - how many that is per kind of block;
 *   - how many of those already reach the teacher flagged, and how many would
 *     be flagged only by this;
 *   - every character found outside the set, with its count, so the set itself
 *     can be judged rather than trusted.
 *
 * The last one is the point. The set below is a guess written down, and the
 * only way to know whether a character in it is missing is to see what the
 * pages actually contain.
 *
 * The pages live outside the repository, so this is a local tool and never runs
 * in CI.
 *
 *   node scripts/measure-impossible-characters.ts
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

/**
 * The characters a page of this book may contain.
 *
 * Letters, digits and the punctuation the lessons print, plus the whitespace
 * the stored form uses. Deliberately no wider than that: anything else is
 * reported rather than quietly allowed, which is what makes the report able to
 * say the set is wrong.
 */
const LEGITIMATE = new Set([
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  // Apostrophes and quotes in both the typewriter and the typographic shapes:
  // the engine returns "don’t" with U+2019 and the book prints it that way.
  ..."'’\"“”",
  // Comma, full stop, question mark, the dictation's slash, hyphen, brackets.
  ..." ,.?/-()",
  /*
   * And these, each because the pages were read and it is printed there.
   *
   * A first pass allowed only the punctuation above and reported everything
   * else. Seven of the twelve characters it turned up were the book's own:
   *
   *   ";"  19 times, 14 blocks: "we aren't both sitting; you're sitting"
   *   "—"  10 times,  7 blocks: "Before a consonant we say “a” — a book"
   *   "!"   4 times,  2 blocks: the imperative lesson, "take!, put!, open!"
   *   ":"   4 times,  3 blocks: "five vowels in the English alphabet:"
   *   "="   3 times,  3 blocks: the vocabulary entry "no = not any"
   *   "+"   1 time,   1 block:  the arithmetic lesson, "2 + 2 = 4"
   *   "‘"   1 time,   1 block:  an opening single quote
   *
   * They are here rather than in a note because a set that flags the book's own
   * semicolons is not measuring anything: it flagged 36 blocks and 22 of them
   * were correct English.
   */
  ..."\u003b\u003a\u2014\u0021\u2018\u003d\u002b",
  " ",
  "\n",
]);

/**
 * The one character that is ours rather than the engine's.
 *
 * `serializeTable` writes a grammar table as one line per row with "|" between
 * the cells, so inside a table block the pipe is the stored form doing its job.
 * Counting it as impossible would flag every table in both books and drown the
 * question. Outside a table there is no such excuse, and there it is reported.
 */
const TABLE_SEPARATOR = "|";

type Strange = {
  readonly book: string;
  readonly file: string;
  readonly kind: BlockKind;
  readonly needsReview: boolean;
  readonly characters: readonly string[];
  readonly content: string;
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

/** Every character of this block the set does not allow, in order of appearance. */
function strangeIn(content: string, kind: BlockKind): readonly string[] {
  return [...content].filter(
    (character) =>
      !LEGITIMATE.has(character) &&
      !(kind === "grammar_table" && character === TABLE_SEPARATOR),
  );
}

const reader = createTesseractReader({ encode });
const strange: Strange[] = [];
const blocksByKind = new Map<string, number>();
let blocks = 0;

for (const [book, root] of [
  ["livro 1", BOOK_1],
  ["livro 2", BOOK_2],
] as const) {
  for (const [index, file] of pagesOf(root).entries()) {
    const image = normalise(decode(join(root, file)));
    const page = await extractPage(file, index, image, reader);
    for (const block of page.blocks) {
      blocks += 1;
      blocksByKind.set(block.kind, (blocksByKind.get(block.kind) ?? 0) + 1);
      const characters = strangeIn(block.content, block.kind);
      if (characters.length > 0) {
        strange.push({
          book,
          file,
          kind: block.kind,
          needsReview: block.needsReview,
          characters,
          content: block.content,
        });
      }
    }
    process.stderr.write(`  ${book} ${file}\n`);
  }
}
await reader.close();

const share = (part: number, whole: number) =>
  whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;

console.log(
  `${blocks} blocos extraídos dos dois livros. ` +
    `${strange.length} teriam ao menos um caractere fora do conjunto (${share(strange.length, blocks)}).`,
);

console.log("\n=== por tipo de bloco ===\n");
console.log("  tipo                 blocos  fora do conjunto  proporção");
for (const [kind, total] of [...blocksByKind.entries()].sort(
  (a, b) => b[1] - a[1],
)) {
  const hit = strange.filter((one) => one.kind === kind).length;
  console.log(
    `  ${kind.padEnd(20)} ${String(total).padStart(6)}  ${String(hit).padStart(16)}  ${share(hit, total).padStart(9)}`,
  );
}

console.log("\n=== marcação nova, ou já marcado hoje ===\n");
const already = strange.filter((one) => one.needsReview);
const fresh = strange.filter((one) => !one.needsReview);
console.log(
  `  já marcados hoje (needsReview): ${already.length}\n` +
    `  marcação nova:                  ${fresh.length}`,
);
console.log(
  "\n  Um bloco de tabela chega marcado por ser tabela, e é reconstruído pela " +
    "professora de qualquer forma.\n  Os que a regra acrescentaria de verdade são os " +
    `${fresh.length} acima, por tipo:`,
);
for (const kind of new Set(fresh.map((one) => one.kind))) {
  console.log(
    `    ${kind}: ${fresh.filter((one) => one.kind === kind).length}`,
  );
}

console.log("\n=== os caracteres encontrados, com contagem ===\n");
console.log(
  "  Tudo aqui é candidato a artefato. O que a primeira passada mostrou ser\n" +
    "  pontuação do livro já entrou no conjunto e não aparece mais.\n",
);
const counted = new Map<string, number>();
for (const one of strange) {
  for (const character of one.characters) {
    counted.set(character, (counted.get(character) ?? 0) + 1);
  }
}
console.log("  caractere  código    vezes  blocos");
for (const [character, count] of [...counted.entries()].sort(
  (a, b) => b[1] - a[1],
)) {
  const inBlocks = strange.filter((one) =>
    one.characters.includes(character),
  ).length;
  const code = `U+${(character.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")}`;
  console.log(
    `  ${JSON.stringify(character).padEnd(10)} ${code.padEnd(9)} ${String(count).padStart(5)}  ${String(inBlocks).padStart(6)}`,
  );
}

console.log("\n=== cada bloco que a regra pegaria de novo ===\n");
for (const one of fresh) {
  console.log(
    `  ${one.book}  ${one.file.padEnd(34)} ${one.kind.padEnd(15)} ` +
      `${[...new Set(one.characters)].map((each) => JSON.stringify(each)).join(" ")}`,
  );
  console.log(`     ${one.content.replace(/\n/g, " ⏎ ").slice(0, 150)}`);
}
