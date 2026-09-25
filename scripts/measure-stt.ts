/**
 * Sends every recorded STT case to every transcriber, twice, and writes each
 * answer the moment it arrives.
 *
 * The recordings are fixtures/stt/<id>.webm, made on /teacher/audio-test in
 * development, with a sidecar <id>.json holding the duration. The cases are
 * scripts/stt-cases.json. A case with no recording is skipped and named.
 *
 * Output is fixtures/stt/results/<YYYY-MM-DD>.jsonl, one line per call,
 * appended. Killed halfway, it keeps everything it paid for; run again the
 * same day, it skips every call already answered for the same recording and
 * retries the ones that failed. A case recorded again is sent again, because
 * the key includes the audio's hash.
 *
 * Sequential on purpose, one call at a time: the latency is part of what is
 * measured, and concurrent calls would be measuring contention.
 *
 * It costs real requests to two paid APIs: 30 cases × 3 providers × 2 rounds
 * is 180 calls, on audio of a few seconds each, well under a dollar.
 *
 *   node --env-file=.env.local scripts/measure-stt.ts
 *   node --env-file=.env.local scripts/measure-stt.ts --cases g01,g02 \
 *     --providers deepgram-nova-3 --rounds 1
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseCases } from "../src/lib/stt/cases.ts";
import { createDeepgramTranscriber } from "../src/lib/stt/deepgram.ts";
import { createOpenAiTranscriber } from "../src/lib/stt/openai.ts";
import {
  isSttModelId,
  type SpeechToText,
  type SttModelId,
} from "../src/lib/stt/provider.ts";
import {
  answeredKeys,
  parseResults,
  resultKey,
  type ResultLine,
} from "../src/lib/stt/results.ts";

const args = process.argv.slice(2);
function option(name: string): string | null {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return null;
  const value = args[at + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

const ROOT = join(import.meta.dirname, "..");
const AUDIO_DIR = join(ROOT, "fixtures", "stt");
const RESULTS_DIR = join(AUDIO_DIR, "results");

/** The page only accepts webm, so this is right whenever the sidecar is lost. */
const DEFAULT_CONTENT_TYPE = "audio/webm";

const TRANSCRIBERS: Record<SttModelId, () => SpeechToText> = {
  "openai-gpt-4o-mini-transcribe": () =>
    createOpenAiTranscriber("gpt-4o-mini-transcribe"),
  "openai-gpt-4o-transcribe": () =>
    createOpenAiTranscriber("gpt-4o-transcribe"),
  "deepgram-nova-3": () => createDeepgramTranscriber(),
};

const KEY_FOR: Record<SttModelId, string> = {
  "openai-gpt-4o-mini-transcribe": "OPENAI_API_KEY",
  "openai-gpt-4o-transcribe": "OPENAI_API_KEY",
  "deepgram-nova-3": "DEEPGRAM_API_KEY",
};

/** Local date, because the file is named for the day Luiz ran it. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

type Sidecar = { seconds: number | null; mimeType: string };

/**
 * What the page wrote beside the recording. Missing or unreadable, the
 * duration is unknown and the type falls back to what the page accepts.
 */
function readSidecar(id: string): Sidecar {
  const path = join(AUDIO_DIR, `${id}.json`);
  const fallback = { seconds: null, mimeType: DEFAULT_CONTENT_TYPE };
  if (!existsSync(path)) return fallback;
  try {
    const sidecar = JSON.parse(readFileSync(path, "utf8")) as {
      seconds?: unknown;
      mimeType?: unknown;
    };
    return {
      seconds: typeof sidecar.seconds === "number" ? sidecar.seconds : null,
      mimeType:
        typeof sidecar.mimeType === "string" && sidecar.mimeType !== ""
          ? sidecar.mimeType
          : DEFAULT_CONTENT_TYPE,
    };
  } catch {
    return fallback;
  }
}

const cases = parseCases(
  JSON.parse(readFileSync(join(ROOT, "scripts", "stt-cases.json"), "utf8")),
);
const onlyCases = option("cases")?.split(",") ?? null;
const providerIds =
  option("providers")?.split(",") ?? Object.keys(TRANSCRIBERS);
const rounds = Number(option("rounds") ?? "2");

for (const id of providerIds) {
  if (!isSttModelId(id)) {
    console.error(`Unknown provider: ${id}`);
    process.exit(1);
  }
}
const providers = providerIds.filter(isSttModelId);

// Every call would fail and be written down as a failure; refuse up front.
const missingKeys = [...new Set(providers.map((id) => KEY_FOR[id]))].filter(
  (name) => !process.env[name],
);
if (missingKeys.length > 0) {
  console.error(
    `Missing ${missingKeys.join(", ")}. Run with node --env-file=.env.local, or narrow --providers.`,
  );
  process.exit(1);
}
if (!Number.isInteger(rounds) || rounds < 1) {
  console.error("--rounds must be a positive integer");
  process.exit(1);
}

mkdirSync(RESULTS_DIR, { recursive: true });
const outPath = join(RESULTS_DIR, `${today()}.jsonl`);
const previous = existsSync(outPath)
  ? parseResults(readFileSync(outPath, "utf8"))
  : { lines: [], unreadable: 0 };
const done = answeredKeys(previous.lines);
if (previous.unreadable > 0) {
  console.warn(
    `${previous.unreadable} unreadable line(s) in ${outPath}, ignored`,
  );
}

const missing: string[] = [];
let called = 0;
let skipped = 0;
let failed = 0;

for (const each of cases) {
  if (onlyCases !== null && !onlyCases.includes(each.id)) continue;
  const audioPath = join(AUDIO_DIR, `${each.id}.webm`);
  if (!existsSync(audioPath)) {
    missing.push(each.id);
    continue;
  }
  const audio = readFileSync(audioPath);
  const audioSha256 = createHash("sha256").update(audio).digest("hex");
  const { seconds: audioSeconds, mimeType: contentType } = readSidecar(each.id);

  for (const provider of providers) {
    const transcriber = TRANSCRIBERS[provider]();
    for (let round = 1; round <= rounds; round++) {
      const key = { caseId: each.id, provider, round, audioSha256 };
      if (done.has(resultKey(key))) {
        skipped++;
        continue;
      }

      let line: ResultLine;
      try {
        const result = await transcriber.transcribe({
          audio,
          contentType,
        });
        line = {
          at: new Date().toISOString(),
          ...key,
          audioSeconds,
          contentType,
          model: result.model,
          text: result.text,
          confidence: result.confidence,
          pieces: result.pieces,
          ms: result.ms,
          error: null,
        };
        console.log(
          `${each.id} ${provider} #${round} ${result.ms}ms  ${result.text}`,
        );
      } catch (cause) {
        failed++;
        line = {
          at: new Date().toISOString(),
          ...key,
          audioSeconds,
          contentType,
          model: provider,
          text: null,
          confidence: null,
          pieces: null,
          ms: null,
          error: cause instanceof Error ? cause.message : String(cause),
        };
        console.log(`${each.id} ${provider} #${round} ERROR ${line.error}`);
      }
      // Written before the next call starts, so nothing paid for is held
      // only in memory.
      appendFileSync(outPath, `${JSON.stringify(line)}\n`);
      called++;
    }
  }
}

console.log(
  `\n${called} call(s), ${failed} failed, ${skipped} already in ${outPath}`,
);
if (missing.length > 0) {
  console.log(`Not recorded yet: ${missing.join(", ")}`);
}
