/**
 * Checks the reconciliation against the manifest that ships with the real pages.
 *
 * Reads the output of scripts/calibrate-extraction.ts rather than running OCR
 * again, so it is fast enough to re-run while changing a rule. The manifest is
 * the target, never a previous run of this script.
 *
 * The pages live outside the repository, so this never runs in CI.
 *
 *   npm run calibrate -- --out fixtures/calibration.json
 *   npm run smoke:reconcile -- fixtures/calibration.json
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  reconcilePoints,
  type PageReadings,
} from "../src/lib/extraction/reconcile.ts";

import { BOOK_2 } from "./books.ts";

const calib = JSON.parse(readFileSync(process.argv[2], "utf8")) as {
  file: string;
  raw_with_agreement: [number, number, number][];
  box_count: number;
  lesson_header: number[];
  revision_exercise: number[];
  chart_ref: number[];
}[];
const manifest = JSON.parse(
  readFileSync(join(BOOK_2, "manifest.json"), "utf8"),
) as {
  pages_detail: { file: string; points: number[]; duplicate_of?: string }[];
};
const truth = new Map(manifest.pages_detail.map((p) => [p.file, p]));
/*
 * The range of the book these fixtures are from, which is not 1 to 128.
 *
 * It read `first: 1` for a long time, and passed. That is worse than failing:
 * the floor is what throws away a margin reading below the book's first point,
 * and running book 2 with book 1's floor let every stray small digit through.
 * The three trips to review this script used to report were a `1` and a `3`
 * read off pages that carry no number at all. The smoke test was green while
 * measuring a configuration no book has, which is the shape of false
 * confidence: the run says the reconciler copes, and it was never asked the
 * question the product asks it.
 */
const RANGE = { first: 53, last: 128 };

function build(order: string[]): PageReadings[] {
  return order.map((file, uploadIndex) => {
    const c = calib.find((x) => x.file === file)!;
    return {
      id: file,
      uploadIndex,
      readings: c.raw_with_agreement.map(([value, y, agreement]) => ({
        value,
        y,
        agreement,
      })),
      boxCount: c.box_count,
      structureCount:
        c.lesson_header.length +
        c.revision_exercise.length +
        c.chart_ref.length,
    };
  });
}

function run(label: string, order: string[], verbose = true) {
  const r = reconcilePoints(build(order), RANGE);
  const assigned = [...new Set(r.assigned)].sort((a, b) => a - b);
  const expected = Array.from({ length: 76 }, (_, i) => 53 + i);

  // A wrong assignment is a page given a number that is not its own. A real
  // point that fell to review is not an error: reviews are the valve, and the
  // criterion is zero wrong answers rather than zero questions.
  const wrong = r.pages.filter((p) => {
    const want = truth.get(p.id)!;
    const wantPoints = want.duplicate_of ? [] : want.points;
    return p.points.some((n) => !wantPoints.includes(n));
  });
  const merged = r.pages.filter((p) => p.duplicateOf !== null);
  const inherited = r.pages.filter(
    (p) =>
      p.points.length === 0 &&
      p.duplicateOf === null &&
      truth.get(p.id)!.points.length === 0,
  );
  const reviews = r.pages.flatMap((p) =>
    p.disputes.map((d) => ({ id: p.id, ...d })),
  );
  const missing = expected.filter((n) => !assigned.includes(n));
  const ok =
    wrong.length === 0 && merged.length === 1 && inherited.length === 7;

  if (verbose) {
    console.log(`--- ${label} ---`);
    console.log(
      `  pontos atribuidos: ${assigned.length} de 76${missing.length ? `, caidos na revisao: ${JSON.stringify(missing)}` : ""}`,
    );
    console.log(`  ATRIBUICOES ERRADAS: ${wrong.length}`);
    for (const p of wrong.slice(0, 8)) {
      const want = truth.get(p.id)!;
      console.log(
        `     ${p.id}: obtido ${JSON.stringify(p.points)} esperado ${JSON.stringify(want.duplicate_of ? [] : want.points)}`,
      );
    }
    console.log(
      `  duplicata fundida: ${merged.length} -> ${merged.map((p) => `${p.id} => ${p.duplicateOf}`).join(", ") || "nenhuma"}`,
    );
    console.log(`  paginas herdando:  ${inherited.length} de 7`);
    console.log(`  idas a revisao:    ${reviews.length}`);
    for (const rev of reviews) {
      console.log(
        `     ${rev.id} y=${rev.y} candidatos ${JSON.stringify(rev.candidates)}`,
      );
    }
    console.log(`  CRITERIO: ${ok ? "ATINGIDO" : "NAO ATINGIDO"}\n`);
  }
  return { ok, reviews: reviews.length, missing };
}

// Small uploads first: the batch reasons from anchors and a small one has few,
// and small is how pages are actually uploaded.
const SLICES: Record<string, string[]> = {
  "3 paginas": ["p116.png", "p117-118.png", "p119-120.png"],
  "5 paginas": [
    "nopoint-3.png",
    "p116.png",
    "p117-118.png",
    "p119-120.png",
    "p121.png",
  ],
  "10 paginas": [
    "p116.png",
    "p117-118.png",
    "nopoint-3.png",
    "p119-120.png",
    "p121.png",
    "p122.png",
    "p123.png",
    "p124-125.png",
    "p126.png",
    "p127-128.png",
  ],
};
console.log("=== lotes pequenos ===");
for (const [label, slice] of Object.entries(SLICES)) {
  const present = slice.filter((f) => calib.some((c) => c.file === f));
  const result = reconcilePoints(build(present), RANGE);
  const assigned = result.assigned;
  const wrong = result.pages.filter((p) => {
    const want = truth.get(p.id)!;
    const wantPoints = want.duplicate_of ? [] : want.points;
    return p.points.some((n) => !wantPoints.includes(n));
  });
  console.log(
    `  ${label.padEnd(11)} atribuidos ${assigned.join(",")}  erradas ${wrong.length}  revisoes ${result.pages.flatMap((p) => p.disputes).length}`,
  );
  for (const p of wrong) {
    console.log(
      `     ERRADA ${p.id}: ${JSON.stringify(p.points)} esperado ${JSON.stringify(truth.get(p.id)!.points)}`,
    );
  }
}
console.log();

const files = calib.map((c) => c.file);
const alpha = run("ordem alfabetica", [...files].sort());
const reviewCounts: number[] = [alpha.reviews];
const missingSets = new Set<string>([JSON.stringify(alpha.missing)]);

let allOk = true;
for (let seed = 0; seed < 20; seed += 1) {
  const shuffled = [...files];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = (i * 7919 + seed * 104729 + 13) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const attempt = run(`embaralhado ${seed}`, shuffled, false);
  reviewCounts.push(attempt.reviews);
  missingSets.add(JSON.stringify(attempt.missing));
  if (!attempt.ok) {
    allOk = false;
    console.log(`  embaralhado ${seed}: FALHOU`);
    run(`embaralhado ${seed} (detalhe)`, shuffled);
    break;
  }
}
console.log(
  `criterio em 20 ordens aleatorias: ${allOk ? "ATINGIDO em todas" : "falhou"}`,
);
console.log(
  `idas a revisao por ordem: min ${Math.min(...reviewCounts)} max ${Math.max(...reviewCounts)}`,
);
console.log(
  `pontos caidos na revisao, conjuntos distintos: ${[...missingSets].join(" | ")}`,
);
