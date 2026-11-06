/**
 * What Claude models draft as questions and expected answers for a point of
 * book 1 (#83), for #67 to choose a model and a prompt on numbers. Writes
 * nothing to the database; nothing on a screen changes.
 *
 * The quick form Luiz approved on 2026-11-06: 2 points, Haiku 5.5 and
 * Sonnet 5.5, 1 pass, about 24 drafts read together in the conversation.
 * The prompt is src/lib/questions/suggest-questions.ts, which #67 imports.
 *
 * Inputs: fixtures/questions/suggest-inputs.json, a snapshot of what the
 * database holds for points 1 to 7, read through the MCP with its date
 * inside. Every call is appended to fixtures/questions/suggestions.jsonl the
 * moment it returns, with the prompt, the answer, the usage and its cost.
 *
 *   node scripts/measure-question-suggestions.ts --dry
 *   node --env-file=.env.local scripts/measure-question-suggestions.ts --label quick
 *   node scripts/measure-question-suggestions.ts --report <batch>
 *   node scripts/measure-question-suggestions.ts --report <batch> --unblind
 *
 * Run flags: --label (required), --points 5,7, --models haiku,sonnet,
 * --budget 0.5 (US$, a hard stop before each call). --report prints the
 * drafts blind, grouped by point and shuffled inside it, with the
 * vocabulary validator's marks; --unblind adds which model wrote each and
 * the numbers per model. Neither reads a key nor spends anything.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createChecker, type Mark } from "../src/lib/questions/presented.ts";
import {
  SUGGEST_QUESTIONS_SCHEMA,
  buildSuggestQuestionsPrompt,
  parseDrafts,
  resolveImage,
  type DraftQuestion,
  type SuggestScene,
  type SuggestWord,
} from "../src/lib/questions/suggest-questions.ts";
import {
  ClaudeStopError,
  createClaudeProvider,
} from "../src/lib/text/claude.ts";
import { usdFor } from "../src/lib/text/cost.ts";
import type { TextUsage } from "../src/lib/text/provider.ts";

const args = process.argv.slice(2);
function option(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const value = args[at + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}
const flag = (name: string): boolean => args.includes(`--${name}`);

const ROOT = join(import.meta.dirname, "..");
const INPUTS = join(ROOT, "fixtures/questions/suggest-inputs.json");
const OUT = join(ROOT, "fixtures/questions/suggestions.jsonl");

const MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
} as const;
type ModelName = keyof typeof MODELS;

/** Three minutes: a slow model is measured, not cut off. */
const TIMEOUT_MS = 180_000;

type Inputs = {
  readonly read: string;
  readonly book: number;
  readonly words: readonly SuggestWord[];
  readonly scenes: readonly SuggestScene[];
};

function readInputs(): Inputs {
  if (!existsSync(INPUTS)) {
    throw new Error(
      `No inputs at ${INPUTS}: read them through the MCP, see #83`,
    );
  }
  return JSON.parse(readFileSync(INPUTS, "utf8")) as Inputs;
}

type Line = {
  readonly batch: string;
  readonly at: string;
  readonly point: number;
  readonly model: ModelName;
  readonly system: string;
  readonly user: string;
  readonly text: string | null;
  readonly usage: TextUsage | null;
  readonly usd: number | null;
  readonly ms: number;
  readonly error: string | null;
};

function points(): number[] {
  return option("points", "5,7")
    .split(",")
    .map((p) => Number(p.trim()));
}

function models(): ModelName[] {
  return option("models", "haiku,sonnet")
    .split(",")
    .map((m) => m.trim())
    .filter((m): m is ModelName => Object.hasOwn(MODELS, m));
}

