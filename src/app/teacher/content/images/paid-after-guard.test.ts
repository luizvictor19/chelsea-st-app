import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * A paid model call comes after the check of who may write content (#190).
 * Before #211 the word's suggestions paid the provider and only then found
 * that the account could not save; since 22dfccb every content action starts
 * with requireContentWriter(), which sends anyone else to /teacher. Nothing
 * held that order, so this test reads the actions' code: in every top-level
 * function that builds a paid provider, the check comes first.
 *
 * It reads text, so a provider built some other way escapes it. The list of
 * functions it found is asserted whole, so a new paid action shows up here
 * and is looked at, rather than passing in silence.
 */

const CONTENT = join(import.meta.dirname, "..");

const ACTION_FILES = [
  "images/actions.ts",
  "images/scene-actions.ts",
  "questions/suggest-actions.ts",
];

/** Where a paid text model is reached. */
const PAID = /\b(askModel|createClaudeProvider)\(/u;

/** Who may write content: the guard, or the function behind it. */
const GUARD = /\brequireContentWriter\(\)|\.rpc\(\s*["']can_write_content["']/u;

/** Comments out, so a guard named in a comment does not count. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

type Chunk = { name: string; body: string };

/**
 * Top-level functions, each from its declaration to the next one. What lies
 * between two functions (a constant, a type) rides with the one above, which
 * only makes a chunk longer, never moves a line ahead of its guard.
 */
function topLevelFunctions(source: string): Chunk[] {
  const start = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gmu;
  const marks = [...source.matchAll(start)];
  return marks.map((mark, i) => ({
    name: mark[1],
    body: source.slice(mark.index, marks[i + 1]?.index ?? source.length),
  }));
}

type Finding = { file: string; name: string; guarded: boolean };

/** Every function that reaches a paid model, and whether its guard is first. */
function paidFunctions(file: string, source: string): Finding[] {
  return topLevelFunctions(code(source))
    .filter((chunk) => PAID.test(chunk.body))
    .map((chunk) => {
      const paid = chunk.body.search(PAID);
      const guard = chunk.body.search(GUARD);
      return { file, name: chunk.name, guarded: guard >= 0 && guard < paid };
    });
}

function findings(): Finding[] {
  return ACTION_FILES.flatMap((file) =>
    paidFunctions(file, readFileSync(join(CONTENT, file), "utf8")),
  );
}

test("every action that reaches a paid model checks who may write first", () => {
  const unguarded = findings()
    .filter((finding) => !finding.guarded)
    .map((finding) => `${finding.file}: ${finding.name}`);
  assert.deepEqual(unguarded, []);
});

test("the paid actions found are the five known ones", () => {
  // suggestRepresentations reaches the model through suggestBatch, and
  // suggestContrastSets through proposeContrastSets; suggestQuestions
  // through suggest. A new name here is a new paid action: check its guard.
  assert.deepEqual(
    findings().map((finding) => `${finding.file}: ${finding.name}`),
    [
      "images/actions.ts: suggestBatch",
      "images/actions.ts: suggestSubject",
      "images/actions.ts: proposeContrastSets",
      "images/scene-actions.ts: suggestSceneSubject",
      "questions/suggest-actions.ts: suggest",
    ],
  );
});

test("a paid call ahead of the guard is found, by name", () => {
  const source = `
export async function early(id: string) {
  const answer = await askModel(createClaudeProvider(MODEL), prompt);
  const { supabase } = await requireContentWriter();
}

export async function late(id: string) {
  const { supabase } = await requireContentWriter();
  const answer = await askModel(provider, prompt);
}

async function byRpc() {
  const { data } = await supabase.rpc("can_write_content", {});
  return createClaudeProvider(MODEL);
}

function noGuard() {
  // requireContentWriter() is only named here
  return createClaudeProvider(MODEL);
}

function free() {
  return 1;
}
`;
  assert.deepEqual(paidFunctions("x.ts", source), [
    { file: "x.ts", name: "early", guarded: false },
    { file: "x.ts", name: "late", guarded: true },
    { file: "x.ts", name: "byRpc", guarded: true },
    { file: "x.ts", name: "noGuard", guarded: false },
  ]);
});
