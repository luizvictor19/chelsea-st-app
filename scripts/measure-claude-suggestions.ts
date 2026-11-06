/**
 * Whether Claude Haiku 5.5 serves the three content suggestions it took over
 * from DeepSeek in phase 1 of #225, against what Luiz already decided by
 * hand. Haiku only, by Luiz's decision on 2026-11-06 ("não quero usar
 * sonnet, só haiku"): the question is not which model wins but whether this
 * one is good enough, and where it is not, the next step is the prompt.
 *
 * It asks exactly what the screen asks: the same prompt builders, the same
 * model constant and schema, the same batch of ten and the same book order.
 * It writes nothing to the database and nothing on a screen changes.
 *
 * Inputs, under fixtures/ (out of git), read through the read-only Supabase
 * MCP on 2026-11-06, with the date inside each file:
 * - suggestions-gold.tsv: the 159 words of book 1 lessons 1 to 4, with the
 *   kind and class Luiz decided, the contrast sets and the pictures;
 * - subject-gold.tsv: 10 words with the instruction Luiz kept.
 *
 * Every call is appended to fixtures/claude-suggestions.jsonl as it returns,
 * with the prompt, the answer, the usage and its cost. --report reads that
 * file and spends nothing.
 *
 *   node scripts/measure-claude-suggestions.ts --task type --dry
 *   node --env-file=.env.local scripts/measure-claude-suggestions.ts --task type --label first
 *   node --env-file=.env.local scripts/measure-claude-suggestions.ts --task contrast --label first
 *   node --env-file=.env.local scripts/measure-claude-suggestions.ts --task subject --label first
 *   node scripts/measure-claude-suggestions.ts --report <batch>
 *
 * --budget 0.25 (US$) is a hard stop before each call.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { compareWords } from "../src/lib/content/word-order.ts";
import {
  CONTRAST_MODEL,
  CONTRAST_SCHEMA,
  buildContrastPrompt,
  contrastCandidates,
  parseContrastSuggestions,
  type CandidateWord,
} from "../src/lib/images/contrast-suggest.ts";
import {
  SUBJECT_MODEL,
  SUBJECT_SCHEMA,
  buildSubjectPrompt,
  parseSubject,
} from "../src/lib/images/subject.ts";
import type { ImageStyle } from "../src/lib/images/style.ts";
import {
  SUGGESTION_BATCH,
  SUGGESTION_MODEL,
  SUGGESTION_SCHEMA,
  buildSuggestionPrompt,
  parseSuggestions,
  suggestionBatch,
} from "../src/lib/images/suggest.ts";
import type { Database } from "../src/lib/supabase/types.ts";
import {
  ClaudeStopError,
  createClaudeProvider,
} from "../src/lib/text/claude.ts";
import { usdFor } from "../src/lib/text/cost.ts";
import type { TextUsage } from "../src/lib/text/provider.ts";

type Representation = Database["public"]["Enums"]["representation_kind"];

const args = process.argv.slice(2);
function option(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const value = args[at + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}
const flag = (name: string): boolean => args.includes(`--${name}`);

const ROOT = join(import.meta.dirname, "..");
const GOLD = join(ROOT, "fixtures/suggestions-gold.tsv");
const SUBJECT_GOLD = join(ROOT, "fixtures/subject-gold.tsv");
const OUT = join(ROOT, "fixtures/claude-suggestions.jsonl");

type Task = "type" | "contrast" | "subject";

type Word = {
  readonly lesson: number;
  readonly point: number;
  readonly id: string;
  readonly term: string;
  readonly kind: Representation;
  readonly wordClass: string;
  readonly set: string | null;
  readonly pos: number | null;
};

function rows(path: string): string[][] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((text) => text.trim() !== "" && !text.startsWith("#"))
    .map((text) => text.split("\t"));
}

function goldWords(): Word[] {
  const words = rows(GOLD).map(
    ([lesson, point, id, term, kind, wordClass, set, pos]): Word => ({
      lesson: Number(lesson),
      point: Number(point),
      id: id ?? "",
      term: term ?? "",
      kind: kind as Representation,
      wordClass: wordClass ?? "",
      set: set === undefined || set === "" ? null : set,
      pos: pos === undefined || pos === "" ? null : Number(pos),
    }),
  );
  if (words.length !== 159) {
    throw new Error(`The gold has ${words.length} words, not 159`);
  }
  return words;
}

/** A lesson's words in the order lessonWords gives the screen. */
function lessonOrder(words: readonly Word[], lesson: number): Word[] {
  return words
    .filter((word) => word.lesson === lesson)
    .sort((a, b) =>
      compareWords(
        { lessonNumber: null, pointNumber: a.point, term: a.term },
        { lessonNumber: null, pointNumber: b.point, term: b.term },
      ),
    );
}

