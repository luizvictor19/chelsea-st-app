/**
 * One line of fixtures/stt/judge-results/<date>.jsonl, written by
 * scripts/measure-judge.ts one call at a time and read by
 * scripts/report-judge.ts. Kept apart from the transcription results: the
 * two measure different things and must not be read as one.
 */

import type { Judgement, JudgeUsage } from "./provider.ts";

export type JudgeLine = {
  readonly at: string;
  readonly caseId: string;
  readonly provider: string;
  readonly round: number;
  /** Hash of the webm on disk: a case recorded again is a new input. */
  readonly audioSha256: string;
  readonly audioSeconds: number | null;
  readonly model: string;
  /**
   * promptFingerprint() of the wording the call was made with. Absent on the
   * lines written before it existed, which all used the first wording; the
   * report calls those "legacy".
   */
  readonly prompt?: string;
  /** What the judge was asked to compare against, as sent. */
  readonly expected: string | null;
  /** Null exactly when `error` is not. */
  readonly judgement: Judgement | null;
  readonly raw: string | null;
  readonly usage: JudgeUsage | null;
  readonly ms: number | null;
  readonly error: string | null;
};

/** The prompt of a line written before the fingerprint existed. */
export const LEGACY_PROMPT = "legacy";

export function judgeKey(line: {
  caseId: string;
  provider: string;
  round: number;
  audioSha256: string;
  prompt?: string;
}): string {
  return [
    line.caseId,
    line.provider,
    line.round,
    line.audioSha256,
    line.prompt ?? LEGACY_PROMPT,
  ].join("|");
}

function isJudgeLine(value: unknown): value is JudgeLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.caseId === "string" &&
    typeof line.provider === "string" &&
    typeof line.round === "number" &&
    typeof line.audioSha256 === "string" &&
    (line.prompt === undefined || typeof line.prompt === "string") &&
    (line.judgement === null || typeof line.judgement === "object") &&
    (line.error === null || typeof line.error === "string")
  );
}

/** Every well formed line; a torn last line is counted, not thrown. */
export function parseJudgeLines(content: string): {
  lines: JudgeLine[];
  unreadable: number;
} {
  const lines: JudgeLine[] = [];
  let unreadable = 0;
  for (const raw of content.split("\n")) {
    if (raw.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isJudgeLine(parsed)) lines.push(parsed);
      else unreadable++;
    } catch {
      unreadable++;
    }
  }
  return { lines, unreadable };
}

/** Keys already answered; a failed call is retried on the next run. */
export function answeredJudgeKeys(lines: readonly JudgeLine[]): Set<string> {
  return new Set(
    lines.filter((line) => line.error === null).map((line) => judgeKey(line)),
  );
}
