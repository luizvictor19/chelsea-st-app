/**
 * The only file that knows the OpenAI transcription API and holds its key.
 *
 * Read on 2026-09-25 from the API reference for POST /v1/audio/transcriptions:
 * `include[]=logprobs` returns a logprob per token, and only for
 * gpt-4o-transcribe and gpt-4o-mini-transcribe, with response_format json.
 * Docs: https://developers.openai.com/api/reference/resources/audio
 */

import type { ScoredPiece, SpeechToText, Transcription } from "./provider.ts";

// This module reads a secret, so it must never be bundled for the browser.
if (typeof window !== "undefined") {
  throw new Error("openai.ts is server only and must not reach the browser");
}

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";

/** Per call timeout. A tutor that waits longer than this has already failed. */
const TIMEOUT_MS = 60_000;

type OpenAiModel = "gpt-4o-mini-transcribe" | "gpt-4o-transcribe";

/**
 * Read per call rather than at module load: the CI build runs with no key,
 * and importing this file must not fail there.
 */
function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Missing environment variable: OPENAI_API_KEY");
  }
  return key;
}

/**
 * The upload needs a filename whose extension names the container: the API
 * decides the format from it and refuses a name it does not recognise.
 */
function filenameFor(contentType: string): string {
  const base = contentType.split(";")[0].trim().toLowerCase();
  if (base === "audio/webm") return "audio.webm";
  if (base === "audio/mp4") return "audio.mp4";
  if (base === "audio/ogg") return "audio.ogg";
  if (base === "audio/wav" || base === "audio/x-wav") return "audio.wav";
  if (base === "audio/mpeg") return "audio.mp3";
  throw new Error(`No known file extension for ${contentType}`);
}

type Parsed = { text: string; pieces: ScoredPiece[] | null };

/** The fields this needs, narrowed by hand from unknown. */
function parse(body: unknown): Parsed | null {
  if (typeof body !== "object" || body === null) return null;
  const text = (body as { text?: unknown }).text;
  if (typeof text !== "string") return null;

  const logprobs = (body as { logprobs?: unknown }).logprobs;
  if (!Array.isArray(logprobs)) return { text, pieces: null };

  const pieces: ScoredPiece[] = [];
  for (const item of logprobs) {
    if (typeof item !== "object" || item === null)
      return { text, pieces: null };
    const token = (item as { token?: unknown }).token;
    const logprob = (item as { logprob?: unknown }).logprob;
    if (typeof token !== "string" || typeof logprob !== "number") {
      return { text, pieces: null };
    }
    pieces.push({ text: token, confidence: Math.exp(logprob) });
  }
  return { text, pieces };
}

/**
 * One number for the whole utterance: the geometric mean of the token
 * probabilities, exp of the mean logprob. It is derived from what the API
 * returned and nothing else. An answer with no tokens (silence answered with
 * an empty string) has nothing to average, so it is null rather than 1.
 */
export function utteranceConfidence(
  pieces: readonly ScoredPiece[] | null,
): number | null {
  if (pieces === null || pieces.length === 0) return null;
  const sum = pieces.reduce(
    (acc, piece) => acc + Math.log(piece.confidence),
    0,
  );
  return Math.exp(sum / pieces.length);
}

export function createOpenAiTranscriber(model: OpenAiModel): SpeechToText {
  return {
    id:
      model === "gpt-4o-transcribe"
        ? "openai-gpt-4o-transcribe"
        : "openai-gpt-4o-mini-transcribe",

    async transcribe({ audio, contentType }): Promise<Transcription> {
      const form = new FormData();
      // Copied into a fresh buffer: Blob wants an ArrayBuffer-backed view, and
      // a Buffer from readFile may be a slice of a shared pool.
      form.append(
        "file",
        new Blob([new Uint8Array(audio)], { type: contentType }),
        filenameFor(contentType),
      );
      form.append("model", model);
      // Fixed, not detected: the student is answering in English, and a
      // detector that hears Portuguese would answer in Portuguese.
      form.append("language", "en");
      form.append("response_format", "json");
      form.append("include[]", "logprobs");
      // No `prompt`, deliberately. See provider.ts.

      const started = performance.now();
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey()}` },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      const body: unknown = response.ok ? await response.json() : null;
      const ms = performance.now() - started;

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `OpenAI transcription failed: ${response.status} ${detail.slice(0, 300)}`,
        );
      }

      const parsed = parse(body);
      if (parsed === null) {
        throw new Error("OpenAI transcription answered without text");
      }
      return {
        text: parsed.text,
        confidence: utteranceConfidence(parsed.pieces),
        pieces: parsed.pieces,
        ms: Math.round(ms),
        model,
      };
    },
  };
}
