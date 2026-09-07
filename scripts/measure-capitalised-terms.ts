/**
 * Counts the vocabulary terms that begin with a capital, panel by panel.
 *
 * Point 7 of book 1 prints "six seven eight nine ten" and the reader returned
 * "Six seven eight nine ten": the first term of the panel came back capitalised
 * and the four after it did not. A rule that lowercases such a term is a rule
 * about what a book prints, so it needs the population first.
 *
 * The claim to test is that two populations exist and do not overlap:
 *
 *   - a proper name comes in a block. "Mr Mrs Jack Anna" is a panel where every
 *     term is capitalised, because the book prints them that way.
 *   - a misreading comes alone. A capital in a panel whose other terms are
 *     lowercase is the engine, not the printer.
 *
 * If the panels sort into all-capital and mostly-lowercase with nothing in
 * between, the rule has a cut. If a panel sits in the middle, it does not, and
 * no cut should be invented to cover it.
 *
 * "I" is excluded by name. It is a legitimate capital of one character, it is
 * printed capital in every book, and it is the one term for which the majority
 * of its panel says nothing at all.
 *
 * Both books in one run, because the rule would apply to both. The pages live
 * outside the repository, so this is a local tool and never runs in CI.
 *
 *   node scripts/measure-capitalised-terms.ts
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
import { repairPrintedI } from "../src/lib/extraction/printed-i.ts";
import { stripTranscriptions } from "../src/lib/extraction/pronunciation.ts";
import { printedLines } from "../src/lib/extraction/table-layout.ts";
import { termsFrom } from "../src/lib/extraction/terms.ts";
import type { Bitmap } from "../src/lib/extraction/types.ts";
import { BOOK_1, BOOK_2 } from "./books.ts";

/** The same enlargement the pipeline reads a panel at. */
const SCALE = 2;

/** The one capital that is never a misreading, and never counted here. */
const PRINTED_CAPITAL = "I";

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

/** Whether a term opens with a capital letter, "I" aside. */
function isCapitalised(term: string): boolean {
  if (term === PRINTED_CAPITAL) {
    return false;
  }
  const first = term[0] ?? "";
  return first !== first.toLowerCase() && first === first.toUpperCase();
}

type Panel = {
  readonly book: string;
  readonly file: string;
  readonly top: number;
  readonly terms: readonly string[];
  readonly capitalised: readonly string[];
  readonly lowercase: number;
};

const reader = createTesseractReader({ encode });
const panels: Panel[] = [];

for (const fixtures of [BOOK_1, BOOK_2]) {
  if (!existsSync(fixtures)) {
    console.log(`${fixtures}: ausente, pulado`);
    continue;
  }
  const files = readdirSync(fixtures)
    .filter((file) => file.endsWith(".png"))
    .sort();

  for (const file of files) {
    const page = normalise(decode(join(fixtures, file)));
    const mask = shadedMask(page);
    const left = boxLeft(mask);

    for (const band of boxes(mask)) {
      // A tall panel is a grid, is read differently, and never becomes a list
      // of terms. The rule being measured could not reach it, so neither does
      // this: skipped before the crop rather than after the read.
      if (band.bottom - band.top > TABLE_HEIGHT) {
        continue;
      }
      const region = crop(page, left, band.top, page.width, band.bottom);
      const enlarged = resize(
        region,
        region.width * SCALE,
        region.height * SCALE,
      );
      // Exactly the pipeline's reading of an ordinary panel, so a panel counted
      // here is a panel that reaches the teacher, and the two cannot disagree
      // about which is which.
      const read = splitFusedWords(
        enlarged,
        await reader.read(enlarged, {
          pageSegmentation: BOX_PAGE_SEGMENTATION,
        }),
        SCALE,
      );
      // A panel of more than one printed line is a grid too, whatever its
      // height, and goes the same way.
      if (printedLines(read, SCALE) > 1) {
        continue;
      }
      const { terms } = stripTranscriptions(
        termsFrom(repairPrintedI(read), SCALE),
      );
      if (terms.length === 0) {
        continue;
      }
      const capitalised = terms.filter(isCapitalised);
      panels.push({
        book: fixtures,
        file,
        top: band.top,
        terms,
        capitalised,
        lowercase: terms.length - capitalised.length,
      });
    }
    process.stderr.write(`  lida ${file}\n`);
  }
}

await reader.close();

const withCapital = panels.filter((panel) => panel.capitalised.length > 0);
console.log(
  `${panels.length} painéis de vocabulário, ` +
    `${panels.reduce((sum, panel) => sum + panel.terms.length, 0)} termos, ` +
    `${withCapital.length} painéis com ao menos um termo maiúsculo\n`,
);

for (const panel of withCapital) {
  const all = panel.capitalised.length === panel.terms.length;
  console.log(
    `${panel.file} @${panel.top}  ` +
      `${panel.capitalised.length} maiúsculos / ${panel.lowercase} minúsculos` +
      `${all ? "  TODOS" : ""}`,
  );
  console.log(`   termos: ${panel.terms.join(" · ")}`);
}

/*
 * The two populations, side by side. A panel where every term is capitalised is
 * the block of proper names; one where a minority is, is the misreading. What
 * decides whether the rule has a cut is whether anything lands between them.
 */
const allCapital = withCapital.filter(
  (panel) => panel.capitalised.length === panel.terms.length,
);
const someCapital = withCapital.filter(
  (panel) => panel.capitalised.length < panel.terms.length,
);
console.log(
  `\n${allCapital.length} painéis inteiramente maiúsculos, ` +
    `${someCapital.length} com maiúsculos em minoria ou empate`,
);
for (const panel of someCapital) {
  const share = panel.capitalised.length / panel.terms.length;
  console.log(
    `   ${panel.file} @${panel.top}: ${panel.capitalised.length}/${panel.terms.length}` +
      ` = ${share.toFixed(2)}  (${panel.capitalised.join(", ")})`,
  );
}
