/**
 * Measures the agreement gate of the reconciler against a book's hand-read
 * truth, and the geometry headroom of the panel constants on the same pages.
 *
 * `reconcile.ts` will not settle a margin reading unless something corroborates
 * it, and the first of its three ways is `agreement >= 2`: two of the three
 * margin crops saw the same number. That gate was never measured. It was chosen
 * against book 2, whose points run 53 to 128 and are therefore two and three
 * digits long, and `margin-numbers.ts` says in as many words that the count is
 * "a diagnostic, not yet a decision: no rule uses it until there is a
 * measurement saying it separates signal from noise". This is that measurement,
 * and it exists because book 1 runs 1 to 52, where most numbers are one digit.
 *
 * Nothing here changes extraction. It reads pages, runs the real stages over
 * them, and prints what they gave.
 *
 * The pages live outside the repository, so this is a local tool and never runs
 * in CI.
 *
 *   node scripts/measure-agreement-gate.ts
 *   node scripts/measure-agreement-gate.ts \
 *     --fixtures fixtures/real/book2 --truth fixtures/real/book2/manifest.json \
 *     --first 53 --last 128
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

import { boxes } from "../src/lib/extraction/boxes.ts";
import {
  MARGIN_AGREEMENT,
  MERGE_GAP,
  MIN_BOX_HEIGHT,
  POINT_LABEL_REACH,
  ROW_SHADED_FRACTION,
  TABLE_HEIGHT,
} from "../src/lib/extraction/constants.ts";
import { normalise, shadedMask } from "../src/lib/extraction/image.ts";
import { createTesseractReader } from "../src/lib/extraction/ocr-tesseract.ts";
import { extractPage } from "../src/lib/extraction/pipeline.ts";
import {
  reconcilePoints,
  type PageReadings,
} from "../src/lib/extraction/reconcile.ts";
import type { Bitmap } from "../src/lib/extraction/types.ts";
import { BOOK_1 } from "./books.ts";
import { readTruth, type TruthPage } from "./truth-file.ts";

const args = process.argv.slice(2);
function option(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
}

const FIXTURES = option("fixtures", BOOK_1);
const TRUTH = option("truth", join(FIXTURES, "truth.txt"));
const RANGE = {
  first: Number(option("first", "1")),
  last: Number(option("last", "52")),
};
const limit = Number(option("limit", String(Number.POSITIVE_INFINITY)));

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

function tally(values: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, count]) => `${value}: ${count}`)
    .join("  ");
}

/**
 * The shaded runs before `boxes` merges and filters them.
 *
 * MERGE_GAP is compared against the gap between two consecutive runs, and
 * MIN_BOX_HEIGHT against a merged run's height, so measuring the headroom of
 * either needs the runs themselves. Repeated here rather than exported from
 * boxes.ts, which is extraction and is not being touched: the row test is the
 * same one, against the same constant.
 */
function shadedRuns(mask: {
  width: number;
  height: number;
  data: Uint8Array;
}): readonly { top: number; bottom: number }[] {
  const runs: { top: number; bottom: number }[] = [];
  let start: number | null = null;
  for (let y = 0; y < mask.height; y += 1) {
    let shaded = 0;
    const row = y * mask.width;
    for (let x = 0; x < mask.width; x += 1) {
      shaded += mask.data[row + x];
    }
    const isShaded = shaded / mask.width > ROW_SHADED_FRACTION;
    if (isShaded && start === null) {
      start = y;
    } else if (!isShaded && start !== null) {
      runs.push({ top: start, bottom: y });
      start = null;
    }
  }
  if (start !== null) {
    runs.push({ top: start, bottom: mask.height });
  }
  return runs;
}

const truth = readTruth(TRUTH);
const onDisk = new Set(
  readdirSync(FIXTURES).filter((name) => name.endsWith(".png")),
);
const pages = truth.filter((page) => onDisk.has(page.file)).slice(0, limit);
const unlisted = [...onDisk].filter(
  (name) => !truth.some((page) => page.file === name),
);

console.log(`${FIXTURES}  pontos ${RANGE.first}..${RANGE.last}`);
console.log(
  `${pages.length} páginas no gabarito, ${onDisk.size} imagens no diretório` +
    (unlisted.length > 0 ? `, ${unlisted.length} fora do gabarito` : ""),
);
for (const name of unlisted) {
  console.log(`  fora do gabarito, ignorada: ${name}`);
}

const reader = createTesseractReader({ encode });

type Measured = {
  readonly truth: TruthPage;
  readonly readings: readonly { value: number; y: number; agreement: number }[];
  readonly runs: readonly { top: number; bottom: number }[];
  readonly heights: readonly number[];
  /** Tops of the blocks the pipeline found, so content can be placed. */
  readonly blockTops: readonly number[];
  /** Kinds, in the same order as the tops, so a dump can be read back. */
  readonly blockKinds: readonly string[];
};

