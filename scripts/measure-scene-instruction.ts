/**
 * What each text model proposes as the Instrução of a scene, from the line of
 * the lesson it illustrates (#187, phase 1). It writes nothing to the
 * database and nothing on a screen changes; it measures, and the choice of a
 * provider for the phase 2 button is made on what it prints.
 *
 * The criteria and the rule of choice were written in the plan on the issue
 * before anything ran, and are restated in the report below so the numbers
 * are read against them and not the other way round.
 *
 * Inputs: fixtures/scene-inputs.tsv, nineteen lines of lesson text. It is book
 * text, so it stays out of git with the rest of /fixtures, and this file
 * carries none of it.
 *
 * Every call is appended to fixtures/scene-instruction.jsonl the moment it
 * returns, with the whole prompt, the whole answer, the usage and its cost,
 * so a run cut short keeps every call it paid for. The order is pass by pass
 * (pass 1 of every input and provider, then pass 2, then 3): a stop at the
 * budget never leaves pass 1, the one that is graded, half done.
 *
 *   node scripts/measure-scene-instruction.ts --label first --dry
 *   node --env-file=.env.local scripts/measure-scene-instruction.ts --label first --limit 1 --runs 1
 *   node --env-file=.env.local scripts/measure-scene-instruction.ts --label first
 *   node scripts/measure-scene-instruction.ts --sheet <batch>
 *   node scripts/measure-scene-instruction.ts --report <batch>
 *
 * Run flags: --label (required, except with --dry), --runs 3, --budget 0.25 (US$, a hard stop),
 * --models deepseek,haiku (sonnet is also known), --limit N (the first N
 * inputs), --dry (prints the prompts and the estimate, calls nothing and
 * needs no key). --sheet and --report read no key and spend nothing.
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  SCENE_SUBJECT_SCHEMA,
  buildSceneSubjectPrompt,
} from "../src/lib/images/scene-subject.ts";
import type { ImageStyle } from "../src/lib/images/style.ts";
import { parseSubject } from "../src/lib/images/subject.ts";
import {
  ClaudeStopError,
  createClaudeProvider,
} from "../src/lib/text/claude.ts";
import { TEXT_PRICES, usdFor } from "../src/lib/text/cost.ts";
import { createDeepSeekProvider } from "../src/lib/text/deepseek.ts";
import type { TextProvider, TextUsage } from "../src/lib/text/provider.ts";

const args = process.argv.slice(2);
/* As in measure-subject-instruction.ts: a flag with nothing after it falls back. */
function option(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const value = args[at + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}
const flag = (name: string): boolean => args.includes(`--${name}`);

const ROOT = join(import.meta.dirname, "..");
const FIXTURES = join(ROOT, "fixtures");
const INPUTS = option("inputs", join(FIXTURES, "scene-inputs.tsv"));
const OUT = option("out", join(FIXTURES, "scene-instruction.jsonl"));
/* Beside the measurements: scene-instruction-sheet.tsv and -key.json by default. */
const SHEET = OUT.replace(/\.jsonl$/u, "") + "-sheet.tsv";
const KEY = OUT.replace(/\.jsonl$/u, "") + "-key.json";

/*
 * The providers this script knows. Approved on 2026-11-04: Haiku 5.5 against
 * DeepSeek flash, which is the default. Sonnet is here so that a second,
 * small run, if Haiku fails, needs --models and no change of code. Opus is
 * left out of the measurement, and has no price in cost.ts either.
 */
const PROVIDERS = {
  deepseek: { model: "deepseek-flash" },
  haiku: { model: "claude-haiku-5-5" },
  sonnet: { model: "claude-sonnet-5-5" },
} as const;
type ProviderName = keyof typeof PROVIDERS;
const isProviderName = (value: string): value is ProviderName =>
  Object.hasOwn(PROVIDERS, value);

function providerFor(name: ProviderName): TextProvider {
  return name === "deepseek"
    ? createDeepSeekProvider()
    : createClaudeProvider(PROVIDERS[name].model, SCENE_SUBJECT_SCHEMA);
}

type Input = {
  readonly id: string;
  readonly question: string | null;
  readonly sentence: string;
  readonly style: ImageStyle;
};

function readInputs(): Input[] {
  if (!existsSync(INPUTS)) {
    throw new Error(`No inputs at ${INPUTS}: it is written by hand, see #187`);
  }
  const inputs = readFileSync(INPUTS, "utf8")
    .split("\n")
    .filter((text) => text.trim() !== "" && !text.startsWith("#"))
    .map((text, index): Input => {
      const cells = text.split("\t");
      if (cells.length !== 4) {
        throw new Error(`Input line ${index + 1} has ${cells.length} columns`);
      }
      const [id, question, sentence, style] = cells.map((cell) => cell.trim());
      if (style !== "flat" && style !== "realistic") {
        throw new Error(`Input ${id} has style ${style}`);
      }
      return {
        id,
        question: question === "" ? null : question,
        sentence,
        style,
      };
    });
  const ids = new Set(inputs.map((input) => input.id));
  if (ids.size !== inputs.length) throw new Error("Input ids repeat");
  return inputs;
}

type Line = {
  readonly batch: string;
  readonly label: string;
  readonly run: number;
  readonly provider: ProviderName;
  /** The model asked for, which is the one priced. */
  readonly model: string;
  /** The model the response named; null when there was no response. */
  readonly answeredBy: string | null;
  readonly input: Input;
  readonly system: string;
  readonly user: string;
  readonly prompt: string;
  readonly text: string | null;
  readonly subject: string | null;
  readonly stopReason: string | null;
  readonly usage: TextUsage | null;
  readonly usd: number | null;
  readonly ms: number;
  readonly error: string | null;
  readonly at: string;
};

function fingerprint(system: string, user: string): string {
  return createHash("sha256")
    .update(`${system}\n\n${user}`)
    .digest("hex")
    .slice(0, 12);
}

function readBatch(batch: string): Line[] {
  if (!existsSync(OUT)) throw new Error(`Nothing measured yet at ${OUT}`);
  const lines = readFileSync(OUT, "utf8")
    .split("\n")
    .filter((text) => text.trim() !== "")
    .map((text) => JSON.parse(text) as Line)
    .filter((line) => line.batch === batch);
  if (lines.length === 0) throw new Error(`No lines for batch ${batch}`);
  return lines;
}

/*
 * A ceiling for one call before any has come back: every character a token,
 * at a third of a character's worth (generous for English), and 500 tokens of
 * output with reasoning, the top of the plan's estimate. Once a provider has
 * answered, its dearest call so far replaces this if it is higher.
 */
const OUTPUT_CEILING = 500;
function estimateUsd(name: ProviderName, system: string, user: string): number {
  return usdFor(PROVIDERS[name].model, {
    inputTokens: Math.ceil((system.length + user.length) / 3),
    cachedInputTokens: 0,
    outputTokens: OUTPUT_CEILING,
  });
}

async function measure(): Promise<void> {
  const label = option("label", "");
  const runs = Number(option("runs", "3"));
  const budget = Number(option("budget", "0.25"));
  const limit = Number(option("limit", "0"));
  const names = option("models", "deepseek,haiku").split(",");
  for (const name of names) {
    if (!isProviderName(name)) {
      throw new Error(`--models knows ${Object.keys(PROVIDERS).join(", ")}`);
    }
    if (TEXT_PRICES[PROVIDERS[name].model] === undefined) {
      throw new Error(`No price for ${name}`);
    }
  }
  const providers = names.filter(isProviderName);
  if (!(runs >= 1) || !(budget > 0) || !(limit >= 0)) {
    throw new Error("--runs, --budget and --limit must be positive numbers");
  }

  const all = readInputs();
  const inputs = limit > 0 ? all.slice(0, limit) : all;
  const prompts = new Map(
    inputs.map((input) => [input.id, buildSceneSubjectPrompt(input)]),
  );
  const calls = inputs.length * providers.length * runs;

  if (flag("dry")) {
    const shown = new Set<string>();
    for (const input of inputs) {
      const { system, user } = prompts.get(input.id)!;
      if (!shown.has(input.style)) {
        shown.add(input.style);
        process.stdout.write(
          `\n===== system (${input.style}) =====\n${system}\n`,
        );
      }
      process.stdout.write(
        `\n----- ${input.id} (${input.style}) ${fingerprint(system, user)}\n${user}\n`,
      );
    }
    process.stdout.write(
      `\n${inputs.length} entradas × ${providers.length} fornecedores × ${runs} passadas = ${calls} chamadas\n`,
    );
    let total = 0;
    for (const name of providers) {
      const each = inputs.map((input) => {
        const { system, user } = prompts.get(input.id)!;
        return estimateUsd(name, system, user);
      });
      const sum = each.reduce((a, b) => a + b, 0) * runs;
      total += sum;
      process.stdout.write(
        `  ${name.padEnd(8)} ${PROVIDERS[name].model.padEnd(18)} teto estimado US$ ${sum.toFixed(4)}\n`,
      );
    }
    process.stdout.write(
      `  total    teto estimado US$ ${total.toFixed(4)}  ·  limite --budget US$ ${budget.toFixed(2)}\n` +
        `  (teto: caracteres/3 de entrada e ${OUTPUT_CEILING} de saída por chamada, preço de pico do DeepSeek)\n` +
        `\n--dry: nenhuma chamada feita, nenhuma chave lida.\n`,
    );
    return;
  }

  if (label === "") throw new Error("--label is required, e.g. first");
  const batch = `${label}@${new Date().toISOString()}`;
  process.stdout.write(
    `batch ${batch}\n${calls} chamadas, teto US$ ${budget.toFixed(2)}, gravando em ${OUT}\n`,
  );
  const clients = new Map(providers.map((name) => [name, providerFor(name)]));
  const dearest = new Map<ProviderName, number>();
  let spent = 0;

  for (let run = 1; run <= runs; run++) {
    for (const input of inputs) {
      const { system, user } = prompts.get(input.id)!;
      for (const name of providers) {
        const next = Math.max(
          estimateUsd(name, system, user),
          dearest.get(name) ?? 0,
        );
        if (spent + next > budget) {
          process.stdout.write(
            `\nParou pelo teto antes da passada ${run}, ${input.id}, ${name}: ` +
              `gasto US$ ${spent.toFixed(4)}, a próxima poderia custar US$ ${next.toFixed(4)}.\n` +
              `batch ${batch}\n`,
          );
          return;
        }

        const model = PROVIDERS[name].model;
        const started = Date.now();
        let text: string | null = null;
        let answeredBy: string | null = null;
        let usage: TextUsage | null = null;
        let stopReason: string | null = null;
        let error: string | null = null;
        try {
          const result = await clients
            .get(name)!
            .complete({ system, user, json: true });
          ({ text, usage } = result);
          answeredBy = result.model;
          // DeepSeek's provider does not read finish_reason; Claude's
          // returns only on end_turn and throws on anything else.
          stopReason = name === "deepseek" ? null : "end_turn";
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause);
          if (cause instanceof ClaudeStopError) {
            usage = cause.usage;
            stopReason = cause.stopReason;
            answeredBy = model;
          }
        }
        const usd = usage === null ? null : usdFor(model, usage);
        spent += usd ?? 0;
        if (usd !== null)
          dearest.set(name, Math.max(dearest.get(name) ?? 0, usd));

        const line: Line = {
          batch,
          label,
          run,
          provider: name,
          model,
          answeredBy,
          input,
          system,
          user,
          prompt: fingerprint(system, user),
          text,
          subject: text === null ? null : parseSubject(text),
          stopReason,
          usage,
          usd,
          ms: Date.now() - started,
          error,
          at: new Date().toISOString(),
        };
        // Written before anything else is done with the answer.
        appendFileSync(OUT, JSON.stringify(line) + "\n");
        process.stdout.write(
          `  ${run} ${input.id} ${name}: ${line.subject ?? `(${line.error ?? "ilegível"})`}  ` +
            `[${line.ms} ms, US$ ${(usd ?? 0).toFixed(5)}]\n`,
        );
      }
    }
  }
  process.stdout.write(
    `\nGasto US$ ${spent.toFixed(4)}.\nbatch ${batch}\n` +
      `Próximo passo: node scripts/measure-scene-instruction.ts --sheet ${batch}\n`,
  );
}

