/**
 * Asks whether a second reading of a table panel gets the subjects back.
 *
 * On p056 of book 2 the conjugation panel keeps you, she, you and they and
 * loses he, it and we: there is no token for them at all, so no filter can
 * recover them. On p059, the same book and the same face, all nine come back.
 * It is per page and not per word length, which means the answer, if there is
 * one, is another reading and not a rule.
 *
 * The margin reader already works that way and the trick is measured there:
 * three crops with different page segmentation modes, unioned, found all 76
 * numbers where no single one did. This asks the same question of the panels.
 *
 * For each candidate mode the panel is read again and the two readings are
 * merged by position: a token from the second read counts as new when its box
 * does not overlap any token of the first. That is the whole merge, because
 * overlap is what says "the engine has already reported this glyph".
 *
 * What is reported is the trade, both halves of it:
 *
 *   - subjects recovered. The panels are conjugations, so the pronouns are
 *     known: I, you, he, she, it, we, they. A pronoun the first read missed and
 *     the second found is the thing this is for.
 *   - everything else the second read adds. That is the cost, and it is printed
 *     token by token rather than counted, because a stray "]" and a stray
 *     "DIIGO" are not the same kind of cost and the difference cannot be seen
 *     in a total.
 *
 * A mode that brings in more rubbish than pronouns is not worth having, and the
 * point of printing both is that the decision can be read off the report.
 *
 * Measures and changes nothing. The pages live outside the repository, so this
 * is a local tool and never runs in CI.
 *
 *   node scripts/measure-table-second-pass.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import { boxes } from "../src/lib/extraction/boxes.ts";
import { TABLE_HEIGHT } from "../src/lib/extraction/constants.ts";
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

/** The pronouns a conjugation panel is made of, lower-cased for comparison. */
const SUBJECTS = new Set(["i", "you", "he", "she", "it", "we", "they"]);

/**
 * The modes worth asking about, beside the automatic one the pipeline uses.
 *
 * 6 is the fixed mode the ordinary panels are read with and the one the margin
 * reader leans on; 11 is sparse text, which is what a column of two-letter
 * words in a field of white actually is; 4 is a single column of text of
 * varying sizes, which is the other description that fits a conjugation panel.
 */
const CANDIDATES = [6, 11, 4] as const;

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

const clean = (word: OcrWord) => word.text.trim();
const isSubject = (word: OcrWord) =>
  SUBJECTS.has(
    clean(word)
      .toLowerCase()
      .replace(/[^a-z]/g, ""),
  );

/** Whether two boxes share any area, which is what says the glyph is the same. */
function overlaps(a: OcrWord, b: OcrWord): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

const reader = createTesseractReader({ encode });
type Tally = { recovered: string[]; noise: string[] };
const tallies = new Map<number, Tally>(
  CANDIDATES.map((mode) => [mode, { recovered: [], noise: [] }]),
);
let panels = 0;

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
      const read = (mode?: number) =>
        reader
          .read(
            enlarged,
            mode === undefined ? undefined : { pageSegmentation: mode },
          )
          .then((words) =>
            splitFusedWords(enlarged, words, SCALE).filter(
              (word) => clean(word) !== "",
            ),
          );

      const first = await read();
      console.log(`\n${book}  ${file}  painel@${band.top}`);
      console.log(
        `  hoje (automático): ${first.filter(isSubject).length} sujeitos` +
          `   [${first.map(clean).join(" ")}]`,
      );

      for (const mode of CANDIDATES) {
        const second = await read(mode);
        const added = second.filter(
          (word) => !first.some((already) => overlaps(word, already)),
        );
        const subjects = added.filter(isSubject);
        const noise = added.filter((word) => !isSubject(word));
        const tally = tallies.get(mode) as Tally;
        tally.recovered.push(...subjects.map(clean));
        tally.noise.push(...noise.map(clean));
        console.log(
          `  psm ${String(mode).padStart(2)}: +${subjects.length} sujeitos` +
            ` [${subjects.map(clean).join(" ")}]` +
            `   +${noise.length} outros [${noise.map(clean).join(" ")}]`,
        );
      }
    }
    process.stderr.write(`  ${book} ${file}\n`);
  }
}
await reader.close();

console.log(`\n\n=== resumo, ${panels} painéis altos ===\n`);
console.log("  psm   sujeitos recuperados   outros tokens acrescentados");
for (const mode of CANDIDATES) {
  const tally = tallies.get(mode) as Tally;
  console.log(
    `  ${String(mode).padStart(3)}   ${String(tally.recovered.length).padStart(18)}   ${String(tally.noise.length).padStart(27)}`,
  );
}
for (const mode of CANDIDATES) {
  const tally = tallies.get(mode) as Tally;
  console.log(`\n  --- psm ${mode} ---`);
  console.log(`    sujeitos: ${tally.recovered.join(" ") || "nenhum"}`);
  console.log(`    outros:   ${tally.noise.join(" ") || "nenhum"}`);
}
