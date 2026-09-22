/**
 * How well the model proposes contrast sets, against the ones the teacher
 * linked by hand.
 *
 * The gold is every set of book 1, lessons 1 and 2, as the teacher saved them
 * through save_contrast_set (0022). The model is given one lesson's words at a
 * time, each with its point, its kind and its class, and never the sets: it
 * has to find them. Its answer is compared set by set (identical, invented,
 * missed) and pair by pair, since a set that is almost right is right about
 * most of its pairs.
 *
 * It writes nothing to the database. It reads a frozen fixture and asks the
 * model; nothing it proposes is saved, here or anywhere. A set only exists
 * once the teacher confirms it.
 *
 * The fixture lives under fixtures/, which git ignores, and is not part of
 * any commit. It is the words of the two lessons with their ids, terms,
 * points, kinds and classes, and the teacher's sets as lists of ids: book
 * vocabulary and nothing about any person. It was read from the project on
 * 2026-09-22 through the read-only Supabase MCP, and its per-lesson digest
 * matched the database's.
 *
 * Every call is appended to the JSONL file the moment it returns, with the
 * whole prompt and the whole answer, so an interrupted run keeps every call
 * it paid for. The scores are then worked out from that file, not from
 * memory, and --score recomputes them from it later without paying again.
 *
 * Sequential, one call at a time. At the defaults it is 6 calls: 2 lessons,
 * 3 runs.
 *
 *   node --env-file=.env.local scripts/measure-contrast-suggestions.ts
 *   node --env-file=.env.local scripts/measure-contrast-suggestions.ts --runs 5
 *   node scripts/measure-contrast-suggestions.ts --score <batch>
 *   node scripts/measure-contrast-suggestions.ts --self-check
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createDeepSeekProvider } from "../src/lib/text/deepseek.ts";

const args = process.argv.slice(2);
/*
 * The fallback covers a flag with nothing after it as well as a flag that is
 * absent, as in measure-suggestion-batch.ts.
 */
