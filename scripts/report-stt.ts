/**
 * Reads what measure-stt.ts wrote and prints, per transcriber, the numbers the
 * choice will be made on. It chooses nothing: it reports, and Luiz reads.
 *
 * Reads the newest fixtures/stt/results/*.jsonl, or the file given.
 *
 * A line whose audio hash is not the recording on disk today belongs to a
 * take that has since been replaced, and is left out. A case with no
 * recording on disk keeps whatever lines it has.
 *
 *   node scripts/report-stt.ts
 *   node scripts/report-stt.ts --file fixtures/stt/results/2026-09-25.jsonl
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseCases, type SttCase } from "../src/lib/stt/cases.ts";
import { STT_MODELS } from "../src/lib/stt/provider.ts";
import { parseResults, type ResultLine } from "../src/lib/stt/results.ts";
import {
  errorPreserved,
  isEmptyTranscript,
  matchesSpoken,
} from "../src/lib/stt/score.ts";

const args = process.argv.slice(2);
function option(name: string): string | null {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return null;
  const value = args[at + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

const ROOT = join(import.meta.dirname, "..");
const AUDIO_DIR = join(ROOT, "fixtures", "stt");
const RESULTS_DIR = join(AUDIO_DIR, "results");

function newestResults(): string | null {
  if (!existsSync(RESULTS_DIR)) return null;
  const files = readdirSync(RESULTS_DIR)
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
  const last = files.at(-1);
  return last === undefined ? null : join(RESULTS_DIR, last);
}

const given = option("file");
const path = given === null ? newestResults() : resolve(given);
if (path === null || !existsSync(path)) {
  console.error(
    "Nenhum arquivo de resultados. Rode scripts/measure-stt.ts antes.",
  );
  process.exit(1);
}

const cases = parseCases(
  JSON.parse(readFileSync(join(ROOT, "scripts", "stt-cases.json"), "utf8")),
);
const caseById = new Map(cases.map((each) => [each.id, each]));

const currentHash = new Map<string, string>();
for (const each of cases) {
  const audio = join(AUDIO_DIR, `${each.id}.webm`);
  if (existsSync(audio)) {
    currentHash.set(
      each.id,
      createHash("sha256").update(readFileSync(audio)).digest("hex"),
    );
  }
}

const { lines: all, unreadable } = parseResults(readFileSync(path, "utf8"));
let stale = 0;

/*
 * One line per case, provider and round: the last answer if there is one,
 * otherwise the last failure. A retried call leaves both in the file.
 */
const chosen = new Map<string, ResultLine>();
for (const line of all) {
  const hash = currentHash.get(line.caseId);
  if (hash !== undefined && hash !== line.audioSha256) {
    stale++;
    continue;
  }
  const key = `${line.caseId}|${line.provider}|${line.round}`;
  const held = chosen.get(key);
  if (held === undefined || held.error !== null || line.error === null) {
    chosen.set(key, line);
  }
}

// ---------- helpers ----------

function percentile(sorted: readonly number[], p: number): number {
  // Nearest rank, so the answer is always a latency that actually happened.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function fmt(value: number | null, digits = 3): string {
  return value === null ? "·" : value.toFixed(digits);
}

function quote(text: string | null): string {
  return text === null ? "(erro)" : `"${text}"`;
}

function linesFor(provider: string, filter: (c: SttCase) => boolean) {
  const found: { each: SttCase; line: ResultLine }[] = [];
  for (const line of chosen.values()) {
    const each = caseById.get(line.caseId);
    if (line.provider === provider && each !== undefined && filter(each)) {
      found.push({ each, line });
    }
  }
  return found.sort(
    (a, b) => a.each.id.localeCompare(b.each.id) || a.line.round - b.line.round,
  );
}

function header(title: string): void {
  console.log(`\n  ${title}`);
}

// ---------- report ----------

console.log(`Arquivo: ${path}`);
console.log(
  `${chosen.size} chamada(s) consideradas, ${stale} de gravações substituídas ignoradas, ${unreadable} linha(s) ilegíveis.`,
);

