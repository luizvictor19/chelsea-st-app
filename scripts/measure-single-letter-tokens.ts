/**
 * Counts every token of one character the panel reader returns, with context.
 *
 * The engine confuses shapes that are a single vertical stroke, and the
 * teacher's notes record three of them by page: an `I` read as `]` on p056 and
 * p059 of book 2, and an `a` in place of an `I` on p060. A correction for that
 * has to know how many there are, which characters they are, and above all
 * whether any `l` in either book is a real `l` rather than a printed `I`. If
 * none is, a narrow rule is defensible; if one is, the rule has to change shape
 * before it is written.
 *
 * So this measures and changes nothing. It reads the panels the way the
 * pipeline reads them, the ordinary ones under TABLE_HEIGHT with the fixed
 * segmentation and the tall ones with the automatic mode, and reports:
 *
 *   1. every one-character token, grouped by character, per book and in total;
 *   2. each occurrence with its page, confidence and two neighbours a side, so
 *      the context can be read without opening the image;
 *   3. the same restricted to the shapes that collide in this face: l I a ] | 1;
 *   4. what the three recorded pages produce today.
 *
 * Both books in one run, because the question is about both and the answer is a
 * comparison. The pages live outside the repository, so this is a local tool
 * and never runs in CI.
 *
 *   node scripts/measure-single-letter-tokens.ts
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
import type { Bitmap, OcrWord } from "../src/lib/extraction/types.ts";
import { BOOK_1, BOOK_2 } from "./books.ts";

/** The same enlargement the pipeline reads a panel at. */
const SCALE = 2;
/** Two tokens whose middles are further apart than this are on separate lines. */
const SAME_LINE = 20;
/**
 * The shapes that collide in this face, which is the cut the question is about.
 *
 * Not a rule and not a correction: a list of what to look at, printed apart
 * from the full inventory so the full inventory still says whether the list is
 * the right one.
 */
const CONFUSABLE = ["l", "I", "a", "]", "|", "1"];
/** What the teacher's notes record, to be confirmed, refuted or not found. */
const RECORDED = [
  { page: "p056", claim: "I lido como ]", expect: "]" },
  { page: "p059", claim: "I lido como ]", expect: "]" },
  { page: "p060", claim: "a no lugar do I", expect: "a" },
];

/** A panel of a recorded page, kept whole so the row can be read. */
type RecordedPanel = {
  readonly file: string;
  readonly panel: string;
  readonly tokens: readonly string[];
};

