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
import {
  reconcilePoints,
  type PageReadings,
} from "../src/lib/extraction/reconcile.ts";

const calib = JSON.parse(readFileSync(process.argv[2], "utf8")) as {
  file: string;
  raw_with_agreement: [number, number, number][];
  box_count: number;
  lesson_header: number[];
  revision_exercise: number[];
  chart_ref: number[];
}[];
const manifest = JSON.parse(
  readFileSync("fixtures/real/manifest.json", "utf8"),
) as {
  pages_detail: { file: string; points: number[]; duplicate_of?: string }[];
};
const truth = new Map(manifest.pages_detail.map((p) => [p.file, p]));
const CEILING = 128;

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
  const r = reconcilePoints(build(order), CEILING);
  const assigned = [...new Set(r.assigned)].sort((a, b) => a - b);
  const expected = Array.from({ length: 76 }, (_, i) => 53 + i);
  const rangeOk = JSON.stringify(assigned) === JSON.stringify(expected);

  const wrong = r.pages.filter((p) => {
    const want = truth.get(p.id)!;
    const wantPoints = want.duplicate_of ? [] : want.points;
    return JSON.stringify(p.points) !== JSON.stringify(wantPoints);
  });
  const merged = r.pages.filter((p) => p.duplicateOf !== null);
  const inherited = r.pages.filter(
    (p) => p.points.length === 0 && p.duplicateOf === null,
  );
  const ok =
    rangeOk &&
    wrong.length === 0 &&
    !r.needsReview &&
    merged.length === 1 &&
    inherited.length === 7;

  if (verbose) {
    console.log(`--- ${label} ---`);
    console.log(
      `  76 pontos 53..128: ${rangeOk} (${assigned.length} atribuidos)`,
    );
    console.log(`  paginas erradas:   ${wrong.length}`);
    for (const p of wrong.slice(0, 8)) {
      const want = truth.get(p.id)!;
      console.log(
        `     ${p.id}: obtido ${JSON.stringify(p.points)} esperado ${JSON.stringify(want.duplicate_of ? [] : want.points)}`,
      );
    }
    console.log(
      `  duplicata fundida: ${merged.length} -> ${merged.map((p) => `${p.id} => ${p.duplicateOf}`).join(", ") || "nenhuma"}`,
    );
    console.log(
      `  herdam:            ${inherited.length} -> ${inherited.map((p) => `${p.id}@${p.inheritedPoint}`).join(" ")}`,
    );
    console.log(`  precisa revisao:   ${r.needsReview}`);
    for (const p of r.pages.filter((x) => x.disputes.length)) {
      console.log(
        `     DISPUTA ${p.id}: ${p.disputes.map((d) => `y=${d.y} ${JSON.stringify(d.candidates)}`).join(" | ")}`,
      );
    }
    console.log(`  CRITERIO: ${ok ? "ATINGIDO" : "NAO ATINGIDO"}\n`);
  }
  return ok;
}

const files = calib.map((c) => c.file);
run("ordem alfabetica", [...files].sort());

let allOk = true;
for (let seed = 0; seed < 20; seed += 1) {
  const shuffled = [...files];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = (i * 7919 + seed * 104729 + 13) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  if (!run(`embaralhado ${seed}`, shuffled, false)) {
    allOk = false;
    console.log(`  embaralhado ${seed}: FALHOU`);
    run(`embaralhado ${seed} (detalhe)`, shuffled);
    break;
  }
}
console.log(
  `criterio em 20 ordens aleatorias: ${allOk ? "ATINGIDO em todas" : "falhou"}`,
);