const measured: Measured[] = [];
let index = 0;
for (const page of pages) {
  const image = normalise(decode(join(FIXTURES, page.file)));
  const mask = shadedMask(image);
  const extraction = await extractPage(page.file, index, image, reader);
  index += 1;
  measured.push({
    truth: page,
    readings: extraction.readings.map((reading) => ({ ...reading })),
    runs: shadedRuns(mask),
    heights: boxes(mask).map((band) => band.bottom - band.top),
    blockTops: extraction.blocks.map((block) => block.band.top),
    blockKinds: extraction.blocks.map((block) => block.kind),
  });
  process.stderr.write(`  lida ${page.file}\n`);
}

// --- (a) e (b) o que o agreement vale, verdadeiro contra ruído -------------

const inRange = (value: number) => value >= RANGE.first && value <= RANGE.last;

const trueAgreement: number[] = [];
const noiseAgreement: number[] = [];
const noiseAgreementInRange: number[] = [];
for (const page of measured) {
  for (const reading of page.readings) {
    if (page.truth.points.includes(reading.value)) {
      trueAgreement.push(reading.agreement);
    } else {
      noiseAgreement.push(reading.agreement);
      if (inRange(reading.value)) {
        noiseAgreementInRange.push(reading.agreement);
      }
    }
  }
}

const expected = measured.reduce(
  (total, page) => total + page.truth.points.length,
  0,
);
console.log(`\n=== (a) agreement dos números verdadeiros ===`);
console.log(`  ${trueAgreement.length} de ${expected} números lidos`);
console.log(`  ${tally(trueAgreement)}`);
console.log(`\n=== (b) agreement do ruído ===`);
console.log(`  ${noiseAgreement.length} leituras que não são número da página`);
console.log(`  todas:        ${tally(noiseAgreement)}`);
console.log(
  `  na faixa do livro (${RANGE.first}..${RANGE.last}), que é o que o` +
    ` reconciliador vê: ${noiseAgreementInRange.length}` +
    (noiseAgreementInRange.length > 0
      ? `  ${tally(noiseAgreementInRange)}`
      : ""),
);

// --- (c) o portão em si ----------------------------------------------------

// The constant itself, never a copy of it: the numbers this prints are what
// justifies MARGIN_AGREEMENT, and a second 2 here would let the two drift apart
// without the script noticing.
const GATE = MARGIN_AGREEMENT;
const refused = trueAgreement.filter((value) => value < GATE).length;
const admitted = noiseAgreementInRange.filter((value) => value >= GATE).length;
console.log(`\n=== (c) o portão agreement >= ${GATE} ===`);
console.log(
  `  recusaria ${refused} de ${trueAgreement.length} verdadeiros` +
    ` (${((100 * refused) / Math.max(trueAgreement.length, 1)).toFixed(1)}%)`,
);
console.log(
  `  deixaria passar ${admitted} de ${noiseAgreementInRange.length}` +
    ` ruídos na faixa`,
);

const batch: PageReadings[] = measured.map((page, order) => ({
  id: page.truth.file,
  uploadIndex: order,
  readings: page.readings,
  boxCount: page.heights.length,
  structureCount: 0,
}));
const resolution = reconcilePoints(batch, RANGE);
const settled = new Map(resolution.pages.map((page) => [page.id, page.points]));
let pagesExact = 0;
let pagesDisputed = 0;
let pointsSettled = 0;
let pointsWrong = 0;
let pointsInvented = 0;
for (const page of measured) {
  const got = settled.get(page.truth.file) ?? [];
  const want = [...page.truth.points].sort((a, b) => a - b);
  if (got.join(",") === want.join(",")) {
    pagesExact += 1;
  }
  const disputes =
    resolution.pages.find((one) => one.id === page.truth.file)?.disputes ?? [];
  if (disputes.length > 0) {
    pagesDisputed += 1;
  }
  for (const value of got) {
    if (want.includes(value)) {
      pointsSettled += 1;
    } else {
      pointsInvented += 1;
    }
  }
  pointsWrong += want.filter((value) => !got.includes(value)).length;
}
console.log(
  `\n  o lote inteiro pelo reconciliador de hoje: ${pagesExact} de` +
    ` ${measured.length} páginas exatas, ${pagesDisputed} com pergunta`,
);
console.log(
  `  pontos: ${pointsSettled} de ${expected} resolvidos,` +
    ` ${pointsWrong} não resolvidos, ${pointsInvented} inventados`,
);

// --- (d) a ordem impressa serviria de corroboração? ------------------------