for (const model of STT_MODELS) {
  const provider = model.id;
  const every = linesFor(provider, () => true);
  if (every.length === 0) {
    console.log(`\n=== ${model.label}: sem resultados`);
    continue;
  }
  const answered = every.filter(({ line }) => line.error === null);
  console.log(
    `\n=== ${model.label}  (${answered.length} respostas, ${every.length - answered.length} erros)`,
  );

  // Erro preservado.
  header("Erro preservado (contém errorSpan e não contém correctedSpan)");
  const errors = linesFor(provider, (c) => c.category === "grammar_error");
  let kept = 0;
  let judged = 0;
  for (const { each, line } of errors) {
    if (line.text === null) {
      console.log(`    ${each.id} #${line.round}  erro: ${line.error}`);
      continue;
    }
    // parseCases guarantees both on a grammar_error; this narrows the type.
    if (each.errorSpan === undefined || each.correctedSpan === undefined) {
      continue;
    }
    judged++;
    const ok = errorPreserved(line.text, each.errorSpan, each.correctedSpan);
    if (ok) kept++;
    console.log(
      `    ${ok ? "sim" : "NÃO"}  ${each.id} #${line.round}  ${quote(line.text)}   [${each.errorSpan} / ${each.correctedSpan}]`,
    );
  }
  console.log(`    preservado: ${kept}/${judged}`);

  // Acerto nos casos corretos.
  header("Acerto nos casos corretos (igual ao spoken, normalizado)");
  const correct = linesFor(provider, (c) => c.category === "correct");
  let right = 0;
  let judgedCorrect = 0;
  for (const { each, line } of correct) {
    if (line.text === null) continue;
    judgedCorrect++;
    if (matchesSpoken(line.text, each.spoken)) right++;
    else {
      console.log(
        `    NÃO ${each.id} #${line.round}  ${quote(line.text)}  esperado "${each.spoken}"`,
      );
    }
  }
  console.log(`    acerto: ${right}/${judgedCorrect}`);

  // Silêncio e ruído.
  header("Silêncio e ruído");
  for (const { each, line } of linesFor(
    provider,
    (c) => c.category === "silence_noise",
  )) {
    if (line.text === null) {
      console.log(`    ${each.id} #${line.round}  erro: ${line.error}`);
      continue;
    }
    const verdict =
      each.spoken === ""
        ? isEmptyTranscript(line.text)
          ? "vazio (certo)"
          : "INVENTOU texto"
        : matchesSpoken(line.text, each.spoken)
          ? "igual ao spoken"
          : "DIFERENTE do spoken";
    console.log(
      `    ${each.id} #${line.round}  ${verdict}  ${quote(line.text)}`,
    );
  }

  // Leitura lado a lado, sem nota.
  header("Pronúncia, hesitação e português (para ler, sem nota)");
  for (const { each, line } of linesFor(provider, (c) =>
    ["pronunciation", "hesitation", "mixed_portuguese"].includes(c.category),
  )) {
    console.log(`    ${each.id} #${line.round}  falado:  "${each.spoken}"`);
    console.log(
      `    ${" ".repeat(each.id.length)}     ouvido:  ${quote(line.text)}`,
    );
  }

  // Confiança.
  header("Confiança (média por categoria · média da menor palavra/token)");
  const withConfidence = answered.filter(
    ({ line }) => line.confidence !== null,
  );
  if (withConfidence.length === 0) {
    console.log("    não veio confiança deste fornecedor");
  } else {
    console.log(
      `    veio em ${withConfidence.length}/${answered.length} respostas`,
    );
    const groups: [string, (c: SttCase) => boolean][] = [
      ["correto", (c) => c.category === "correct"],
      ["erro gramatical", (c) => c.category === "grammar_error"],
      ["pronúncia", (c) => c.category === "pronunciation"],
      ["hesitação", (c) => c.category === "hesitation"],
      ["português", (c) => c.category === "mixed_portuguese"],
      ["silêncio e ruído", (c) => c.category === "silence_noise"],
    ];
    for (const [label, filter] of groups) {
      const group = withConfidence.filter(({ each }) => filter(each));
      const overall = mean(
        group
          .map(({ line }) => line.confidence)
          .filter((value): value is number => value !== null),
      );
      const lowest = mean(
        group
          .map(({ line }) =>
            line.pieces === null || line.pieces.length === 0
              ? null
              : Math.min(...line.pieces.map((piece) => piece.confidence)),
          )
          .filter((value): value is number => value !== null),
      );
      console.log(
        `    ${label.padEnd(18)} ${fmt(overall)}  ·  ${fmt(lowest)}   (n=${group.length})`,
      );
    }
  }

  // Latência.
  header("Latência (ms)");
  const times = answered
    .map(({ line }) => line.ms)
    .filter((ms): ms is number => ms !== null)
    .sort((a, b) => a - b);
  if (times.length > 0) {
    console.log(
      `    mediana ${percentile(times, 50)}  ·  p90 ${percentile(times, 90)}  ·  pior ${times.at(-1)}   (n=${times.length})`,
    );
  }

  // Custo.
  header("Custo estimado pela duração do áudio");
  const seconds = answered
    .map(({ line }) => line.audioSeconds)
    .filter((s): s is number => s !== null);
  const totalMinutes = seconds.reduce((a, b) => a + b, 0) / 60;
  const averageSeconds = mean(seconds);
  console.log(
    `    US$ ${model.usdPerMinute}/min  ·  ${totalMinutes.toFixed(2)} min enviados  ·  US$ ${(totalMinutes * model.usdPerMinute).toFixed(4)} nesta medição`,
  );
  if (averageSeconds !== null) {
    console.log(
      `    resposta média de ${averageSeconds.toFixed(1)} s  ·  US$ ${((averageSeconds / 60) * model.usdPerMinute * 1000).toFixed(2)} por mil respostas`,
    );
  }
  if (seconds.length < answered.length) {
    console.log(
      `    ${answered.length - seconds.length} resposta(s) sem duração registrada, fora da conta`,
    );
  }
}
