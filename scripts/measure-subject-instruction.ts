/**
 * What the subject proposal answers for the words whose picture used to be
 * a comparison, and for words that already came out right.
 *
 * Contrast adjectives were once drawn as two objects in one scene ("two
 * identical boxes side by side, one much larger than the other"), because the
 * contrast was being solved inside a single picture. That was abandoned after
 * four attempts: the image model draws the pair and cannot say which is
 * which. Contrast now lives between pictures (0022), each word with its own
 * picture of one subject, and the proposal has to stop asking for two.
 *
 * The eight words below are the ones that were drawn as a comparison, or
 * could be; the five controls already came out right and must not get worse.
 * Kind and style are the ones the project had on 2026-09-22, read through the
 * read-only Supabase MCP.
 *
 * It writes nothing to the database. Every call is appended to the JSONL file
 * the moment it returns, with the whole prompt and the whole answer, under a
 * label (before, after), so the two prompts are compared from the file and a
 * run cut short keeps every call it paid for.
 *
 *   node --env-file=.env.local scripts/measure-subject-instruction.ts --label before
 *   node --env-file=.env.local scripts/measure-subject-instruction.ts --label after
 *   node scripts/measure-subject-instruction.ts --compare <batch> <batch>
 */
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ImageStyle } from "../src/lib/images/style.ts";
import { buildSubjectPrompt, parseSubject } from "../src/lib/images/subject.ts";
import { createDeepSeekProvider } from "../src/lib/text/deepseek.ts";

const args = process.argv.slice(2);
/* As in measure-suggestion-batch.ts: a flag with nothing after it falls back. */
function option(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const value = args[at + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

const ROOT = join(import.meta.dirname, "..");
const OUT = option("out", join(ROOT, "fixtures", "subject-instruction.jsonl"));
const RUNS = Number(option("runs", "3"));
const LABEL = option("label", "");

type Word = {
  readonly term: string;
  readonly kind: string;
  readonly style: ImageStyle;
  readonly control: boolean;
};

const WORDS: readonly Word[] = [
  { term: "large", kind: "figure", style: "realistic", control: false },
  { term: "small", kind: "figure", style: "flat", control: false },
  { term: "long", kind: "figure", style: "flat", control: false },
  { term: "short", kind: "figure", style: "flat", control: false },
  { term: "open", kind: "figure", style: "flat", control: false },
  { term: "closed", kind: "figure", style: "flat", control: false },
  { term: "sitting", kind: "pose", style: "flat", control: false },
  { term: "standing", kind: "pose", style: "flat", control: false },
  { term: "book", kind: "photo", style: "flat", control: true },
  { term: "chair", kind: "photo", style: "flat", control: true },
  { term: "door", kind: "photo", style: "flat", control: true },
  { term: "clock", kind: "photo", style: "flat", control: true },
  { term: "on", kind: "figure", style: "flat", control: true },
];

type Line = {
  readonly batch: string;
  readonly label: string;
  readonly run: number;
  readonly term: string;
  readonly kind: string;
  readonly style: string;
  readonly ms: number;
  readonly system: string;
  readonly user: string;
  readonly text: string | null;
  readonly subject: string | null;
  readonly error: string | null;
};

/*
 * A flag for a reader, not a verdict: the wording a comparison of two things
 * tends to take. A preposition relates two things by nature (a ball on a
 * table) and will trip it without being a comparison, which is why the table
 * prints the phrases whole and the judgement is made on them.
 */
const COMPARISON =
  /\b(two|both|pair|side by side|beside|next to|than|compared|versus|vs|other|another|smaller|larger|bigger|longer|shorter)\b/iu;

function read(batch: string): Line[] {
  return readFileSync(OUT, "utf8")
    .split("\n")
    .filter((text) => text.trim() !== "")
    .map((text) => JSON.parse(text) as Line)
    .filter((line) => line.batch === batch);
}

if (args[0] === "--compare") {
  const [before, after] = [read(args[1]), read(args[2])];
  for (const word of WORDS) {
    process.stdout.write(
      `\n${word.term} (${word.kind}, ${word.style})${word.control ? " control" : ""}\n`,
    );
    for (const [label, lines] of [
      ["before", before],
      ["after", after],
    ] as const) {
      for (const line of lines.filter((l) => l.term === word.term)) {
        const phrase =
          line.subject ?? `(no subject: ${line.error ?? line.text})`;
        const flag = COMPARISON.test(phrase) ? "?" : " ";
        process.stdout.write(`  ${label.padEnd(6)} ${flag} ${phrase}\n`);
      }
    }
  }
} else {
  if (LABEL === "")
    throw new Error("--label is required, e.g. before or after");
  const batch = `${LABEL}@${new Date().toISOString()}`;
  const provider = createDeepSeekProvider();
  process.stdout.write(`batch ${batch}, appending to ${OUT}\n`);
  for (let run = 1; run <= RUNS; run++) {
    for (const word of WORDS) {
      const { system, user } = buildSubjectPrompt(
        word.term,
        word.kind,
        word.style,
      );
      const started = Date.now();
      let text: string | null = null;
      let error: string | null = null;
      try {
        ({ text } = await provider.complete({ system, user, json: true }));
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      const line: Line = {
        batch,
        label: LABEL,
        run,
        term: word.term,
        kind: word.kind,
        style: word.style,
        ms: Date.now() - started,
        system,
        user,
        text,
        subject: text === null ? null : parseSubject(text),
        error,
      };
      // Written before anything else is done with the answer.
      appendFileSync(OUT, JSON.stringify(line) + "\n");
      process.stdout.write(
        `  ${run} ${word.term}: ${line.subject ?? line.error}\n`,
      );
    }
  }
  process.stdout.write(`\nbatch ${batch}\n`);
}