type Call = {
  readonly unit: string;
  readonly model: string;
  readonly schema: Record<string, unknown>;
  readonly prompt: { system: string; user: string };
};

function calls(task: Task): Call[] {
  if (task === "subject") {
    return rows(SUBJECT_GOLD).map(([term, kind, style]) => ({
      unit: term ?? "",
      model: SUBJECT_MODEL,
      schema: SUBJECT_SCHEMA,
      prompt: buildSubjectPrompt(term ?? "", kind ?? "", style as ImageStyle),
    }));
  }
  const words = goldWords();
  const out: Call[] = [];
  for (const lesson of [1, 2, 3, 4]) {
    const all = lessonOrder(words, lesson);
    if (task === "type") {
      for (let offset = 0; offset < all.length; offset += SUGGESTION_BATCH) {
        out.push({
          unit: `${lesson}:${offset}`,
          model: SUGGESTION_MODEL,
          schema: SUGGESTION_SCHEMA,
          prompt: buildSuggestionPrompt(suggestionBatch(all, offset)),
        });
      }
    } else {
      // As if no set existed yet, so every gold set is there to be found.
      const sent = contrastCandidates(asCandidates(all), new Set());
      out.push({
        unit: String(lesson),
        model: CONTRAST_MODEL,
        schema: CONTRAST_SCHEMA,
        prompt: buildContrastPrompt(
          { lesson, point: null, words: sent },
          "lesson",
        ),
      });
    }
  }
  return out;
}

function asCandidates(words: readonly Word[]): CandidateWord[] {
  return words.map((word) => ({
    id: word.id,
    term: word.term,
    point: word.point,
    kind: word.kind,
    wordClass: word.wordClass,
  }));
}

type Line = {
  readonly batch: string;
  readonly task: Task;
  readonly unit: string;
  readonly at: string;
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly text: string | null;
  readonly usage: TextUsage | null;
  readonly usd: number | null;
  readonly ms: number;
  readonly error: string | null;
};

async function run(task: Task): Promise<void> {
  const planned = calls(task);
  if (flag("dry")) {
    for (const call of planned) {
      console.log(`\n===== ${task} ${call.unit}\n${call.prompt.user}`);
    }
    console.log(`\n${planned.length} calls, ${planned[0]?.model}`);
    return;
  }
  const label = option("label", "");
  if (label === "") throw new Error("--label is required for a run");
  const budget = Number(option("budget", "0.25"));
  const batch = `${task}-${label}@${new Date().toISOString()}`;
  let spent = 0;
  for (const call of planned) {
    if (spent >= budget) {
      console.log(`Stopped at the budget: US$ ${spent.toFixed(4)}`);
      break;
    }
    const started = performance.now();
    let text: string | null = null;
    let usage: TextUsage | null = null;
    let error: string | null = null;
    try {
      const answer = await createClaudeProvider(
        call.model,
        call.schema,
      ).complete({
        ...call.prompt,
        json: true,
      });
      text = answer.text;
      usage = answer.usage;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof ClaudeStopError) usage = cause.usage;
    }
    const usd = usage === null ? null : usdFor(call.model, usage);
    const line: Line = {
      batch,
      task,
      unit: call.unit,
      at: new Date().toISOString(),
      model: call.model,
      ...call.prompt,
      text,
      usage,
      usd,
      ms: Math.round(performance.now() - started),
      error,
    };
    appendFileSync(OUT, `${JSON.stringify(line)}\n`);
    spent += usd ?? 0;
    console.log(
      `${task} ${call.unit}: ${error ?? "ok"} · ${line.ms} ms · US$ ${(usd ?? 0).toFixed(5)}`,
    );
  }
  console.log(`Batch ${batch} · US$ ${spent.toFixed(4)}`);
}

