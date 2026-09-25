/**
 * Reads what measure-judge.ts wrote and prints, per judge, the numbers the
 * choice will be made on. It chooses nothing.
 *
 * Reads the newest fixtures/stt/judge-results/*.jsonl, or the file given.
 * A line for a recording that has since been replaced is left out, and so is
 * a line judged under another prompt: by default the current one, or the one
 * given with --prompt ("legacy" for lines written before prompts were
 * fingerprinted).
 *
 *   node scripts/report-judge.ts
 *   node scripts/report-judge.ts --file fixtures/stt/judge-results/2026-09-25.jsonl
 *   node scripts/report-judge.ts --prompt legacy
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
import { promptFingerprint } from "../src/lib/judge/prompt.ts";
import {
  LEGACY_PROMPT,
  parseJudgeLines,
  type JudgeLine,
} from "../src/lib/judge/results.ts";
import {
  differencesPointAtError,
  recountedVerdict,
  type Verdict,
  substantiveDifferences,
} from "../src/lib/judge/score.ts";
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
const prompt = option("prompt") ?? promptFingerprint();
let stale = 0;
let otherPrompt = 0;
const chosen = new Map<string, JudgeLine>();
for (const line of all) {
  const hash = currentHash.get(line.caseId);
  if (hash !== undefined && hash !== line.audioSha256) {
    stale++;
    continue;
  }
  if ((line.prompt ?? LEGACY_PROMPT) !== prompt) {
    otherPrompt++;
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
console.log(`Prompt: ${prompt}`);
console.log(
  `${chosen.size} chamada(s) consideradas, ${stale} de gravações substituídas ignoradas, ${otherPrompt} de outro prompt ignoradas, ${unreadable} linha(s) ilegíveis.`,
);
console.log(
  'Veredito recontado: bate (inglês, nenhuma diferença substantiva) · não bate (sobra diferença substantiva) · incerto (diz que não bate sem nomear nada substantivo, ou campos contraditórios; no tutor vira "Again, please").',
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

  const VERDICT_LABEL: Record<Verdict, string> = {
    match: "bate",
    mismatch: "não bate",
    uncertain: "incerto",
  };
  const verdictOf = (judgement: Judgement) =>
    VERDICT_LABEL[recountedVerdict(judgement)];
  const substantiveText = (judgement: Judgement) => {
    const real = substantiveDifferences(judgement.differences);
    return real.length === 0
      ? "nada substantivo"
      : real.map(describeDifference).join("; ");
  };

  // Aceitou errado.
  header("Aceitou errado (caso de erro, recontado bate) · incerto à parte");
  const errorCases = answered(
    linesFor(provider, (c) => c.category === "grammar_error"),
  );
  let acceptedWrong = 0;
  let errorUncertain = 0;
  let acceptedByModel = 0;
  for (const { each, line, judgement } of errorCases) {
    const verdict = recountedVerdict(judgement);
    if (judgement.matches) acceptedByModel++;
    if (verdict === "mismatch") continue;
    if (verdict === "match") acceptedWrong++;
    else errorUncertain++;
    console.log(
      `    ${verdict === "match" ? "ACEITOU" : "INCERTO"} ${tag(each, line)}  ouviu "${judgement.heard}"  ·  ${substantiveText(judgement)}`,
    );
  }
  console.log(
    `    aceitou errado: ${acceptedWrong}/${errorCases.length}  ·  incerto: ${errorUncertain}/${errorCases.length}  ·  (o modelo disse que bate: ${acceptedByModel})`,
  );

  // Recusou certo.
  header(
    "Recusou certo (corretos e pronúncia, recontado não bate) · incerto à parte",
  );
  const rightCases = answered(
    linesFor(
      provider,
      (c) => c.category === "correct" || c.category === "pronunciation",
    ),
  );
  let refusedRight = 0;
  let rightUncertain = 0;
  let refusedByModel = 0;
  for (const { each, line, judgement } of rightCases) {
    const verdict = recountedVerdict(judgement);
    if (!judgement.matches) refusedByModel++;
    if (verdict === "match") continue;
    if (verdict === "mismatch") refusedRight++;
    else rightUncertain++;
    console.log(
      `    ${verdict === "mismatch" ? "RECUSOU" : "INCERTO"} ${tag(each, line)}  ouviu "${judgement.heard}"  ·  ${substantiveText(judgement)}`,
    );
  }
  console.log(
    `    recusou certo: ${refusedRight}/${rightCases.length}  ·  incerto: ${rightUncertain}/${rightCases.length}  ·  (o modelo disse que não bate: ${refusedByModel})`,
  );

  // Diferenças nos casos de erro.
  header(
    "Diferenças nos casos de erro, só as substantivas (apontou o errorSpan · só ele)",
  );
  let pointedCount = 0;
  let onlyCount = 0;
  for (const { each, line, judgement } of errorCases) {
    if (each.errorSpan === undefined || each.correctedSpan === undefined)
      continue;
    const real = substantiveDifferences(judgement.differences);
    const { pointed, onlyError } = differencesPointAtError(
      real,
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
      `    ${mark.padEnd(13)} ${tag(each, line)}  [${each.errorSpan} / ${each.correctedSpan}]  ${real.length === 0 ? "(nenhuma)" : real.map(describeDifference).join("; ")}`,
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
      `    ${right ? "detectou" : "NÃO detectou"}  ${tag(each, line)}  motivo ${judgement.noEnglishReason ?? "·"}  veredito ${verdictOf(judgement)}  ouviu "${judgement.heard}"`,
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
      `    ${tag(each, line)}  veredito ${verdictOf(judgement)}  inglês=${judgement.englishSpeech ? "sim" : "não"}  ouviu "${judgement.heard}"  ·  ${describeDifferences(judgement)}`,
    );
  }

  // Hesitação, para ler.
  header("Hesitação (para ler, sem nota)");
  for (const { each, line, judgement } of answered(
    linesFor(provider, (c) => c.category === "hesitation"),
  )) {
    console.log(`    ${tag(each, line)}  esperado "${each.expected}"`);
    console.log(
      `    ${" ".repeat(tag(each, line).length)}  ouviu "${judgement.heard}"  veredito ${verdictOf(judgement)}  ·  ${describeDifferences(judgement)}`,
    );
  }

  // Incerto no total.
  header('Incerto no total (vira "Again, please" no tutor)');
  const uncertain = ok.filter(
    ({ line }) =>
      line.judgement !== null &&
      recountedVerdict(line.judgement) === "uncertain",
  );
  console.log(
    `    ${uncertain.length}/${ok.length}: ${uncertain.map(({ each, line }) => tag(each, line)).join(", ") || "nenhum"}`,
  );

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