async function run(): Promise<void> {
  const inputs = readInputs();
  const dry = flag("dry");
  const label = option("label", "");
  if (!dry && label === "") throw new Error("--label is required for a run");
  const budget = Number(option("budget", "0.5"));
  const batch = `${label || "dry"}@${new Date().toISOString()}`;
  let spent = 0;

  for (const point of points()) {
    const prompt = buildSuggestQuestionsPrompt({
      book: inputs.book,
      point,
      words: inputs.words,
      scenes: inputs.scenes,
    });
    if (dry) {
      console.log(
        `\n===== point ${point}\n--- system\n${prompt.system}\n--- user\n${prompt.user}`,
      );
      continue;
    }
    for (const name of models()) {
      if (spent >= budget) {
        console.log(`Stopped at the budget: US$ ${spent.toFixed(4)}`);
        return;
      }
      const started = performance.now();
      let line: Line;
      try {
        const answer = await createClaudeProvider(
          MODELS[name],
          SUGGEST_QUESTIONS_SCHEMA,
          { timeoutMs: TIMEOUT_MS },
        ).complete({ ...prompt, json: true });
        const usd =
          answer.usage === null ? null : usdFor(MODELS[name], answer.usage);
        line = {
          batch,
          at: new Date().toISOString(),
          point,
          model: name,
          ...prompt,
          text: answer.text,
          usage: answer.usage,
          usd,
          ms: Math.round(performance.now() - started),
          error: null,
        };
      } catch (cause) {
        const usage = cause instanceof ClaudeStopError ? cause.usage : null;
        line = {
          batch,
          at: new Date().toISOString(),
          point,
          model: name,
          ...prompt,
          text: null,
          usage,
          usd: usage === null ? null : usdFor(MODELS[name], usage),
          ms: Math.round(performance.now() - started),
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
      appendFileSync(OUT, `${JSON.stringify(line)}\n`);
      spent += line.usd ?? 0;
      console.log(
        `point ${point} ${name}: ${line.error ?? "ok"} · ${line.ms} ms · US$ ${(line.usd ?? 0).toFixed(5)}`,
      );
    }
  }
  if (!dry) console.log(`Batch ${batch} · US$ ${spent.toFixed(4)}`);
}

type Row = {
  readonly point: number;
  readonly model: ModelName;
  readonly draft: DraftQuestion;
  readonly marks: readonly Mark[];
  readonly image: string;
  readonly order: string;
};

function describeMarks(marks: readonly Mark[]): string {
  return marks
    .map((m) =>
      m.presentedAt === null
        ? m.word
        : `${m.word} (ponto ${m.presentedAt.point})`,
    )
    .join(", ");
}

function report(batch: string): void {
  const inputs = readInputs();
  const lines = readFileSync(OUT, "utf8")
    .split("\n")
    .filter((text) => text.trim() !== "")
    .map((text) => JSON.parse(text) as Line)
    .filter((line) => line.batch === batch);
  if (lines.length === 0) throw new Error(`No calls in batch ${batch}`);

  const checker = createChecker(
    inputs.words.map((w) => ({
      term: w.term,
      place: { book: inputs.book, point: w.point },
      setId: w.set,
    })),
  );

  const rows: Row[] = [];
  const perModel = new Map<
    ModelName,
    {
      calls: number;
      failed: number;
      pairs: number;
      marked: number;
      invalid: number;
      pt: number;
      ms: number[];
      usd: number;
      pending: string[];
    }
  >();
  for (const line of lines) {
    const stats = perModel.get(line.model) ?? {
      calls: 0,
      failed: 0,
      pairs: 0,
      marked: 0,
      invalid: 0,
      pt: 0,
      ms: [],
      usd: 0,
      pending: [],
    };
    perModel.set(line.model, stats);
    stats.calls += 1;
    stats.ms.push(line.ms);
    stats.usd += line.usd ?? 0;
    const parsed = line.text === null ? null : parseDrafts(line.text);
    if (parsed === null || !parsed.ok) {
      stats.failed += 1;
      console.log(
        `! point ${line.point} ${line.model}: ${line.error ?? (parsed?.ok === false ? parsed.reason : "")}`,
      );
      continue;
    }
    stats.pending.push(...parsed.pending.map((p) => `${line.point}:${p}`));
    const at = { book: inputs.book, point: line.point };
    const presented = inputs.words.filter((w) => w.point <= line.point);
    const scenes = inputs.scenes.filter((s) => s.point <= line.point);
    for (const draft of parsed.questions) {
      const marks = [
        ...checker.check(draft.prompt, at),
        ...(draft.answerLanguage === "en"
          ? checker.check(draft.expectedAnswer, at)
          : []),
      ];
      const resolved = resolveImage(draft, presented, scenes);
      const image =
        resolved.kind === "word"
          ? `palavra: ${resolved.word.term}`
          : resolved.kind === "scene"
            ? `cena: ${resolved.scene.description}`
            : resolved.kind === "new_scene"
              ? `cena nova: ${resolved.description}`
              : resolved.kind === "acted_out"
                ? "encenada"
                : `INVÁLIDA (${resolved.reason}: ${draft.image})`;
      stats.pairs += 1;
      if (marks.length > 0) stats.marked += 1;
      if (resolved.kind === "invalid") stats.invalid += 1;
      if (draft.answerLanguage === "pt") stats.pt += 1;
      rows.push({
        point: line.point,
        model: line.model,
        draft,
        marks,
        image,
        // A fixed shuffle: the same batch prints the same order every time.
        order: createHash("sha256")
          .update(`${batch}|${line.model}|${draft.prompt}`)
          .digest("hex"),
      });
    }
  }

  const unblind = flag("unblind");
  let n = 0;
  for (const point of [...new Set(rows.map((r) => r.point))].sort(
    (a, b) => a - b,
  )) {
    console.log(`\n## Ponto ${point}\n`);
    console.log(
      `| linha | pergunta | resposta | idioma | imagem | marcas${unblind ? " | modelo" : ""} |`,
    );
    console.log(`|---|---|---|---|---|---${unblind ? "|---" : ""}|`);
    for (const row of rows
      .filter((r) => r.point === point)
      .sort((a, b) => a.order.localeCompare(b.order))) {
      n += 1;
      const cells = [
        `r${String(n).padStart(2, "0")}`,
        row.draft.prompt,
        row.draft.expectedAnswer,
        row.draft.answerLanguage,
        row.image,
        describeMarks(row.marks) || "·",
        ...(unblind ? [row.model] : []),
      ];
      console.log(
        `| ${cells.map((c) => c.replace(/\|/gu, "/")).join(" | ")} |`,
      );
    }
  }

  if (!unblind) return;
  console.log("\n## Por modelo\n");
  for (const [name, s] of perModel) {
    const ms = [...s.ms].sort((a, b) => a - b);
    const median = ms[Math.floor((ms.length - 1) / 2)] ?? 0;
    console.log(
      `${name}: ${s.calls} chamadas, ${s.failed} com falha · ${s.pairs} pares · ${s.marked} com marca do validador · ${s.invalid} imagens inválidas · ${s.pt} em português · mediana ${median} ms, pior ${ms.at(-1) ?? 0} ms · US$ ${s.usd.toFixed(5)} · pending: ${s.pending.join(", ") || "nenhum"}`,
    );
  }
}

const reportBatch = option("report", "");
if (reportBatch !== "") report(reportBatch);
else await run();