console.log(
  `\n=== (d) páginas cujos verdadeiros ficaram todos em agreement 1 ===`,
);
let allOnes = 0;
let increasing = 0;
for (const page of measured) {
  const found = page.readings.filter((reading) =>
    page.truth.points.includes(reading.value),
  );
  if (
    found.length === 0 ||
    found.length !== page.truth.points.length ||
    found.some((reading) => reading.agreement >= GATE)
  ) {
    continue;
  }
  allOnes += 1;
  const byHeight = [...found].sort((a, b) => a.y - b.y);
  const chain = byHeight.every(
    (reading, at) => at === 0 || reading.value > byHeight[at - 1].value,
  );
  if (chain) {
    increasing += 1;
  }
  console.log(
    `  ${page.truth.file.padEnd(38)} ${byHeight
      .map((one) => `${one.value}@${one.y}`)
      .join(" ")}   ${chain ? "crescente" : "FORA DE ORDEM"}`,
  );
}
console.log(
  `  ${allOnes} páginas, ${increasing} delas com os números crescendo na` +
    ` ordem impressa`,
);

// --- de carona: a folga geométrica das constantes de painel ----------------

const gaps: number[] = [];
for (const page of measured) {
  for (let at = 1; at < page.runs.length; at += 1) {
    gaps.push(page.runs[at].top - page.runs[at - 1].bottom);
  }
}
const heights = measured.flatMap((page) => page.heights);
const ordinary = heights.filter((height) => height <= TABLE_HEIGHT);
const tall = heights.filter((height) => height > TABLE_HEIGHT);
const joined = gaps.filter((gap) => gap <= MERGE_GAP);
const kept = gaps.filter((gap) => gap > MERGE_GAP);

console.log(`\n=== folga das constantes de painel ===`);
console.log(
  `  MERGE_GAP=${MERGE_GAP}: ${gaps.length} vãos entre faixas sombreadas,` +
    ` ${joined.length} unidos${joined.length > 0 ? ` (até ${Math.max(...joined)}px)` : ""},` +
    ` ${kept.length} mantidos${kept.length > 0 ? ` (a partir de ${Math.min(...kept)}px)` : ""}`,
);
console.log(
  `  MIN_BOX_HEIGHT=${MIN_BOX_HEIGHT}: ${heights.length} caixas,` +
    ` a mais baixa ${heights.length > 0 ? Math.min(...heights) : "-"}px`,
);
console.log(
  `  TABLE_HEIGHT=${TABLE_HEIGHT}: ${ordinary.length} normais` +
    `${ordinary.length > 0 ? ` (até ${Math.max(...ordinary)}px)` : ""},` +
    ` ${tall.length} altas${tall.length > 0 ? ` (a partir de ${Math.min(...tall)}px)` : ""}`,
);

// --- conteúdo impresso acima do primeiro número da página ------------------

console.log(`\n=== conteúdo acima do primeiro número da página ===`);
let affected = 0;
let orphanBlocks = 0;
let unplaceable = 0;
for (const page of measured) {
  const found = page.readings
    .filter((reading) => page.truth.points.includes(reading.value))
    .sort((a, b) => a.y - b.y);
  // Only a page whose every number was located can be asked this. Where one was
  // missed, the highest reading is not the highest number, and content that sits
  // under a number the crops never saw would be counted as sitting above it.
  if (found.length === 0 || found.length !== page.truth.points.length) {
    unplaceable += page.truth.points.length > 0 ? 1 : 0;
    continue;
  }
  const placements = found.map((reading) => ({
    number: reading.value,
    y: reading.y,
  }));
  // Above the first number, and not merely above the line the first number is
  // printed on: a panel whose own number sits a few pixels inside it is named by
  // that number, not orphaned. Counting those made the figure too big.
  const above = page.blockTops.filter(
    (top) =>
      !placements.some(
        (place) => place.y - top >= 0 && place.y - top < POINT_LABEL_REACH,
      ) && top < placements[0].y,
  );
  if (above.length === 0) {
    continue;
  }
  affected += 1;
  orphanBlocks += above.length;
  // Where they go is the batch's answer, not this page's: they fall to the
  // point the page opens in, which only the upload order knows. This counts
  // them; scripts/dump-block-points.ts says where each one lands.
  console.log(
    `  ${page.truth.file.padEnd(38)} primeiro número ${placements[0].number}` +
      `@${placements[0].y}, ${above.length} bloco(s) acima em` +
      ` ${above.map((top) => `y=${top}`).join(" ")}`,
  );
}
console.log(
  `  ${affected} de ${measured.length - unplaceable} páginas medíveis têm` +
    ` conteúdo acima do seu primeiro número, ${orphanBlocks} blocos ao todo` +
    ` (${unplaceable} páginas fora da conta, com algum número não lido)`,
);

// Kept so the geometry can be re-read without paying for OCR again.
const dump = option("json", "");
if (dump !== "") {
  writeFileSync(
    dump,
    JSON.stringify(
      measured.map((page) => ({
        file: page.truth.file,
        truth: page.truth.points,
        notes: page.truth.notes,
        readings: page.readings,
        runs: page.runs,
        heights: page.heights,
        blocks: page.blockTops.map((top, at) => ({
          top,
          kind: page.blockKinds[at],
        })),
      })),
      null,
      1,
    ),
  );
  console.log(`\ngeometria gravada em ${dump}`);
}

await reader.close();