const pct = (part: number, whole: number): string =>
  whole === 0 ? "·" : `${((100 * part) / whole).toFixed(1)}%`;

function timing(lines: readonly Line[]): string {
  const ms = lines.map((l) => l.ms).sort((a, b) => a - b);
  const usd = lines.reduce((sum, l) => sum + (l.usd ?? 0), 0);
  const errors = lines.filter((l) => l.error !== null).length;
  return `${lines.length} chamadas, ${errors} com erro · mediana ${ms[Math.floor((ms.length - 1) / 2)] ?? 0} ms, pior ${ms.at(-1) ?? 0} ms · US$ ${usd.toFixed(5)}`;
}

function reportType(lines: readonly Line[]): void {
  const byId = new Map(goldWords().map((w) => [w.id, w]));
  let answered = 0;
  let kindRight = 0;
  let classRight = 0;
  let rejected = 0;
  const wrong: string[] = [];
  for (const line of lines) {
    if (line.text === null) continue;
    const sent = [...line.user.matchAll(/^([0-9a-f-]{36})\t/gmu)].map(
      (m) => m[1] ?? "",
    );
    const parsed = parseSuggestions(line.text, sent);
    rejected +=
      parsed.rejected +
      (sent.length - parsed.suggestions.length - parsed.rejected);
    for (const s of parsed.suggestions) {
      const gold = byId.get(s.id);
      if (gold === undefined) continue;
      answered += 1;
      const kindOk = s.kind === gold.kind;
      const classOk = s.wordClass === gold.wordClass;
      if (kindOk) kindRight += 1;
      if (classOk) classRight += 1;
      if (!kindOk || !classOk) {
        wrong.push(
          `| ${gold.lesson} | ${gold.term} | ${kindOk ? gold.kind : `**${s.kind}** (decidi ${gold.kind})`} | ${classOk ? gold.wordClass : `**${s.wordClass ?? "nenhuma"}** (decidi ${gold.wordClass})`} |`,
        );
      }
    }
  }
  console.log(`\n## Tipo e classe · 159 palavras\n`);
  console.log(
    `respondidas ${answered} · sem resposta ou recusadas ${rejected}`,
  );
  console.log(
    `tipo certo ${kindRight}/159 (${pct(kindRight, 159)}) · classe certa ${classRight}/159 (${pct(classRight, 159)})`,
  );
  console.log(timing(lines));
  console.log(
    `custo por 100 palavras: US$ ${((100 * lines.reduce((s, l) => s + (l.usd ?? 0), 0)) / 159).toFixed(5)}`,
  );
  console.log(
    `\n| lição | palavra | tipo | classe |\n|---|---|---|---|\n${wrong.join("\n")}`,
  );
}

function pairs(sets: readonly (readonly string[])[]): Set<string> {
  const result = new Set<string>();
  for (const set of sets) {
    for (let i = 0; i < set.length; i++) {
      for (let j = i + 1; j < set.length; j++) {
        result.add([set[i], set[j]].sort().join("|"));
      }
    }
  }
  return result;
}