function option(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const value = args[at + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

const ROOT = join(import.meta.dirname, "..");
const FIXTURE = option("fixture", join(ROOT, "fixtures", "contrast-gold.json"));
const OUT = option("out", join(ROOT, "fixtures", "contrast-runs.jsonl"));
const RUNS = Number(option("runs", "3"));
const SCORE = option("score", "");
const SELF_CHECK = args.includes("--self-check");

type Word = {
  readonly id: string;
  readonly term: string;
  readonly point: number;
  readonly kind: string;
  readonly wordClass: string;
};
type Lesson = { readonly number: number; readonly words: readonly Word[] };
type GoldSet = { readonly lesson: number; readonly members: readonly string[] };

function fixture(): { lessons: readonly Lesson[]; sets: readonly GoldSet[] } {
  const file = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    lessons: {
      number: number;
      words: [string, string, number, string, string][];
    }[];
    sets: GoldSet[];
  };
  return {
    lessons: file.lessons.map((lesson) => ({
      number: lesson.number,
      words: lesson.words.map(([id, term, point, kind, wordClass]) => ({
        id,
        term,
        point,
        kind,
        wordClass,
      })),
    })),
    sets: file.sets,
  };
}

/*
 * The prompt. No word of the gold is in it: the examples of what a set is
 * (hot and cold, the days of the week) and of what it is not (apple and
 * banana) come from outside lessons 1 and 2.
 *
 * Two things in it are choices that move the result, and are named in the
 * report. The kinds with no picture are ruled out, because a set exists to
 * show pictures side by side. And the point is offered as a hint, not a rule:
 * every gold set sits inside one point, but the migration keeps that from
 * being a rule because later lessons carry families on.
 */
const SYSTEM = `You help an English teacher prepare picture cards for a beginners' course.

A contrast set is a small group of words from the same lesson whose meanings are learnt by comparing them. Each word gets its own picture, and the pictures are shown side by side, so that the difference between them carries the meaning. A pair of opposites is a contrast set (hot, cold). So is a short series from one closed family where each member is understood against the others (the days of the week).

You are given the words of one lesson. Each line has an id, the word, the point of the book where it is first taught, the kind of picture it gets, and its word class, separated by tabs.

Rules:
- Only words that get a picture can be in a set. The kinds usage, metalanguage and none get no picture: never put them in a set.
- Every member of a set must contrast with the others along the same dimension. Sharing a topic or a word class is not enough: apple and banana are both fruit, and that is not a contrast.
- A set has two or more words. A word is in at most one set.
- Most words belong to no set. Leave them out rather than force them in.
- Words first taught at the same point are more likely to form a set together. This is a hint, not a rule.

Answer in json, and only in json, with this shape:
{"sets": [{"members": ["<id>", "<id>"], "reason": "<one short sentence>"}]}
List the members of each set in the order they should be shown. Use only ids from the list.`;

function buildPrompt(lesson: Lesson): { system: string; user: string } {
  const lines = lesson.words
    .map((w) => [w.id, w.term, w.point, w.kind, w.wordClass].join("\t"))
    .join("\n");
  return {
    system: SYSTEM,
    user: `Lesson ${lesson.number}. Find the contrast sets among these ${lesson.words.length} words:\n\n${lines}`,
  };
}

type Parsed = {
  readonly sets: readonly (readonly string[])[];
  /** Members that were not an id from the lesson. */
  readonly unknown: number;
  /** Members dropped because an earlier set already held the word. */
  readonly repeated: number;
  /** Sets left with fewer than two members once cleaned. */
  readonly tooSmall: number;
  readonly unreadable: boolean;
};

/**
 * The model's answer is untrusted, as in parseSuggestions: an id outside the
 * lesson is counted and dropped, a word already placed is counted and dropped
 * from the later set, and a set left with one member is counted and dropped.
 * Nothing is repaired by guessing.
 */
function parse(text: string, lesson: Lesson): Parsed {
  const allowed = new Set(lesson.words.map((w) => w.id));
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  let body: unknown;
  try {
    body = JSON.parse(unfenced);
  } catch {
    return { sets: [], unknown: 0, repeated: 0, tooSmall: 0, unreadable: true };
  }
  const raw =
    typeof body === "object" && body !== null
      ? (body as { sets?: unknown }).sets
      : null;
  if (!Array.isArray(raw)) {
    return { sets: [], unknown: 0, repeated: 0, tooSmall: 0, unreadable: true };
  }

  const placed = new Set<string>();
  const sets: string[][] = [];
  let unknown = 0;
  let repeated = 0;
  let tooSmall = 0;
  for (const entry of raw) {
    const members =
      typeof entry === "object" && entry !== null
        ? (entry as { members?: unknown }).members
        : null;
    if (!Array.isArray(members)) {
      tooSmall += 1;
      continue;
    }
    const kept: string[] = [];
    for (const id of members) {
      if (typeof id !== "string" || !allowed.has(id)) {
        unknown += 1;
      } else if (placed.has(id) || kept.includes(id)) {
        repeated += 1;
      } else {
        kept.push(id);
      }
    }
    if (kept.length < 2) {
      tooSmall += 1;
      continue;
    }
    for (const id of kept) placed.add(id);
    sets.push(kept);
  }
  return { sets, unknown, repeated, tooSmall, unreadable: false };
}

const key = (members: readonly string[]) => [...members].sort().join(",");

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

type Verdict =
  | "invented" // no member is in any gold set
  | "part of" // strictly inside one gold set
  | "joins" // exactly two or more whole gold sets put together
  | "mixed"; // anything else: gold members with others, or across sets

type Score = {
  readonly exact: number;
  readonly sameOrder: number;
  readonly suggested: number;
  readonly gold: number;
  readonly wrong: readonly { members: readonly string[]; verdict: Verdict }[];
  readonly missed: readonly (readonly string[])[];
  readonly pairsRight: number;
  readonly pairsSuggested: number;
  readonly pairsGold: number;
};

function score(
  suggested: readonly (readonly string[])[],
  gold: readonly (readonly string[])[],
): Score {
  const goldByKey = new Map(gold.map((set) => [key(set), set]));
  const suggestedKeys = new Set(suggested.map(key));
  const goldOf = new Map<string, readonly string[]>();
  for (const set of gold) for (const id of set) goldOf.set(id, set);

  let exact = 0;
  let sameOrder = 0;
  const wrong: { members: readonly string[]; verdict: Verdict }[] = [];
  for (const set of suggested) {
    const match = goldByKey.get(key(set));
    if (match !== undefined) {
      exact += 1;
      if (match.every((id, i) => id === set[i])) sameOrder += 1;
      continue;
    }
    const touched = new Set(
      set.map((id) => goldOf.get(id)).filter((g) => g !== undefined),
    );
    const outside = set.filter((id) => !goldOf.has(id)).length;
    let verdict: Verdict = "mixed";
    if (touched.size === 0) verdict = "invented";
    else if (touched.size === 1 && outside === 0) verdict = "part of";
    else if (
      touched.size >= 2 &&
      outside === 0 &&
      [...touched].reduce((n, g) => n + g.length, 0) === set.length
    ) {
      verdict = "joins";
    }
    wrong.push({ members: set, verdict });
  }

  const suggestedPairs = pairs(suggested);
  const goldPairs = pairs(gold);
  return {
    exact,
    sameOrder,
    suggested: suggested.length,
    gold: gold.length,
    wrong,
    missed: gold.filter((set) => !suggestedKeys.has(key(set))),
    pairsRight: [...suggestedPairs].filter((p) => goldPairs.has(p)).length,
    pairsSuggested: suggestedPairs.size,
    pairsGold: goldPairs.size,
  };
}

type Line = {
  readonly batch: string;
  readonly run: number;
  readonly lesson: number;
  readonly at: string;
  readonly ms: number;
  readonly model: string | null;
  readonly system: string;
  readonly user: string;
  readonly text: string | null;
  readonly error: string | null;
};

const { lessons, sets: goldSets } = fixture();
const termOf = new Map(
  lessons.flatMap((lesson) => lesson.words.map((w) => [w.id, w] as const)),
);
const show = (members: readonly string[]) =>
  members
    .map((id) => {
      const word = termOf.get(id);
      return word === undefined
        ? id.slice(0, 8)
        : `${word.term}(${word.point})`;
    })
    .join(", ");
const pct = (n: number, d: number) =>
  d === 0 ? "  -  " : `${((100 * n) / d).toFixed(0)}%`.padStart(5);

function goldFor(lesson: number): readonly (readonly string[])[] {
  return goldSets.filter((s) => s.lesson === lesson).map((s) => s.members);
}

function report(lines: readonly Line[]): void {
  process.stdout.write(
    "\nrun lesson  sets  exact  order  wrong  missed   pairs ok/sug/gold  precision  recall  dropped\n",
  );
  const totals = { right: 0, suggested: 0, gold: 0 };
  const seen = new Map<
    string,
    { lesson: number; runs: Set<number>; members: readonly string[] }
  >();
  const runs = new Set<number>();

  for (const line of lines) {
    runs.add(line.run);
    const lesson = lessons.find((l) => l.number === line.lesson);
    if (lesson === undefined) continue;
    if (line.text === null) {
      process.stdout.write(
        `${String(line.run).padStart(3)} ${String(line.lesson).padStart(6)}  FAILED: ${line.error}\n`,
      );
      continue;
    }
    const parsed = parse(line.text, lesson);
    const result = score(parsed.sets, goldFor(line.lesson));
    totals.right += result.pairsRight;
    totals.suggested += result.pairsSuggested;
    totals.gold += result.pairsGold;
    for (const set of parsed.sets) {
      const k = `${line.lesson}:${key(set)}`;
      const entry = seen.get(k) ?? {
        lesson: line.lesson,
        runs: new Set(),
        members: set,
      };
      entry.runs.add(line.run);
      seen.set(k, entry);
    }
    const dropped = parsed.unreadable
      ? "unreadable"
      : `${parsed.unknown}u ${parsed.repeated}r ${parsed.tooSmall}s`;
    process.stdout.write(
      [
        String(line.run).padStart(3),
        String(line.lesson).padStart(7),
        String(result.suggested).padStart(6),
        String(result.exact).padStart(7),
        String(result.sameOrder).padStart(7),
        String(result.wrong.length).padStart(7),
        String(result.missed.length).padStart(8),
        `${result.pairsRight}/${result.pairsSuggested}/${result.pairsGold}`.padStart(
          19,
        ),
        pct(result.pairsRight, result.pairsSuggested).padStart(11),
        pct(result.pairsRight, result.pairsGold).padStart(8),
        `  ${dropped}`,
      ].join("") + "\n",
    );
    for (const w of result.wrong) {
      process.stdout.write(
        `        wrong (${w.verdict}): ${show(w.members)}\n`,
      );
    }
    for (const m of result.missed) {
      process.stdout.write(`        missed: ${show(m)}\n`);
    }
  }

  process.stdout.write(
    `\nall runs, by pair: precision ${pct(totals.right, totals.suggested).trim()}, recall ${pct(totals.right, totals.gold).trim()}\n`,
  );

  // How much the answer moves between runs: each distinct set proposed, and
  // in how many of the runs it came back.
  process.stdout.write(`\nsets proposed, in how many of ${runs.size} runs:\n`);
  const goldKeys = new Set(
    goldSets.map((s) => `${s.lesson}:${key(s.members)}`),
  );
  for (const [k, entry] of [...seen.entries()].sort(
    (a, b) => a[1].lesson - b[1].lesson || b[1].runs.size - a[1].runs.size,
  )) {
    process.stdout.write(
      `  ${entry.runs.size}/${runs.size}  L${entry.lesson}  ${goldKeys.has(k) ? "gold " : "     "} ${show(entry.members)}\n`,
    );
  }
}

function readBatch(batch: string): Line[] {
  if (!existsSync(OUT)) throw new Error(`${OUT} does not exist`);
  return readFileSync(OUT, "utf8")
    .split("\n")
    .filter((text) => text.trim() !== "")
    .map((text) => JSON.parse(text) as Line)
    .filter((line) => line.batch === batch);
}

if (SELF_CHECK) {
  // The gold scored against itself, with no call: every figure must be whole.
  // If this is not 100% the scoring is wrong, and so is every run it scores.
  const lines: Line[] = lessons.map((lesson) => ({
    batch: "self-check",
    run: 1,
    lesson: lesson.number,
    at: new Date().toISOString(),
    ms: 0,
    model: null,
    system: "",
    user: "",
    text: JSON.stringify({
      sets: goldFor(lesson.number).map((members) => ({ members })),
    }),
    error: null,
  }));
  report(lines);
} else if (SCORE !== "") {
  report(readBatch(SCORE));
} else {
  const batch = new Date().toISOString();
  const provider = createDeepSeekProvider();
  process.stdout.write(
    `batch ${batch}: ${RUNS} runs over lessons ${lessons.map((l) => `${l.number} (${l.words.length} words, ${goldFor(l.number).length} sets)`).join(", ")}\nappending to ${OUT}\n`,
  );

  for (let run = 1; run <= RUNS; run++) {
    for (const lesson of lessons) {
      const { system, user } = buildPrompt(lesson);
      const started = Date.now();
      let text: string | null = null;
      let model: string | null = null;
      let error: string | null = null;
      try {
        ({ text, model } = await provider.complete({
          system,
          user,
          json: true,
        }));
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      const ms = Date.now() - started;
      const line: Line = {
        batch,
        run,
        lesson: lesson.number,
        at: new Date().toISOString(),
        ms,
        model,
        system,
        user,
        text,
        error,
      };
      // Written before anything else is done with the answer.
      appendFileSync(OUT, JSON.stringify(line) + "\n");
      process.stdout.write(
        `  run ${run} lesson ${lesson.number}: ${(ms / 1000).toFixed(1)}s${error === null ? "" : ` FAILED ${error}`}\n`,
      );
    }
  }

  report(readBatch(batch));
  process.stdout.write(`\nrescore with: --score ${batch}\n`);
}
