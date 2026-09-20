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
 * It writes nothing, anywhere. It reads the words, asks the model, times the
 * calls and compares the answers; no row is touched and no suggestion is
 * saved. Choosing the size is not its job either: it reports, and the number
 * in suggest.ts is changed by a person who has read the report.
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
 *     --sizes 10,15,20 --baseline 10 --out /tmp/batch.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { compareWords } from "../src/lib/content/word-order.ts";
import {
  buildSuggestionPrompt,
  parseSuggestions,
} from "../src/lib/images/suggest.ts";
import { createDeepSeekProvider } from "../src/lib/text/deepseek.ts";

const args = process.argv.slice(2);
/*
 * The fallback covers a flag with nothing after it as well as a flag that is
 * absent. `--out` last would otherwise hand writeFileSync an undefined path
 * and throw after the 132 paid requests, losing the report they bought.
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
const OUT = option("out", "");

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

type Run = {
  readonly size: number;
  readonly calls: number;
  readonly worstMs: number;
  readonly totalMs: number;
  readonly unanswered: number;
  readonly rejected: number;
  readonly answers: ReadonlyMap<string, Answer>;
};

async function measure(size: number, all: readonly Lesson[]): Promise<Run> {
  const provider = createDeepSeekProvider();
  const answers = new Map<string, Answer>();
  let calls = 0;
  let worstMs = 0;
  let totalMs = 0;
  let rejected = 0;
  let answered = 0;
  let words = 0;

  for (const lesson of all) {
    for (let at = 0; at < lesson.words.length; at += size) {
      const batch = lesson.words.slice(at, at + size);
      words += batch.length;
      const { system, user } = buildSuggestionPrompt(batch);

      const started = Date.now();
      let text: string;
      try {
        ({ text } = await provider.complete({ system, user, json: true }));
      } catch (cause) {
        // A failed call is part of what a size costs, so its time counts and
        // the run carries on. Hiding it would make a size that fails often
        // look like a size that is merely slow.
        const ms = Date.now() - started;
        calls += 1;
        totalMs += ms;
        worstMs = Math.max(worstMs, ms);
        process.stdout.write(
          `  size ${size} lesson ${lesson.number} ${at + 1}-${at + batch.length}: FAILED after ${(ms / 1000).toFixed(1)}s — ${cause instanceof Error ? cause.message : String(cause)}\n`,
        );
        continue;
      }
      const ms = Date.now() - started;

      calls += 1;
      totalMs += ms;
      worstMs = Math.max(worstMs, ms);

      const parsed = parseSuggestions(
        text,
        batch.map((word) => word.id),
      );
      rejected += parsed.rejected;
      answered += parsed.suggestions.length;
      for (const suggestion of parsed.suggestions) {
        answers.set(suggestion.id, {
          kind: suggestion.kind,
          wordClass: suggestion.wordClass,
        });
      }

      process.stdout.write(
        `  size ${size} lesson ${lesson.number} ${at + 1}-${at + batch.length}: ${(ms / 1000).toFixed(1)}s, ${parsed.suggestions.length} answered\n`,
      );
    }
  }

  return {
    size,
    calls,
    worstMs,
    totalMs,
    unanswered: words - answered,
    rejected,
    answers,
  };
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

const all = lessons();
const words = all.reduce((sum, lesson) => sum + lesson.words.length, 0);
process.stdout.write(
  `${all.length} lessons, ${words} words: ${all.map((lesson) => lesson.words.length).join(", ")}\n` +
    `sizes ${SIZES.join(", ")}, baseline ${BASELINE}\n\n`,
);

const runs: Run[] = [];
for (const size of SIZES) {
  runs.push(await measure(size, all));
  process.stdout.write("\n");
}

const baseline = runs.find((run) => run.size === BASELINE);

process.stdout.write(
  `\nsize  calls  worst call  total    unanswered  rejected  kinds changed vs ${BASELINE}\n`,
);
for (const run of runs) {
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
      against === null ? "        —" : String(against.kinds).padStart(9),
    ].join("") + "\n",
  );
}

for (const run of runs) {
  if (baseline === undefined || run.size === BASELINE) continue;
  const against = changed(run, baseline);
  if (against.kinds === 0 && against.classes === 0) continue;
  process.stdout.write(
    `\nsize ${run.size}: ${against.kinds} kinds and ${against.classes} classes differ from ${BASELINE}\n` +
      against.examples.map((line) => `  ${line}\n`).join(""),
  );
}

if (OUT !== "") {
  writeFileSync(
    OUT,
    JSON.stringify(
      runs.map((run) => ({
        size: run.size,
        calls: run.calls,
        worstMs: run.worstMs,
        totalMs: run.totalMs,
        unanswered: run.unanswered,
        rejected: run.rejected,
        answers: Object.fromEntries(run.answers),
      })),
      null,
      2,
    ),
  );
  process.stdout.write(`\nwrote ${OUT}\n`);
}
