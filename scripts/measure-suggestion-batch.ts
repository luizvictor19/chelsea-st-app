/**
 * How long the suggestion pass takes at each batch size, and whether the size
 * changes the answers.
 *
 * SUGGESTION_BATCH is ten, and the number was bought with a measurement on
 * 2026-09-19 against a prompt that offered six kinds: worst call 15.9s and
 * 56.5s total at ten, 13.8s and 70.7s at five. The prompt now offers eight,
 * with usage and metalanguage and the boundary rule between them, so it is
 * longer on every call and the measurement that chose ten no longer describes
 * it. That script was never written down — this is it, written so the next
 * change to the prompt can be measured instead of argued about.
 *
 * It writes nothing to the database. It reads the words, asks the model,
 * times the calls and compares the answers; no row is touched and no
 * suggestion is saved. Choosing the size is not its job either: it reports,
 * and the number in suggest.ts is changed by a person who has read the report.
 *
 * What it does write is the measurement, one JSONL line per call, appended
 * the moment the call returns (#75): the batch it belongs to, the size, the
 * lesson and the words, the time, the prompt, the raw answer and what the
 * parser read of it. A failed call is a line too, with no text and its error.
 * The run of 2026-09-20 kept everything in memory and wrote it at the end,
 * and lost 92 of its 93 paid calls when it was interrupted. Now an
 * interrupted run keeps every call that finished, and --report rebuilds the
 * table from the file without paying again. The table at the end of a run is
 * read back from the file as well: the file is the measurement, and memory is
 * only a copy of it.
 *
 * The words come from scripts/suggestion-lessons.json rather than from the
 * database, so that a run today and a run after the next prompt change are
 * comparable. They are the nine real lessons of book 1 — 60, 50, 31, 30, 27,
 * 26, 24, 18 and 17 words — read out of the project on 2026-09-20, with their
 * real ids, in the order the screen sorts them.
 *
 * Sequential on purpose, one call at a time, because that is what the button
 * does and because concurrent calls would be measuring contention. It costs
 * real requests to a paid API: at the default sizes it is 132 calls and the
 * better part of half an hour.
 *
 *   node --env-file=.env.local scripts/measure-suggestion-batch.ts
 *   node --env-file=.env.local scripts/measure-suggestion-batch.ts \
 *     --sizes 10,15,20 --baseline 10 --out fixtures/other.jsonl
 *   node scripts/measure-suggestion-batch.ts --report <batch>
 *
 * The file defaults to fixtures/suggestion-batch.jsonl, beside the other
 * measurements, under a folder git ignores. Every run appends a new batch,
 * named by the instant it started; --report takes that name, which the run
 * prints first and last.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { compareWords } from "../src/lib/content/word-order.ts";
import {
  buildSuggestionPrompt,
  parseSuggestions,
} from "../src/lib/images/suggest.ts";
import { createDeepSeekProvider } from "../src/lib/text/deepseek.ts";

const args = process.argv.slice(2);
/*
 * The fallback covers a flag with nothing after it as well as a flag that is
 * absent. `--out` last would otherwise hand appendFileSync an undefined path
 * and throw on the first paid request.
 */
