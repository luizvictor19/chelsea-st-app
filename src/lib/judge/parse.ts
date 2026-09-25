/**
 * Reading the judge's answer. Strict mode on the tool already constrains the
 * shape, and this checks it again rather than trusting it: a field read wrong
 * here becomes a wrong count in the report, and nothing downstream would see
 * it.
 *
 * It reads and checks the types; it never repairs. A contradiction in the
 * answer (says it matches and lists differences) or a difference that is not
 * one is the model's, and it is kept for the report to count, not smoothed
 * over here.
 */

import {
  DIFFERENCE_KINDS,
  NO_ENGLISH_REASONS,
  type Difference,
  type DifferenceKind,
  type Judgement,
  type NoEnglishReason,
} from "./provider.ts";

function isKind(value: unknown): value is DifferenceKind {
  return DIFFERENCE_KINDS.some((kind) => kind === value);
}

function isReason(value: unknown): value is NoEnglishReason {
  return NO_ENGLISH_REASONS.some((reason) => reason === value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseDifference(value: unknown, index: number): Difference {
  if (typeof value !== "object" || value === null) {
    throw new Error(`differences[${index}] is not an object`);
  }
  const { expected, said, kind } = value as Record<string, unknown>;
  if (!nullableString(expected) || !nullableString(said)) {
    throw new Error(
      `differences[${index}]: expected and said must be text or null`,
    );
  }
  if (!isKind(kind)) {
    throw new Error(`differences[${index}]: unknown kind ${String(kind)}`);
  }
  return { expected, said, kind };
}

/**
 * The judgement in the tool call's arguments, or an exception naming the
 * first thing wrong.
 */
export function parseJudgement(argumentsJson: string): Judgement {
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new Error("Judgement is not JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Judgement is not an object");
  }
  const { heard, englishSpeech, noEnglishReason, matches, differences } =
    value as Record<string, unknown>;

  if (typeof heard !== "string") throw new Error("heard must be text");
  if (typeof englishSpeech !== "boolean") {
    throw new Error("englishSpeech must be true or false");
  }
  if (noEnglishReason !== null && !isReason(noEnglishReason)) {
    throw new Error(`unknown noEnglishReason ${String(noEnglishReason)}`);
  }
  if (typeof matches !== "boolean") {
    throw new Error("matches must be true or false");
  }
  if (!Array.isArray(differences)) {
    throw new Error("differences must be a list");
  }

  return {
    heard,
    englishSpeech,
    noEnglishReason,
    matches,
    differences: differences.map(parseDifference),
  };
}

/**
 * Why this difference is not one, or null when it is well formed. Each kind
 * has one shape: missing names the expected word and nothing said, extra the
 * reverse, replaced both and they differ.
 *
 * Reported, not refused. On 2026-09-25 gpt-audio-mini heard g02 right ("The
 * book are on the table") and named the is/are swap, and also listed every
 * word it got right as "missing" with the same word said. Refusing the whole
 * answer for that threw away a correct verdict; keeping it lets the report
 * count the noise, and the scoring already refuses to call such a list "only
 * the error".
 */
export function malformedDifference(difference: Difference): string | null {
  const { expected, said, kind } = difference;
  if (kind === "missing" && (expected === null || said !== null)) {
    return "missing needs expected and no said";
  }
  if (kind === "extra" && (said === null || expected !== null)) {
    return "extra needs said and no expected";
  }
  if (kind === "replaced" && (expected === null || said === null)) {
    return "replaced needs expected and said";
  }
  if (
    expected !== null &&
    said !== null &&
    expected.trim().toLowerCase() === said.trim().toLowerCase()
  ) {
    return "the same word on both sides";
  }
  return null;
}

/**
 * Where the answer contradicts itself, in words, or null when it does not.
 * Counted by the report; the judgement is kept as the model gave it.
 */
export function contradiction(judgement: Judgement): string | null {
  if (judgement.matches && judgement.differences.length > 0) {
    return "matches but lists differences";
  }
  if (
    !judgement.matches &&
    judgement.differences.length === 0 &&
    judgement.englishSpeech
  ) {
    return "does not match but lists no difference";
  }
  if (judgement.englishSpeech && judgement.noEnglishReason !== null) {
    return "English speech with a reason for none";
  }
  if (!judgement.englishSpeech && judgement.noEnglishReason === null) {
    return "no English speech and no reason";
  }
  return null;
}
