/**
 * Asks why one printed margin number was never read, and what it would cost.
 *
 * On the book 1 page that carries points 6 and 7, the margin reader returns
 * only the 7. The 6 is printed level with the "See Chart" icon, and there are
 * two candidate causes worth telling apart: a single digit in a strip too
 * narrow for the engine to resolve, or the icon's ink falling inside the crop
 * and being read as part of the same shape.
 *
 * The margin reader is the one stage that can move block attribution across
 * both books at once, and today that attribution is right. So this measures and
 * changes nothing. It answers three questions and stops:
 *
 *   1. what each of the three configured crops actually returns on that page,
 *      every word with its position and confidence, including the ones the
 *      reader's own filters throw away, so "the engine never saw it" and "the
 *      reader discarded it" are told apart rather than guessed at;
 *   2. whether any adjustment recovers the 6 without changing the readings of
 *      any other page of either book. Candidates are swept over all 92 pages
 *      and reported by what they break, not only by what they mend;
 *   3. whether the digit or the strip is the problem. Both candidate causes are
 *      about the crop's width, and both can be wrong at once, so the same strip
 *      is read again cut into shorter pieces. A digit that appears in a short
 *      piece and not in the tall one is legible, and what loses it is neither
 *      its size nor the icon beside it.
 *
 * The sweep reads margin strips only, never the panels, which is why it can
 * afford to run the whole corpus once per candidate.
 *
 * The pages live outside the repository, so this is a local tool and never runs
 * in CI.
 *
 *   node scripts/measure-margin-crops.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import {
  MARGIN_MAX_DIGITS,
  MARGIN_READ_CONFIGS,
  MARGIN_RIGHT_TOLERANCE,
  MARGIN_UPSCALE,
} from "../src/lib/extraction/constants.ts";
import {
  boxLeft,
  crop,
  normalise,
  resize,
  shadedMask,
} from "../src/lib/extraction/image.ts";
import { createTesseractReader } from "../src/lib/extraction/ocr-tesseract.ts";
import type { Bitmap, OcrReader } from "../src/lib/extraction/types.ts";
import { BOOK_1, BOOK_2 } from "./books.ts";

const DIGITS = "0123456789";

/** The page the question is about, and the number it loses. */
const TARGET_FILE = "Screenshot From 2026-09-05 17-29-56.png";
const TARGET_MISSING = 6;

type ReadConfig = {
  readonly padding: number;
  readonly pageSegmentation: number;
  readonly upscale: number;
};

/** The three the reader ships with, spelled out with the upscale it uses. */
const CONFIGURED: readonly ReadConfig[] = MARGIN_READ_CONFIGS.map((one) => ({
  padding: one.padding,
  pageSegmentation: one.pageSegmentation,
  upscale: MARGIN_UPSCALE,
}));

/**
 * The adjustments worth asking about, each a fourth crop added to the three.
 *
 * Added rather than substituted: the three together are what found all 76
 * numbers of the measured set, and replacing one of them is a different and
 * much larger question than adding one. Padding moves the right edge of the
 * strip, which is the "icon in the crop" hypothesis; the segmentation modes are
 * the ones that treat a strip as a single line or a sparse page; the upscale is
 * the "too small to resolve" hypothesis.
 */
const CANDIDATES: readonly ReadConfig[] = [
  { padding: -12, pageSegmentation: 6, upscale: 5 },
  { padding: -12, pageSegmentation: 11, upscale: 5 },
  { padding: -2, pageSegmentation: 11, upscale: 5 },
  { padding: -2, pageSegmentation: 10, upscale: 5 },
  { padding: 6, pageSegmentation: 11, upscale: 5 },
  { padding: 14, pageSegmentation: 6, upscale: 5 },
  { padding: 22, pageSegmentation: 11, upscale: 5 },
  { padding: -2, pageSegmentation: 6, upscale: 8 },
  { padding: 14, pageSegmentation: 11, upscale: 8 },
  { padding: 22, pageSegmentation: 6, upscale: 8 },
];

const name = (config: ReadConfig) =>
  `padding ${String(config.padding).padStart(3)}  psm ${String(config.pageSegmentation).padStart(2)}  x${config.upscale}`;

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

type Seen = {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly confidence: number;
  /** Null when the reader would have kept it, otherwise why it did not. */
  readonly refused: string | null;
};