function option(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const value = args[at + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

const ROOT = join(import.meta.dirname, "..");
/*
 * Beside this script and not under fixtures/, which is ignored whole so that
 * a book's pages cannot be committed by accident. A file left there would not
 * be in a clone, and the point of freezing these words is that a run today
 * and a run after the next prompt change are comparable.
 */
const FIXTURE = option(
  "fixture",
  join(ROOT, "scripts", "suggestion-lessons.json"),
);
const SIZES = option("sizes", "5,10,15,20")
  .split(",")
  .map((size) => Number(size.trim()))
  .filter((size) => Number.isInteger(size) && size > 0);
const BASELINE = Number(option("baseline", "10"));
const OUT = option("out", join(ROOT, "fixtures", "suggestion-batch.jsonl"));
const REPORT = option("report", "");

type Word = {
  readonly id: string;
  readonly term: string;
  readonly point: number;
};
type Lesson = { readonly number: number; readonly words: readonly Word[] };

/** An answer for one word, as the parser gives it. */
type Answer = { readonly kind: string; readonly wordClass: string | null };

function lessons(): readonly Lesson[] {
  const file = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    words: [number, string, string, number][];
  };
  const byLesson = new Map<number, Word[]>();
  for (const [lesson, id, term, point] of file.words) {
    const list = byLesson.get(lesson) ?? [];
    list.push({ id, term, point });
    byLesson.set(lesson, list);
  }
  return [...byLesson.entries()]
    .map(([number, words]) => ({
      number,
      // The screen's comparator, so a batch is the region of the list the
      // teacher can see, exactly as the action slices it.
      words: [...words].sort((a, b) =>
        compareWords(
          { lessonNumber: null, pointNumber: a.point, term: a.term },
          { lessonNumber: null, pointNumber: b.point, term: b.term },
        ),
      ),
    }))
    .sort((a, b) => b.words.length - a.words.length);
}

/**
 * One call, as it is written to the file. Everything the table needs is here,
 * so a batch can be reported from its lines alone.
 */
type Line = {
  /** The instant the run started, ISO: one name for every call of a run. */
  readonly batch: string;
  readonly size: number;
  readonly lesson: number;
  /** The words sent, 1-based and inclusive, in the screen's order. */
  readonly from: number;
  readonly to: number;
  /** When the call returned. */
  readonly at: string;
  readonly ms: number;
  readonly system: string;
  readonly user: string;
  /** The raw answer, or null when the call failed. */
  readonly text: string | null;
  /** What parseSuggestions read of it, by word id. */
  readonly answers: Readonly<Record<string, Answer>>;
  readonly rejected: number;
  readonly error: string | null;
};

type Run = {
  readonly size: number;
  readonly calls: number;
  readonly worstMs: number;
  readonly totalMs: number;
  readonly unanswered: number;
  readonly rejected: number;
  readonly answers: ReadonlyMap<string, Answer>;
};

/** Asks the model for every batch of one size, a line per call. */
async function measure(
  batchName: string,
  size: number,
  all: readonly Lesson[],
): Promise<void> {
  const provider = createDeepSeekProvider();

  for (const lesson of all) {
    for (let at = 0; at < lesson.words.length; at += size) {
      const batch = lesson.words.slice(at, at + size);
      const { system, user } = buildSuggestionPrompt(batch);

      const started = Date.now();
      let text: string | null = null;
      let error: string | null = null;
      try {
        ({ text } = await provider.complete({ system, user, json: true }));
      } catch (cause) {
        // A failed call is part of what a size costs, so its time counts and
        // the run carries on. Hiding it would make a size that fails often
        // look like a size that is merely slow.
        error = cause instanceof Error ? cause.message : String(cause);
      }
      const ms = Date.now() - started;

      // Parsed in the same tick, with nothing awaited before the line is
      // written: the parser is pure and the line carries its result.
      const parsed =
        text === null
          ? { suggestions: [], rejected: 0 }
          : parseSuggestions(
              text,
              batch.map((word) => word.id),
            );
      const line: Line = {
        batch: batchName,
        size,
        lesson: lesson.number,
        from: at + 1,
        to: at + batch.length,
        at: new Date().toISOString(),
        ms,
        system,
        user,
        text,
        answers: Object.fromEntries(
          parsed.suggestions.map((suggestion) => [
            suggestion.id,
            { kind: suggestion.kind, wordClass: suggestion.wordClass },
          ]),
        ),
        rejected: parsed.rejected,
        error,
      };
      // Written before anything else is done with the answer.
      appendFileSync(OUT, JSON.stringify(line) + "\n");

      process.stdout.write(
        error === null
          ? `  size ${size} lesson ${lesson.number} ${line.from}-${line.to}: ${(ms / 1000).toFixed(1)}s, ${parsed.suggestions.length} answered\n`
          : `  size ${size} lesson ${lesson.number} ${line.from}-${line.to}: FAILED after ${(ms / 1000).toFixed(1)}s · ${error}\n`,
      );
    }
  }
}

/**
 * The lines of one batch, read back from the file.
 *
 * A run cut off in the middle of an append can leave its last line half
 * written. That line is skipped and counted, never guessed at.
 */
function readBatch(batchName: string): Line[] {
  if (!existsSync(OUT)) throw new Error(`${OUT} does not exist`);
  const lines: Line[] = [];
  let unreadable = 0;
  for (const text of readFileSync(OUT, "utf8").split("\n")) {
    if (text.trim() === "") continue;
    let line: Line;
    try {
      line = JSON.parse(text) as Line;
    } catch {
      unreadable += 1;
      continue;
    }
    if (line.batch === batchName) lines.push(line);
  }
  if (unreadable > 0) {
    process.stdout.write(
      `${unreadable} line(s) of ${OUT} are not JSON and were skipped\n`,
    );
  }
  return lines;
}

/** One size's figures, from its lines, in the order the sizes were run. */
function runs(lines: readonly Line[]): Run[] {
  const sizes = [...new Set(lines.map((line) => line.size))];
  return sizes.map((size) => {
    const mine = lines.filter((line) => line.size === size);
    const answers = new Map<string, Answer>();
    let unanswered = 0;
    for (const line of mine) {
      const answered = Object.entries(line.answers);
      for (const [id, answer] of answered) answers.set(id, answer);
      unanswered += line.to - line.from + 1 - answered.length;
    }
    return {
      size,
      calls: mine.length,
      worstMs: Math.max(0, ...mine.map((line) => line.ms)),
      totalMs: mine.reduce((sum, line) => sum + line.ms, 0),
      unanswered,
      rejected: mine.reduce((sum, line) => sum + line.rejected, 0),
      answers,
    };
  });
}
/** Words whose kind, or whose class, the two runs answered differently. */
function changed(
  run: Run,
  baseline: Run,
): { kinds: number; classes: number; examples: readonly string[] } {
  let kinds = 0;
  let classes = 0;
  const examples: string[] = [];
  for (const [id, answer] of run.answers) {
    const before = baseline.answers.get(id);
    if (before === undefined) continue;
    if (before.kind !== answer.kind) {
      kinds += 1;
      if (examples.length < 8) {
        examples.push(`${id.slice(0, 8)} ${before.kind} -> ${answer.kind}`);
      }
    }
    if (before.wordClass !== answer.wordClass) classes += 1;
  }
  return { kinds, classes, examples };
}

function report(batchName: string): void {
  const measured = runs(readBatch(batchName));
  if (measured.length === 0) {
    process.stdout.write(`no lines of batch ${batchName} in ${OUT}\n`);
    return;
  }
  const baseline = measured.find((run) => run.size === BASELINE);

  process.stdout.write(
    `\nbatch ${batchName}\n` +
      `size  calls  worst call  total    unanswered  rejected  kinds changed vs ${BASELINE}\n`,
  );
  for (const run of measured) {
    const against =
      baseline === undefined || run.size === BASELINE
        ? null
        : changed(run, baseline);
    process.stdout.write(
      [
        String(run.size).padEnd(4),
        String(run.calls).padStart(5),
        `${(run.worstMs / 1000).toFixed(1)}s`.padStart(11),
        `${(run.totalMs / 1000).toFixed(1)}s`.padStart(8),
        String(run.unanswered).padStart(11),
        String(run.rejected).padStart(9),
        against === null ? "        ·" : String(against.kinds).padStart(9),
      ].join("") + "\n",
    );
  }

  for (const run of measured) {
    if (baseline === undefined || run.size === BASELINE) continue;
    const against = changed(run, baseline);
    if (against.kinds === 0 && against.classes === 0) continue;
    process.stdout.write(
      `\nsize ${run.size}: ${against.kinds} kinds and ${against.classes} classes differ from ${BASELINE}\n` +
        against.examples.map((line) => `  ${line}\n`).join(""),
    );
  }
}

if (REPORT !== "") {
  report(REPORT);
} else {
  const all = lessons();
  const words = all.reduce((sum, lesson) => sum + lesson.words.length, 0);
  const batchName = new Date().toISOString();
  mkdirSync(dirname(OUT), { recursive: true });
  process.stdout.write(
    `batch ${batchName}, appending to ${OUT}\n` +
      `${all.length} lessons, ${words} words: ${all.map((lesson) => lesson.words.length).join(", ")}\n` +
      `sizes ${SIZES.join(", ")}, baseline ${BASELINE}\n\n`,
  );

  for (const size of SIZES) {
    await measure(batchName, size, all);
    process.stdout.write("\n");
  }

  report(batchName);
  process.stdout.write(`\nreport again with: --report ${batchName}\n`);
}
