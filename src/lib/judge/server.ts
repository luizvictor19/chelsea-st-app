/**
 * The judge as the app runs it, on the server: the real provider, the checks
 * a take passes before anything is paid for, and the one call the app makes.
 *
 * The provider today is gpt-audio-1.5 (provisional; docs/spec-robin.md, "O
 * juiz"), with a timeout of its own: the script waits a minute, a tutor
 * cannot. Without OPENAI_API_KEY (a preview, a machine without it) the judge
 * is not configured and nothing is called.
 */

import {
  MAX_TAKE_BYTES,
  WAV_BITS,
  WAV_CHANNELS,
  WAV_SAMPLE_RATE,
  readWavHeader,
} from "../audio/wav.ts";
import { judgeTake, type FailureLog, type JudgedTake } from "./judge-take.ts";
import { createOpenAiAudioJudge } from "./openai-audio.ts";
import {
  JUDGE_MODELS,
  type AnswerJudge,
  type AnswerLanguage,
} from "./provider.ts";

// Builds a provider that reads a secret: never in the browser.
if (typeof window !== "undefined") {
  throw new Error(
    "judge/server.ts is server only and must not reach the browser",
  );
}

/**
 * Per call, provisional (adjust in the beta). On 2026-09-25, 130 calls of
 * gpt-audio-1.5 took 0.8 s at the least, 1.1 s at the median, 1.7 s at p95
 * and 3.1 s at the most: 15 s is past any of them and short of a person
 * giving up.
 */
export const APP_JUDGE_TIMEOUT_MS = 15_000;

/** The judge the app uses. */
export const APP_JUDGE = JUDGE_MODELS[0];

/** The real judge, or null when the key is not there. */
export function appJudge(): AnswerJudge | null {
  if (!process.env.OPENAI_API_KEY) return null;
  return createOpenAiAudioJudge(APP_JUDGE.id, APP_JUDGE.model, {
    timeoutMs: APP_JUDGE_TIMEOUT_MS,
  });
}

export type TakeRefusal =
  "empty" | "too-large" | "not-wav" | "not-mono" | "not-24khz" | "not-16bit";

/**
 * Whether a take is one the judge is sent, checked on its bytes, before any
 * call: the browser says what it likes about its own recording.
 *
 * The size is also the length: a data chunk must fit in the bytes there are
 * (readWavHeader), so at 24 kHz, mono, 16 bit, MAX_TAKE_BYTES is
 * MAX_TAKE_MS plus TAKE_MARGIN_MS of audio and nothing longer gets past it.
 */
export function validateTake(
  bytes: Uint8Array,
):
  | { readonly ok: true; readonly audioMs: number }
  | { readonly ok: false; readonly reason: TakeRefusal } {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_TAKE_BYTES) return { ok: false, reason: "too-large" };
  const read = readWavHeader(bytes);
  if (!read.ok) return { ok: false, reason: "not-wav" };
  const { header } = read;
  if (header.channels !== WAV_CHANNELS)
    return { ok: false, reason: "not-mono" };
  if (header.sampleRate !== WAV_SAMPLE_RATE) {
    return { ok: false, reason: "not-24khz" };
  }
  if (header.bits !== WAV_BITS) return { ok: false, reason: "not-16bit" };
  if (header.dataBytes === 0) return { ok: false, reason: "empty" };
  return { ok: true, audioMs: Math.round(header.durationMs) };
}

export type JudgeAnswer =
  | { readonly kind: "refused"; readonly reason: TakeRefusal }
  | { readonly kind: "unconfigured" }
  | { readonly kind: "judged"; readonly take: JudgedTake };

/**
 * Validates the take, then judges it with `judge` (appJudge() in the app, the
 * fake in the tests). A refused take never reaches the judge.
 */
export async function judgeAnswer(
  judge: AnswerJudge | null,
  input: {
    readonly audio: Uint8Array;
    readonly question: string;
    readonly expected: string;
    readonly answerLanguage: AnswerLanguage;
  },
  options: { readonly log?: FailureLog } = {},
): Promise<JudgeAnswer> {
  const valid = validateTake(input.audio);
  if (!valid.ok) return { kind: "refused", reason: valid.reason };
  if (judge === null) return { kind: "unconfigured" };
  const take = await judgeTake(
    judge,
    { ...input, audioMs: valid.audioMs },
    options,
  );
  return { kind: "judged", take };
}
