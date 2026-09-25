/**
 * The shape of one line of fixtures/stt/results/<date>.jsonl, written by
 * scripts/measure-stt.ts one call at a time and read by scripts/report-stt.ts.
 *
 * One line per paid call, appended the moment it returns, so an interrupted
 * run loses nothing it paid for.
 */

import type { ScoredPiece } from "./provider.ts";

export type ResultLine = {
  /** ISO time the call returned. */
  readonly at: string;
  readonly caseId: string;
  readonly provider: string;
  /** 1 or 2: the same audio sent twice, to see how much the answer moves. */
  readonly round: number;
  /**
   * Which recording was sent. A case recorded again is a different input, and
   * a result for the old take must not stand in for the new one.
   */
  readonly audioSha256: string;
  /** From the recording's sidecar, null when it had none. */
  readonly audioSeconds: number | null;
  readonly contentType: string;
  readonly model: string;
  /** Null exactly when `error` is not. */
  readonly text: string | null;
  readonly confidence: number | null;
  readonly pieces: readonly ScoredPiece[] | null;
  readonly ms: number | null;
  readonly error: string | null;
};

/** Identifies one call that should happen once per recording. */
export function resultKey(line: {
  caseId: string;
  provider: string;
  round: number;
  audioSha256: string;
}): string {
  return [line.caseId, line.provider, line.round, line.audioSha256].join("|");
}

function isResultLine(value: unknown): value is ResultLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.caseId === "string" &&
    typeof line.provider === "string" &&
    typeof line.round === "number" &&
    typeof line.audioSha256 === "string" &&
    (line.text === null || typeof line.text === "string") &&
    (line.error === null || typeof line.error === "string")
  );
}

/**
 * Every well formed line of a JSONL file. A torn last line, which is what a
 * process killed mid-write leaves, is skipped and counted rather than thrown:
 * everything before it is still good.
 */
export function parseResults(content: string): {
  lines: ResultLine[];
  unreadable: number;
} {
  const lines: ResultLine[] = [];
  let unreadable = 0;
  for (const raw of content.split("\n")) {
    if (raw.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isResultLine(parsed)) lines.push(parsed);
      else unreadable++;
    } catch {
      unreadable++;
    }
  }
  return { lines, unreadable };
}

/**
 * The keys already answered. A call that failed is not among them, so the
 * next run tries it again; its error line stays in the file as a record.
 */
export function answeredKeys(lines: readonly ResultLine[]): Set<string> {
  return new Set(
    lines.filter((line) => line.error === null).map((line) => resultKey(line)),
  );
}
