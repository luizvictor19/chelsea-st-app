/**
 * Reads what measure-judge.ts wrote and prints, per judge, the numbers the
 * choice will be made on. It chooses nothing.
 *
 * Reads the newest fixtures/stt/judge-results/*.jsonl, or the file given.
 * A line for a recording that has since been replaced is left out.
 *
 *   node scripts/report-judge.ts
 *   node scripts/report-judge.ts --file fixtures/stt/judge-results/2026-09-25.jsonl
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { contradiction, malformedDifference } from "../src/lib/judge/parse.ts";
import {
  JUDGE_MODELS,
  type Difference,
  type Judgement,
} from "../src/lib/judge/provider.ts";
import { parseJudgeLines, type JudgeLine } from "../src/lib/judge/results.ts";
import { differencesPointAtError } from "../src/lib/judge/score.ts";
import { parseCases, type SttCase } from "../src/lib/stt/cases.ts";
import { errorPreserved, matchesSpoken } from "../src/lib/stt/score.ts";

const args = process.argv.slice(2);
function option(name: string): string | null {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return null;
  const value = args[at + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

const ROOT = join(import.meta.dirname, "..");
const AUDIO_DIR = join(ROOT, "fixtures", "stt");
const RESULTS_DIR = join(AUDIO_DIR, "judge-results");

function newestResults(): string | null {
  if (!existsSync(RESULTS_DIR)) return null;
  const last = readdirSync(RESULTS_DIR)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .at(-1);
  return last === undefined ? null : join(RESULTS_DIR, last);
}

const given = option("file");
const path = given === null ? newestResults() : resolve(given);
if (path === null || !existsSync(path)) {
  console.error(
    "Nenhum arquivo de resultados. Rode scripts/measure-judge.ts antes.",
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

const { lines: all, unreadable } = parseJudgeLines(readFileSync(path, "utf8"));
let stale = 0;
const chosen = new Map<string, JudgeLine>();
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
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

function describeDifference(d: Difference): string {
  if (d.kind === "missing") return `faltou "${d.expected}"`;
  if (d.kind === "extra") return `sobrou "${d.said}"`;
  return `trocou "${d.expected}" por "${d.said}"`;
}

function describeDifferences(judgement: Judgement): string {
  return judgement.differences.length === 0
    ? "(nenhuma)"
    : judgement.differences.map(describeDifference).join("; ");
}

type Answered = { each: SttCase; line: JudgeLine; judgement: Judgement };

function linesFor(provider: string, filter: (c: SttCase) => boolean) {
  const found: { each: SttCase; line: JudgeLine }[] = [];
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

function answered(list: { each: SttCase; line: JudgeLine }[]): Answered[] {
  const out: Answered[] = [];
  for (const { each, line } of list) {
    if (line.judgement === null) {
      console.log(`    ${each.id} #${line.round}  erro: ${line.error}`);
    } else {
      out.push({ each, line, judgement: line.judgement });
    }
  }
  return out;
}

function tag(each: SttCase, line: JudgeLine): string {
  return `${each.id} #${line.round}`;
}

function header(title: string): void {
  console.log(`\n  ${title}`);
}

// ---------- report ----------

console.log(`Arquivo: ${path}`);
console.log(
  `${chosen.size} chamada(s) consideradas, ${stale} de gravações substituídas ignoradas, ${unreadable} linha(s) ilegíveis.`,
);

for (const model of JUDGE_MODELS) {
  const provider = model.id;
  const every = linesFor(provider, () => true);
  if (every.length === 0) {
    console.log(`\n=== ${model.label}: sem resultados`);
    continue;
  }
  const ok = every.filter(({ line }) => line.judgement !== null);
  console.log(
    `\n=== ${model.label}  (${ok.length} respostas, ${every.length - ok.length} erros)`,
  );

  // Aceitou errado.
  header("Aceitou errado (caso de erro, disse que bate)");
  const errorCases = answered(
    linesFor(provider, (c) => c.category === "grammar_error"),
  );
  let acceptedWrong = 0;
  for (const { each, line, judgement } of errorCases) {
    if (!judgement.matches) continue;
    acceptedWrong++;
    console.log(`    ACEITOU ${tag(each, line)}  ouviu "${judgement.heard}"`);
  }
  console.log(`    aceitou errado: ${acceptedWrong}/${errorCases.length}`);

  // Recusou certo.
  header("Recusou certo (corretos e pronúncia, disse que não bate)");
  const rightCases = answered(
    linesFor(
      provider,
      (c) => c.category === "correct" || c.category === "pronunciation",
    ),
  );
  let refusedRight = 0;
  for (const { each, line, judgement } of rightCases) {
    if (judgement.matches) continue;
    refusedRight++;
    console.log(
      `    RECUSOU ${tag(each, line)}  ouviu "${judgement.heard}"  ·  ${describeDifferences(judgement)}`,
    );
  }
  console.log(`    recusou certo: ${refusedRight}/${rightCases.length}`);

  // Diferenças nos casos de erro.
  header("Diferenças nos casos de erro (apontou o errorSpan · só ele)");
  let pointedCount = 0;
  let onlyCount = 0;
  for (const { each, line, judgement } of errorCases) {
    if (each.errorSpan === undefined || each.correctedSpan === undefined)
      continue;
    const { pointed, onlyError } = differencesPointAtError(
      judgement.differences,
      each.errorSpan,
      each.correctedSpan,
    );
    if (pointed) pointedCount++;
    if (onlyError) onlyCount++;
    const mark = onlyError
      ? "só o erro"
      : pointed
        ? "erro + outras"
        : "NÃO apontou";
    console.log(
      `    ${mark.padEnd(13)} ${tag(each, line)}  [${each.errorSpan} / ${each.correctedSpan}]  ${describeDifferences(judgement)}`,
    );
  }
  console.log(
    `    apontou o erro: ${pointedCount}/${errorCases.length}  ·  só o erro: ${onlyCount}/${errorCases.length}`,
  );

  // O que ouviu, pela régua da medição anterior.
  header(
    "O campo heard, pela régua da transcrição (erro preservado · igual ao spoken)",
  );
  const heardKept = errorCases.filter(
    ({ each, judgement }) =>
      each.errorSpan !== undefined &&
      each.correctedSpan !== undefined &&
      errorPreserved(judgement.heard, each.errorSpan, each.correctedSpan),
  ).length;
  const heardExact = rightCases.filter(({ each, judgement }) =>
    matchesSpoken(judgement.heard, each.spoken),
  ).length;
  console.log(
    `    heard preserva o erro: ${heardKept}/${errorCases.length}  ·  heard igual ao spoken nos corretos e pronúncia: ${heardExact}/${rightCases.length}`,
  );
  for (const { each, line, judgement } of errorCases) {
    console.log(
      `    ${tag(each, line)}  falado "${each.spoken}"  ·  ouviu "${judgement.heard}"`,
    );
  }

  // Silêncio, ruído e português.
  header("Silêncio, ruído e português");
  const noEnglish = answered(linesFor(provider, (c) => c.expected === null));
  let detected = 0;
  for (const { each, line, judgement } of noEnglish) {
    const right = !judgement.englishSpeech;
    if (right) detected++;
    console.log(
      `    ${right ? "detectou" : "NÃO detectou"}  ${tag(each, line)}  motivo ${judgement.noEnglishReason ?? "·"}  ouviu "${judgement.heard}"`,
    );
  }
  console.log(`    detectou sem inglês: ${detected}/${noEnglish.length}`);
  console.log(
    "    com resposta em inglês esperada (s03 sob ruído, m01 depois de português):",
  );
  for (const { each, line, judgement } of answered(
    linesFor(
      provider,
      (c) =>
        c.expected !== null &&
        (c.category === "silence_noise" || c.category === "mixed_portuguese"),
    ),
  )) {
    console.log(
      `    ${tag(each, line)}  bate=${judgement.matches ? "sim" : "não"}  inglês=${judgement.englishSpeech ? "sim" : "não"}  ouviu "${judgement.heard}"  ·  ${describeDifferences(judgement)}`,
    );
  }

  // Hesitação, para ler.
  header("Hesitação (para ler, sem nota)");
  for (const { each, line, judgement } of answered(
    linesFor(provider, (c) => c.category === "hesitation"),
  )) {
    console.log(`    ${tag(each, line)}  esperado "${each.expected}"`);
    console.log(
      `    ${" ".repeat(tag(each, line).length)}  ouviu "${judgement.heard}"  bate=${judgement.matches ? "sim" : "não"}  ·  ${describeDifferences(judgement)}`,
    );
  }

  // Contradições.
  header("Contradições na própria resposta");
  let contradictions = 0;
  for (const { each, line } of ok) {
    if (line.judgement === null) continue;
    const found = contradiction(line.judgement);
    if (found === null) continue;
    contradictions++;
    console.log(`    ${tag(each, line)}  ${found}`);
  }
  console.log(`    ${contradictions}/${ok.length}`);

  // Diferenças mal formadas.
  header("Diferenças mal formadas (guardadas como vieram)");
  let malformed = 0;
  let withMalformed = 0;
  for (const { each, line } of ok) {
    if (line.judgement === null) continue;
    const bad = line.judgement.differences
      .map((d) => ({ d, why: malformedDifference(d) }))
      .filter(({ why }) => why !== null);
    if (bad.length === 0) continue;
    malformed += bad.length;
    withMalformed++;
    console.log(
      `    ${tag(each, line)}  ${bad.map(({ d, why }) => `${d.kind} "${d.expected}"/"${d.said}" (${why})`).join("; ")}`,
    );
  }
  console.log(
    `    ${malformed} diferença(s) mal formadas em ${withMalformed}/${ok.length} respostas`,
  );

  // Latência.
  header("Latência (ms)");
  const times = ok
    .map(({ line }) => line.ms)
    .filter((ms): ms is number => ms !== null)
    .sort((a, b) => a - b);
  if (times.length > 0) {
    console.log(
      `    mediana ${percentile(times, 50)}  ·  p90 ${percentile(times, 90)}  ·  pior ${times.at(-1)}   (n=${times.length})`,
    );
  }

  // Custo.
  header("Custo pelos tokens devolvidos");
  const prices = model.usdPerMillion;
  const costs = ok
    .map(({ line }) => line.usage)
    .filter((usage) => usage !== null)
    .map(
      (usage) =>
        (usage.audioInputTokens * prices.audioInput +
          usage.textInputTokens * prices.textInput +
          usage.outputTokens * prices.output) /
        1_000_000,
    );
  if (costs.length > 0) {
    const total = costs.reduce((a, b) => a + b, 0);
    console.log(
      `    US$ ${total.toFixed(4)} nesta medição  ·  US$ ${((total / costs.length) * 1000).toFixed(2)} por mil respostas   (n=${costs.length})`,
    );
    console.log(
      `    por milhão: áudio US$ ${prices.audioInput}, texto US$ ${prices.textInput}, saída US$ ${prices.output}`,
    );
  }
  if (costs.length < ok.length) {
    console.log(
      `    ${ok.length - costs.length} resposta(s) sem uso de tokens, fora da conta`,
    );
  }
}