/* ------------------------------------------------------------- the sheet */

type KeyRow = {
  readonly row: string;
  readonly inputId: string;
  readonly subject: string;
  readonly providers: readonly ProviderName[];
};
type Key = { readonly batch: string; readonly rows: readonly KeyRow[] };

const sameSubject = (subject: string): string =>
  subject.trim().toLowerCase().replace(/\s+/gu, " ");

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/*
 * Pass 1 only, the provider hidden, identical phrases of one input joined in
 * one row, the order inside each input shuffled. An answer with no phrase is
 * left off the sheet: it fails check 1 whatever the grade, and its error
 * message would name the provider.
 *
 * Refuses to overwrite a sheet: once Luiz has started grading it, a second
 * --sheet would throw his grades away in silence.
 */
function sheet(batch: string): void {
  if (existsSync(SHEET) || existsSync(KEY)) {
    throw new Error(
      `${SHEET} or ${KEY} already exists. It may hold grades: move it away by hand first.`,
    );
  }
  const lines = readBatch(batch).filter((line) => line.run === 1);
  const inputs = [
    ...new Map(lines.map((line) => [line.input.id, line.input])).values(),
  ];
  const rows: KeyRow[] = [];
  const out = ["linha\tentrada\tpergunta\tfrase\testilo\tinstrução\tnota"];
  for (const input of inputs) {
    const groups = new Map<
      string,
      { subject: string; providers: ProviderName[] }
    >();
    for (const line of lines) {
      if (line.input.id !== input.id || line.subject === null) continue;
      const key = sameSubject(line.subject);
      const group = groups.get(key) ?? {
        subject: line.subject,
        providers: [],
      };
      group.providers.push(line.provider);
      groups.set(key, group);
    }
    for (const group of shuffled([...groups.values()])) {
      const row = `r${String(rows.length + 1).padStart(2, "0")}`;
      rows.push({ row, inputId: input.id, ...group });
      out.push(
        [
          row,
          input.id,
          input.question ?? "",
          input.sentence,
          input.style,
          group.subject,
          "",
        ].join("\t"),
      );
    }
  }
  writeFileSync(SHEET, out.join("\n") + "\n");
  writeFileSync(KEY, JSON.stringify({ batch, rows } satisfies Key, null, 2));
  process.stdout.write(
    `${rows.length} linhas em ${SHEET}\nchave em ${KEY} (não abrir antes de dar as notas)\n\n` +
      `Na coluna nota, para cada linha: usaria (como está), editaria ou descartaria.\n` +
      `Usaria = mostra só o que a resposta afirma no fim, tem tudo o que ela nomeia\n` +
      `com a relação visível e nada além, e diz o ponto de vista.\n`,
  );
}