/** One crop, read and filtered exactly as `marginReadings` filters it. */
async function readCrop(
  page: Bitmap,
  left: number,
  config: ReadConfig,
  reader: OcrReader,
): Promise<readonly Seen[]> {
  const right = Math.max(left + config.padding, 8);
  const strip = crop(page, 0, 0, right, page.height);
  if (strip.width === 0 || strip.height === 0) {
    return [];
  }
  const enlarged = resize(
    strip,
    strip.width * config.upscale,
    strip.height * config.upscale,
  );
  const words = await reader.read(enlarged, {
    pageSegmentation: config.pageSegmentation,
    allowedCharacters: DIGITS,
  });
  return words
    .filter((word) => word.text.trim() !== "")
    .map((word) => {
      const digits = word.text.replace(/\D/g, "");
      const x = Math.trunc(word.x / config.upscale);
      let refused: string | null = null;
      if (digits.length === 0) {
        refused = "sem dígito";
      } else if (digits.length > MARGIN_MAX_DIGITS) {
        refused = `${digits.length} dígitos, acima de MARGIN_MAX_DIGITS`;
      } else if (x >= left - MARGIN_RIGHT_TOLERANCE) {
        refused = `começa em x=${x}, dentro da coluna de texto (box_left ${left})`;
      }
      return {
        text: word.text,
        x,
        y: Math.trunc(word.y / config.upscale),
        confidence: word.confidence,
        refused,
      };
    });
}

/** The set of values one set of crops would hand the reconciler for a page. */
async function valuesOf(
  page: Bitmap,
  left: number,
  configs: readonly ReadConfig[],
  reader: OcrReader,
): Promise<ReadonlySet<number>> {
  const values = new Set<number>();
  for (const config of configs) {
    for (const seen of await readCrop(page, left, config, reader)) {
      if (seen.refused === null) {
        values.add(Number(seen.text.replace(/\D/g, "")));
      }
    }
  }
  return values;
}

const reader = createTesseractReader({ encode });

// --- 1. the page itself ----------------------------------------------------

const targetPath = join(BOOK_1, TARGET_FILE);
if (!existsSync(targetPath)) {
  throw new Error(`Não encontrei ${targetPath}.`);
}
const target = normalise(decode(targetPath));
const targetLeft = boxLeft(shadedMask(target));

console.log(`=== 1. o que os três recortes devolvem em ${TARGET_FILE} ===\n`);
console.log(
  `  A página é normalizada para ${target.width}px de largura, ${target.height}px de altura.\n` +
    `  box_left = ${targetLeft}. O 7 lido pelo pipeline está em y=1008; o ${TARGET_MISSING} que falta\n` +
    `  é impresso na altura do ícone do See Chart, perto de y=320.\n`,
);

for (const config of CONFIGURED) {
  const seen = await readCrop(target, targetLeft, config, reader);
  const right = Math.max(targetLeft + config.padding, 8);
  console.log(
    `\n  --- ${name(config)}  (tira de 0 a ${right}px, lida a ${right * config.upscale}px) ---`,
  );
  if (seen.length === 0) {
    console.log("    o engine não devolveu nada");
    continue;
  }
  console.log("      texto     x      y   conf   situação");
  for (const one of [...seen].sort((a, b) => a.y - b.y)) {
    console.log(
      `      ${JSON.stringify(one.text).padEnd(8)} ${String(one.x).padStart(4)} ${String(one.y).padStart(6)} ` +
        `${one.confidence.toFixed(0).padStart(5)}   ${one.refused ?? "aceito"}`,
    );
  }
}

// --- 2. what an adjustment would cost --------------------------------------

console.log(`\n\n=== 2. algum ajuste recupera o ${TARGET_MISSING}? ===\n`);
console.log("  Primeiro, cada candidato sozinho na página em questão.\n");

const recovers: ReadConfig[] = [];
for (const config of CANDIDATES) {
  const seen = await readCrop(target, targetLeft, config, reader);
  const accepted = seen.filter((one) => one.refused === null);
  const found = accepted.some(
    (one) => Number(one.text.replace(/\D/g, "")) === TARGET_MISSING,
  );
  console.log(
    `  ${name(config)}  ->  ${found ? `ACHA o ${TARGET_MISSING}` : `não acha o ${TARGET_MISSING}`}` +
      `   aceitos: ${accepted.map((one) => one.text).join(" ") || "nenhum"}` +
      `   recusados: ${seen.length - accepted.length}`,
  );
  if (found) {
    recovers.push(config);
  }
}