function reportContrast(lines: readonly Line[]): void {
  const words = goldWords();
  const term = new Map(words.map((w) => [w.id, w.term]));
  let right = 0;
  let suggested = 0;
  let goldTotal = 0;
  console.log(`\n## Conjuntos de contraste · lições 1 a 4\n`);
  for (const line of lines) {
    if (line.text === null) {
      console.log(`lição ${line.unit}: ${line.error}`);
      continue;
    }
    const lesson = Number(line.unit);
    const all = lessonOrder(words, lesson);
    const sent = contrastCandidates(asCandidates(all), new Set());
    const parsed = parseContrastSuggestions(line.text, sent);
    const bySet = new Map<string, Word[]>();
    for (const w of all) {
      if (w.set !== null) bySet.set(w.set, [...(bySet.get(w.set) ?? []), w]);
    }
    const gold = [...bySet.values()].map((set) =>
      [...set].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)).map((w) => w.id),
    );
    const g = pairs(gold);
    const s = pairs(parsed.sets.map((set) => set.members));
    const ok = [...s].filter((p) => g.has(p)).length;
    right += ok;
    suggested += s.size;
    goldTotal += g.size;
    const show = (ids: readonly string[]) =>
      ids.map((id) => term.get(id) ?? id).join("/");
    const goldKeys = new Set(gold.map((set) => [...set].sort().join("|")));
    const propKeys = new Set(
      parsed.sets.map((set) => [...set.members].sort().join("|")),
    );
    console.log(
      `lição ${lesson}: pares ${ok}/${s.size} propostos certos, ${ok}/${g.size} meus achados`,
    );
    console.log(
      `  iguais aos meus: ${
        gold
          .filter((set) => propKeys.has([...set].sort().join("|")))
          .map(show)
          .join("; ") || "nenhum"
      }`,
    );
    console.log(
      `  meus que faltaram ou mudaram: ${
        gold
          .filter((set) => !propKeys.has([...set].sort().join("|")))
          .map(show)
          .join("; ") || "nenhum"
      }`,
    );
    console.log(
      `  propostos que não são meus: ${
        parsed.sets
          .filter((set) => !goldKeys.has([...set.members].sort().join("|")))
          .map((set) => show(set.members))
          .join("; ") || "nenhum"
      }`,
    );
  }
  console.log(
    `\npor par: precisão ${pct(right, suggested)}, recall ${pct(right, goldTotal)} (DeepSeek em 22/09, lições 1 e 2: 90% e 98%)`,
  );
  console.log(timing(lines));
}

function reportSubject(lines: readonly Line[]): void {
  const approved = new Map(
    rows(SUBJECT_GOLD).map(([term, kind, style, text]) => [
      term,
      { kind, style, text },
    ]),
  );
  console.log(`\n## Instrução da palavra · 10 palavras\n`);
  console.log(
    `| palavra | tipo · estilo | Haiku | a que eu aprovei |\n|---|---|---|---|`,
  );
  for (const line of lines) {
    const gold = approved.get(line.unit);
    const proposal =
      line.text === null
        ? `ERRO: ${line.error}`
        : (parseSubject(line.text) ?? "ilegível");
    console.log(
      `| ${line.unit} | ${gold?.kind} · ${gold?.style} | ${proposal} | ${gold?.text} |`,
    );
  }
  console.log(`\n${timing(lines)}`);
}

function report(batch: string): void {
  const lines = readFileSync(OUT, "utf8")
    .split("\n")
    .filter((text) => text.trim() !== "")
    .map((text) => JSON.parse(text) as Line)
    .filter((line) => line.batch === batch);
  if (lines.length === 0) throw new Error(`No calls in batch ${batch}`);
  const task = lines[0]?.task;
  if (task === "type") reportType(lines);
  else if (task === "contrast") reportContrast(lines);
  else reportSubject(lines);
}

const reportBatch = option("report", "");
if (reportBatch !== "") {
  report(reportBatch);
} else {
  const task = option("task", "");
  if (task !== "type" && task !== "contrast" && task !== "subject") {
    throw new Error("--task type|contrast|subject");
  }
  await run(task);
}
