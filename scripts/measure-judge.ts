/**
 * Sends every recorded STT case to every answer judge, twice, with the
 * question and the expected answer, and writes each answer the moment it
 * arrives.
 *
 * Same recordings as measure-stt.ts (fixtures/stt/<id>.webm), same rules:
 * fixtures/stt/judge-results/<YYYY-MM-DD>.jsonl, one line per call, appended;
 * run again the same day, it skips what was answered for the same recording
 * under the same prompt, and retries what failed. A changed prompt is a new
 * measurement: see promptFingerprint. Sequential, so latency is not contention.
 *
 * The audio models take wav or mp3 only, and the recordings are webm, so each
 * one is converted with ffmpeg before it is sent. Mono, 24 kHz, 16 bit PCM.
 * The rate was checked on 2026-09-25 on c01, both models: 16, 24 and 48 kHz
 * gave the same answer and the same 17 audio tokens, so the rate does not
 * change what the model hears and 24 kHz is the models' own output rate.
 * The conversion is this script's, not the judge's: in the tutor, where the
 * webm becomes wav is still to be decided.
 *
 * Paid: 30 cases × 2 judges × 2 rounds is 120 calls, a few cents.
 *
 *   node --env-file=.env.local scripts/measure-judge.ts
 *   node --env-file=.env.local scripts/measure-judge.ts --cases g01,g02 \
 *     --judges openai-gpt-audio-mini --rounds 1
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createOpenAiAudioJudge } from "../src/lib/judge/openai-audio.ts";
import { promptFingerprint } from "../src/lib/judge/prompt.ts";
import {
  JUDGE_MODELS,
  isJudgeModelId,
  type AnswerJudge,
} from "../src/lib/judge/provider.ts";
import {
  answeredJudgeKeys,
  judgeKey,
  parseJudgeLines,
  type JudgeLine,
} from "../src/lib/judge/results.ts";
import { parseCases } from "../src/lib/stt/cases.ts";

const args = process.argv.slice(2);
function option(name: string): string | null {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return null;
  const value = args[at + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

const ROOT = join(import.meta.dirname, "..");
const AUDIO_DIR = join(ROOT, "fixtures", "stt");
const RESULTS_DIR = join(AUDIO_DIR, "judge-results");

const SAMPLE_RATE = 24_000;

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function readSeconds(id: string): number | null {
  try {
    const sidecar = JSON.parse(
      readFileSync(join(AUDIO_DIR, `${id}.json`), "utf8"),
    ) as { seconds?: unknown };
    return typeof sidecar.seconds === "number" ? sidecar.seconds : null;
  } catch {
    return null;
  }
}

function toWav(path: string): Uint8Array {
  const result = spawnSync(
    "ffmpeg",
    [
      "-loglevel",
      "error",
      "-i",
      path,
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-c:a",
      "pcm_s16le",
      "-f",
      "wav",
      "pipe:1",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error !== undefined) {
    throw new Error(`ffmpeg could not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed on ${path}: ${result.stderr.toString()}`);
  }
  return new Uint8Array(result.stdout);
}

const cases = parseCases(
  JSON.parse(readFileSync(join(ROOT, "scripts", "stt-cases.json"), "utf8")),
);
const onlyCases = option("cases")?.split(",") ?? null;
const judgeIds =
  option("judges")?.split(",") ?? JUDGE_MODELS.map((model) => model.id);
const rounds = Number(option("rounds") ?? "2");

for (const id of judgeIds) {
  if (!isJudgeModelId(id)) {
    console.error(`Unknown judge: ${id}`);
    process.exit(1);
  }
}
if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY. Run with node --env-file=.env.local.");
  process.exit(1);
}
if (!Number.isInteger(rounds) || rounds < 1) {
  console.error("--rounds must be a positive integer");
  process.exit(1);
}

const judges: AnswerJudge[] = JUDGE_MODELS.filter((model) =>
  judgeIds.includes(model.id),
).map((model) => createOpenAiAudioJudge(model.id, model.model));

const prompt = promptFingerprint();
console.log(`prompt ${prompt}`);

mkdirSync(RESULTS_DIR, { recursive: true });
const outPath = join(RESULTS_DIR, `${today()}.jsonl`);
const previous = existsSync(outPath)
  ? parseJudgeLines(readFileSync(outPath, "utf8"))
  : { lines: [], unreadable: 0 };
const done = answeredJudgeKeys(previous.lines);
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
  const webmPath = join(AUDIO_DIR, `${each.id}.webm`);
  if (!existsSync(webmPath)) {
    missing.push(each.id);
    continue;
  }
  const audioSha256 = createHash("sha256")
    .update(readFileSync(webmPath))
    .digest("hex");
  const audioSeconds = readSeconds(each.id);
  let wav: Uint8Array | null = null;

  for (const judge of judges) {
    for (let round = 1; round <= rounds; round++) {
      const key = {
        caseId: each.id,
        provider: judge.id,
        round,
        audioSha256,
        prompt,
      };
      if (done.has(judgeKey(key))) {
        skipped++;
        continue;
      }
      // Converted once per case, and only if a call is actually made.
      wav ??= toWav(webmPath);

      const base = {
        at: "",
        ...key,
        audioSeconds,
        expected: each.expected,
      };
      let line: JudgeLine;
      try {
        const result = await judge.judge({
          audio: wav,
          contentType: "audio/wav",
          question: each.question,
          expected: each.expected,
        });
        line = {
          ...base,
          at: new Date().toISOString(),
          model: result.model,
          judgement: result.judgement,
          raw: result.raw,
          usage: result.usage,
          ms: result.ms,
          error: null,
        };
        console.log(
          `${each.id} ${judge.id} #${round} ${result.ms}ms  matches=${result.judgement.matches} english=${result.judgement.englishSpeech}  ${result.judgement.heard}`,
        );
      } catch (cause) {
        failed++;
        line = {
          ...base,
          at: new Date().toISOString(),
          model: judge.id,
          judgement: null,
          raw: null,
          usage: null,
          ms: null,
          error: cause instanceof Error ? cause.message : String(cause),
        };
        console.log(`${each.id} ${judge.id} #${round} ERROR ${line.error}`);
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
