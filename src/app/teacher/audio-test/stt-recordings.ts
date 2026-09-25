import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseCases, type SttCase } from "@/lib/stt/cases";

/**
 * Where the STT case recordings live, on the machine running the dev server.
 * fixtures/ is ignored by git whole: this is Luiz's voice, and it does not
 * leave his machine.
 */
export const STT_AUDIO_DIR = join(process.cwd(), "fixtures", "stt");

/**
 * The mode exists in development only. The recordings are written to the
 * server's disk, which on Vercel is neither persistent nor Luiz's.
 */
export function sttCasesEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

export function readSttCases(): SttCase[] {
  return parseCases(
    JSON.parse(
      readFileSync(join(process.cwd(), "scripts", "stt-cases.json"), "utf8"),
    ),
  );
}

export type RecordingStatus = {
  /** Seconds from the sidecar, null when it is missing or unreadable. */
  readonly seconds: number | null;
  readonly recordedAt: string | null;
};

/** One entry per case that has a recording on disk. */
export function readRecordingStatus(
  cases: readonly SttCase[],
): Record<string, RecordingStatus> {
  const status: Record<string, RecordingStatus> = {};
  for (const each of cases) {
    if (!existsSync(join(STT_AUDIO_DIR, `${each.id}.webm`))) continue;
    let seconds: number | null = null;
    let recordedAt: string | null = null;
    try {
      const sidecar = JSON.parse(
        readFileSync(join(STT_AUDIO_DIR, `${each.id}.json`), "utf8"),
      ) as { seconds?: unknown; recordedAt?: unknown };
      if (typeof sidecar.seconds === "number") seconds = sidecar.seconds;
      if (typeof sidecar.recordedAt === "string") {
        recordedAt = sidecar.recordedAt;
      }
    } catch {
      // Recorded without a readable sidecar: still recorded.
    }
    status[each.id] = { seconds, recordedAt };
  }
  return status;
}