if (recovers.length === 0) {
  console.log(
    `\n  Nenhum dos candidatos recupera o ${TARGET_MISSING}. Nenhuma largura de recorte,\n` +
      "  nenhum dos modos de segmentação e nenhuma ampliação maior o traz de volta.\n" +
      "  Não há varredura de custo a fazer sobre esses: um ajuste que não mende nada\n" +
      "  não precisa ter o preço medido.",
  );
} else {
  console.log(
    `\n  ${recovers.length} candidato(s) recuperam. Agora o custo: cada um é acrescentado\n` +
      "  aos três de hoje e a leitura da margem é refeita nas 92 páginas dos dois livros.\n" +
      "  O que importa é qualquer página cujo conjunto de leituras mude.\n",
  );

  const corpus: { book: string; file: string; page: Bitmap; left: number }[] =
    [];
  for (const [book, root] of [
    ["livro 1", BOOK_1],
    ["livro 2", BOOK_2],
  ] as const) {
    for (const file of pagesOf(root)) {
      const page = normalise(decode(join(root, file)));
      corpus.push({ book, file, page, left: boxLeft(shadedMask(page)) });
    }
  }

  const baseline = new Map<string, ReadonlySet<number>>();
  for (const one of corpus) {
    baseline.set(
      `${one.book}/${one.file}`,
      await valuesOf(one.page, one.left, CONFIGURED, reader),
    );
    process.stderr.write(`  base ${one.book} ${one.file}\n`);
  }

  for (const config of recovers) {
    const withIt = [...CONFIGURED, config];
    const changed: string[] = [];
    for (const one of corpus) {
      const key = `${one.book}/${one.file}`;
      const before = baseline.get(key) as ReadonlySet<number>;
      const after = await valuesOf(one.page, one.left, withIt, reader);
      const added = [...after].filter((value) => !before.has(value));
      const removed = [...before].filter((value) => !after.has(value));
      if (added.length > 0 || removed.length > 0) {
        changed.push(
          `    ${one.book}  ${one.file.padEnd(34)} +[${added.join(" ")}] -[${removed.join(" ")}]`,
        );
      }
      process.stderr.write(`  ${name(config)} ${one.book} ${one.file}\n`);
    }
    console.log(`\n  --- ${name(config)} acrescentado aos três ---`);
    console.log(
      `    páginas com leitura alterada: ${changed.length} de ${corpus.length}`,
    );
    for (const line of changed) {
      console.log(line);
    }
  }
}

// --- 3. is it the glyph, or the strip it is read in? ---------------------

console.log("\n\n=== 3. o dígito ou a tira? ===\n");
console.log(
  "  As duas causas candidatas eram o dígito solto numa imagem apertada e o ícone\n" +
    "  do See Chart sujando o recorte. O recorte mais estreito dos três vai de 0 a\n" +
    `  ${Math.max(targetLeft - 2, 8)}px e o ícone começa depois de box_left, ou seja fora dele, e mesmo\n` +
    "  assim o número não vem. Então a terceira pergunta: a mesma tira, cortada em\n" +
    "  pedaços mais baixos. Se o dígito aparecer aí, ele está legível e o que o perde\n" +
    "  é a análise de layout de uma coluna de 85px por 1661px.\n",
);

const width = Math.max(targetLeft - 2, 8);
const windows: readonly (readonly [string, number, number])[] = [
  ["tira inteira", 0, target.height],
  ["metade de cima", 0, Math.trunc(target.height / 2)],
  ["janela de 160px no 6", 260, 420],
  ["janela de 160px no 7", 940, 1100],
];
console.log("  recorte                     psm  o que voltou");
for (const [label, top, bottom] of windows) {
  for (const pageSegmentation of [6, 11, 3]) {
    const strip = crop(target, 0, top, width, bottom);
    const enlarged = resize(
      strip,
      strip.width * MARGIN_UPSCALE,
      strip.height * MARGIN_UPSCALE,
    );
    const words = await reader.read(enlarged, {
      pageSegmentation,
      allowedCharacters: DIGITS,
    });
    const seen = words
      .filter((word) => word.text.trim() !== "")
      .map(
        (word) =>
          `${JSON.stringify(word.text.trim())}@y${Math.trunc(word.y / MARGIN_UPSCALE) + top}`,
      );
    console.log(
      `  ${label.padEnd(26)} ${String(pageSegmentation).padStart(3)}  ${seen.join(" ") || "nada"}`,
    );
  }
}

await reader.close();