/* ------------------------------------------------------------ the report */

const GRADES = ["usaria", "editaria", "descartaria"] as const;
type Grade = (typeof GRADES)[number];

function readGrades(batch: string): Map<string, Grade> {
  const grades = new Map<string, Grade>();
  if (!existsSync(SHEET) || !existsSync(KEY)) return grades;
  const key = JSON.parse(readFileSync(KEY, "utf8")) as Key;
  if (key.batch !== batch) {
    throw new Error(`The sheet is for ${key.batch}, not ${batch}`);
  }
  for (const text of readFileSync(SHEET, "utf8").split("\n").slice(1)) {
    const cells = text.split("\t");
    const grade = (cells[6] ?? "").trim().toLowerCase();
    if (cells[0] === undefined || grade === "") continue;
    const known = GRADES.find((each) => each === grade || each[0] === grade);
    if (known === undefined) {
      throw new Error(`Row ${cells[0]} has the grade "${grade}"`);
    }
    for (const row of key.rows.filter((each) => each.row === cells[0])) {
      for (const provider of row.providers) {
        grades.set(`${row.inputId}/${provider}`, known);
      }
    }
  }
  return grades;
}

/* Check 2: lesson text. Negation, a question mark, quotes, or the line itself. */
const NEGATION = /\b(no|not)\b|n['’]t\b/iu;
const QUOTES = /["“”‘«»]/u;
const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word !== "");
function lessonText(subject: string, sentence: string): boolean {
  return (
    NEGATION.test(subject) ||
    subject.includes("?") ||
    QUOTES.test(subject) ||
    words(subject).join(" ") === words(sentence).join(" ")
  );
}

/* Check 3: the medium, or a colour, which the fixed style already decides. */
const MEDIUM =
  /\b(drawing|drawn|illustration|illustrated|photo|photos|photograph|photographic|render|rendered|rendering|painting|painted|vector|cartoon|palette|pastel|colou?r|colou?red|colou?rful|red|blue|green|yellow|orange|purple|pink|brown|grey|gray|black|white)\b/iu;

/* Check 4: 20 words asked for; over 25 fails. */
const LONG = 25;

/* Check 5, a flag and not a verdict: the same expression as the word prompt's. */
const COMPARISON =
  /\b(two|both|pair|side by side|beside|next to|than|compared|versus|vs|other|another|smaller|larger|bigger|longer|shorter)\b/iu;
const SIZE_LINE = /\b(small|large|long|short)\b/iu;

type Checks = {
  legible: boolean;
  noLessonText: boolean;
  noMedium: boolean;
  short: boolean;
  comparison: boolean;
};
function check(line: Line): Checks {
  const subject = line.subject;
  if (subject === null) {
    return {
      legible: false,
      noLessonText: false,
      noMedium: false,
      short: false,
      comparison: false,
    };
  }
  return {
    legible: true,
    noLessonText: !lessonText(subject, line.input.sentence),
    noMedium: !MEDIUM.test(subject),
    short: words(subject).length <= LONG,
    comparison: SIZE_LINE.test(line.input.sentence) && COMPARISON.test(subject),
  };
}
const passesAutomatic = (c: Checks): boolean =>
  c.legible && c.noLessonText && c.noMedium && c.short;

function percentile(sorted: readonly number[], p: number): number {
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
}

function report(batch: string): void {
  const lines = readBatch(batch);
  const grades = readGrades(batch);
  const providers = [...new Set(lines.map((line) => line.provider))];
  const inputs = [...new Set(lines.map((line) => line.input.id))];
  const prompts = new Set(lines.map((line) => line.prompt));
  process.stdout.write(
    `batch ${batch}\n${inputs.length} entradas, ${providers.length} fornecedores, ${prompts.size} prompts distintos\n` +
      `Amostra: frases da lição 1 do livro 1 e as cenas do banco; o resultado vale para esse tipo de frase.\n`,
  );

  const scores = new Map<
    ProviderName,
    { good: number; median: number; perCall: number }
  >();
  let ungraded = 0;

  for (const provider of providers) {
    const mine = lines.filter((line) => line.provider === provider);
    const first = mine.filter((line) => line.run === 1);
    const model = mine[0].model;
    process.stdout.write(`\n${provider} (${model})\n`);

    for (const [title, set] of [
      ["passada 1", first],
      ["todas", mine],
    ] as const) {
      const checks = set.map(check);
      const count = (pick: (c: Checks) => boolean): string =>
        `${checks.filter(pick).length}/${set.length}`;
      process.stdout.write(
        `  ${title.padEnd(9)} legível ${count((c) => c.legible)}  ·  sem texto de aula ${count((c) => c.noLessonText)}` +
          `  ·  sem meio ${count((c) => c.noMedium)}  ·  curta ${count((c) => c.short)}` +
          `  ·  aviso de comparação ${count((c) => c.comparison)}\n`,
      );
    }
    const over20 = mine.filter(
      (line) => line.subject !== null && words(line.subject).length > 20,
    ).length;
    if (over20 > 0) {
      process.stdout.write(`  acima das 20 palavras pedidas: ${over20}\n`);
    }

    // Grades and good answers, pass 1.
    const tally = new Map<Grade | "sem nota", number>();
    let good = 0;
    for (const line of first) {
      const grade = grades.get(`${line.input.id}/${provider}`);
      if (line.subject !== null && grade === undefined) ungraded++;
      const name = grade ?? "sem nota";
      tally.set(name, (tally.get(name) ?? 0) + 1);
      if (passesAutomatic(check(line)) && grade === "usaria") good++;
    }
    process.stdout.write(
      `  notas     ${[...tally].map(([name, n]) => `${name} ${n}`).join("  ·  ")}\n` +
        `  BOAS      ${good} de ${inputs.length}\n`,
    );

    // Stability: inputs whose passes all gave the same phrase. Failing the
    // same way every time is not a stable phrase, so no phrase never counts.
    const runsSeen = new Set(mine.map((line) => line.run)).size;
    const stable = inputs.filter((id) => {
      const phrases = mine
        .filter((line) => line.input.id === id)
        .map((line) =>
          line.subject === null ? null : sameSubject(line.subject),
        );
      return (
        phrases.length === runsSeen &&
        !phrases.includes(null) &&
        new Set(phrases).size === 1
      );
    }).length;
    process.stdout.write(
      `  estável   ${stable} de ${inputs.length} com a mesma frase nas ${runsSeen} passadas\n`,
    );

    // Errors.
    const errors = mine.filter((line) => line.error !== null);
    if (errors.length > 0) {
      process.stdout.write(`  erros     ${errors.length}\n`);
      for (const line of errors) {
        process.stdout.write(
          `    ${line.run} ${line.input.id}: ${line.error}\n`,
        );
      }
    }

    // Latency and cost.
    const times = mine.map((line) => line.ms).sort((a, b) => a - b);
    const median = percentile(times, 50);
    process.stdout.write(
      `  latência  mediana ${median} ms  ·  pior ${times.at(-1)} ms\n`,
    );
    const costs = mine.flatMap((line) => (line.usd === null ? [] : [line.usd]));
    const total = costs.reduce((a, b) => a + b, 0);
    const perCall = costs.length === 0 ? 0 : total / costs.length;
    process.stdout.write(
      `  custo     US$ ${total.toFixed(4)} no lote  ·  US$ ${(perCall * 100).toFixed(4)} por 100 propostas` +
        `${costs.length < mine.length ? `  (${mine.length - costs.length} sem uso de tokens)` : ""}\n`,
    );
    scores.set(provider, { good, median, perCall });
  }

  // The rule of choice, as written in the plan before the run.
  process.stdout.write(
    `\nRegra de escolha (escrita no plano antes de rodar)\n`,
  );
  if (ungraded > 0) {
    process.stdout.write(
      `  ${ungraded} resposta(s) da passada 1 sem nota: a escolha abaixo é provisória.\n`,
    );
  }
  const best = Math.max(...[...scores.values()].map((s) => s.good));
  const tied = [...scores].filter(([, s]) => s.good >= best - 2);
  const winner = tied.some(([name]) => name === "deepseek")
    ? "deepseek"
    : tied.sort(([, a], [, b]) => a.median - b.median)[0][0];
  process.stdout.write(
    `  melhor: ${best} boas  ·  empatados (até 2 abaixo): ${tied.map(([name]) => name).join(", ")}\n` +
      `  escolhido: ${winner} (no empate o DeepSeek ganha; sem ele, a menor latência mediana)\n`,
  );
  const dear = [...scores].filter(([, s]) => s.perCall > 0.01);
  if (dear.length > 0) {
    process.stdout.write(
      `  acima de US$ 0,01 por proposta, o custo desempata: ${dear.map(([name]) => name).join(", ")}\n`,
    );
  }
}

if (args[0] === "--sheet") {
  sheet(args[1] ?? "");
} else if (args[0] === "--report") {
  report(args[1] ?? "");
} else {
  await measure();
}