type Occurrence = {
  readonly book: string;
  readonly file: string;
  readonly character: string;
  readonly confidence: number;
  readonly panel: string;
  readonly before: readonly string[];
  readonly after: readonly string[];
  /** True when only the fused-word splitting produced this token. */
  readonly fromSplit: boolean;
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

/** Reading order inside a panel: down the lines, then along each one. */
function inReadingOrder(words: readonly OcrWord[]): readonly OcrWord[] {
  const middle = (word: OcrWord) => word.y + word.height / 2;
  return [...words].sort((a, b) =>
    Math.abs(middle(a) - middle(b)) > SAME_LINE * SCALE
      ? middle(a) - middle(b)
      : a.x - b.x,
  );
}

function neighbours(
  ordered: readonly OcrWord[],
  at: number,
): { before: string[]; after: string[] } {
  return {
    before: [ordered[at - 2], ordered[at - 1]]
      .filter((word) => word !== undefined)
      .map((word) => word.text),
    after: [ordered[at + 1], ordered[at + 2]]
      .filter((word) => word !== undefined)
      .map((word) => word.text),
  };
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
const found: Occurrence[] = [];
const recordedPanels: RecordedPanel[] = [];
const readPages = new Map<string, number>();
const readTokens = new Map<string, number>();

for (const [book, root] of [
  ["livro 1", BOOK_1],
  ["livro 2", BOOK_2],
] as const) {
  const pages = pagesOf(root);
  readPages.set(book, pages.length);
  readTokens.set(book, 0);

  for (const file of pages) {
    const page = normalise(decode(join(root, file)));
    const mask = shadedMask(page);
    const left = boxLeft(mask);

    for (const band of boxes(mask)) {
      const region = crop(page, left, band.top, page.width, band.bottom);
      const enlarged = resize(
        region,
        region.width * SCALE,
        region.height * SCALE,
      );
      const isTable = band.bottom - band.top > TABLE_HEIGHT;
      const panel = `${isTable ? "tabela" : "termos"}@${band.top}`;
      const read = await reader.read(
        enlarged,
        isTable ? undefined : { pageSegmentation: BOX_PAGE_SEGMENTATION },
      );
      const words = read.filter((word) => word.text.trim() !== "");
      readTokens.set(book, (readTokens.get(book) as number) + words.length);

      // What the engine returned, and what the panel readers are actually
      // handed, which is the same list with the welded words parted. A token of
      // one character can be born there — "lam" becomes "l am" — and that is
      // the sort this question is about, so both are counted and the second is
      // marked.
      const asRead = inReadingOrder(words);
      const asFiled = inReadingOrder(splitFusedWords(enlarged, words, SCALE));
      const readTexts = new Set(asRead.map((word) => word.text));

      if (
        book === "livro 2" &&
        RECORDED.some((record) => file.startsWith(record.page))
      ) {
        recordedPanels.push({
          file,
          panel,
          tokens: asFiled.map((word) => word.text),
        });
      }

      for (const [at, word] of asFiled.entries()) {
        const character = word.text.trim();
        if ([...character].length !== 1) {
          continue;
        }
        found.push({
          book,
          file,
          character,
          confidence: Math.round(word.confidence),
          panel,
          fromSplit: !readTexts.has(character),
          ...neighbours(asFiled, at),
        });
      }
    }
    process.stderr.write(`  ${book} ${file}\n`);
  }
}
await reader.close();

function context(one: Occurrence): string {
  const before = one.before.length === 0 ? "—" : one.before.join(" ");
  const after = one.after.length === 0 ? "—" : one.after.join(" ");
  return `${before}  «${one.character}»  ${after}`;
}

function line(one: Occurrence): string {
  return (
    `  ${one.book}  ${one.file.padEnd(34)} conf=${String(one.confidence).padStart(3)}` +
    `${one.fromSplit ? "  [da partição]" : "              "}  ${one.panel.padEnd(14)} ${context(one)}`
  );
}

console.log(
  `${readPages.get("livro 1")} páginas do livro 1 e ${readPages.get("livro 2")} do livro 2, ` +
    `${(readTokens.get("livro 1") as number) + (readTokens.get("livro 2") as number)} tokens lidos.`,
);

console.log("\n=== 1. tokens de um caractere, por caractere ===\n");
const byCharacter = new Map<string, Occurrence[]>();
for (const one of found) {
  byCharacter.set(one.character, [
    ...(byCharacter.get(one.character) ?? []),
    one,
  ]);
}
const ordered = [...byCharacter.entries()].sort(
  (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
);
console.log("  caractere  total  livro 1  livro 2");
for (const [character, list] of ordered) {
  const one = list.filter((each) => each.book === "livro 1").length;
  const two = list.length - one;
  console.log(
    `  ${JSON.stringify(character).padEnd(10)} ${String(list.length).padStart(5)}` +
      `  ${String(one).padStart(7)}  ${String(two).padStart(7)}`,
  );
}
console.log(
  `  ${"total".padEnd(10)} ${String(found.length).padStart(5)}` +
    `  ${String(found.filter((one) => one.book === "livro 1").length).padStart(7)}` +
    `  ${String(found.filter((one) => one.book === "livro 2").length).padStart(7)}`,
);

console.log("\n=== 2. cada ocorrência, com os vizinhos ===\n");
for (const [character, list] of ordered) {
  console.log(` ${JSON.stringify(character)} (${list.length})`);
  for (const one of list) {
    console.log(line(one));
  }
}

console.log("\n=== 3. as formas que se confundem nesta fonte ===\n");
const confusable = found.filter((one) => CONFUSABLE.includes(one.character));
if (confusable.length === 0) {
  console.log("  nenhuma ocorrência.");
}
for (const character of CONFUSABLE) {
  const list = confusable.filter((one) => one.character === character);
  console.log(` ${JSON.stringify(character)} (${list.length})`);
  for (const one of list) {
    console.log(line(one));
  }
}

console.log("\n=== 4. as três trocas registradas ===\n");
/*
 * The whole panel, not just the character.
 *
 * Whether the page yields a "]" is the easy half and it does not settle the
 * claim: this face prints a vertical rule between the table's columns, and a
 * rule read as "]" looks exactly like an "I" read as "]" if all that is asked
 * is whether a "]" came back. Only the row around it tells them apart, so the
 * row is printed and the verdict says which of the two it supports.
 */
for (const record of RECORDED) {
  const onPage = found.filter(
    (one) => one.book === "livro 2" && one.file.startsWith(record.page),
  );
  const hit = onPage.filter((one) => one.character === record.expect);
  const verdict =
    hit.length === 0
      ? onPage.length > 0
        ? `NÃO ENCONTRA ${JSON.stringify(record.expect)}: a página dá ${onPage
            .map((one) => JSON.stringify(one.character))
            .join(", ")}`
        : "NÃO ENCONTRA: nenhum token de um caractere nesta página"
      : `${hit.length} token(s) ${JSON.stringify(record.expect)} na página; ` +
        "leia a linha abaixo para dizer se está no lugar de um I ou de uma régua";
  console.log(` ${record.page}  "${record.claim}"  ->  ${verdict}`);
  for (const one of onPage) {
    console.log(line(one));
  }
  for (const panel of recordedPanels.filter((one) =>
    one.file.startsWith(record.page),
  )) {
    if (!panel.tokens.some((token) => token.length === 1)) {
      continue;
    }
    console.log(`   ${panel.panel}: ${panel.tokens.join(" ")}`);
  }
  console.log("");
}
