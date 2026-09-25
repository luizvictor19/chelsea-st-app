/**
 * The only file that knows the Deepgram API and holds its key.
 *
 * Read on 2026-09-25 from the pre-recorded reference,
 * https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded:
 * raw audio in the body, `Authorization: Token <key>`, and the answer carries
 * a confidence for the alternative and one per word.
 *
 * Every option not named here is left at its default, and the defaults
 * matter to this measurement, so they are written down:
 *
 *   punctuate false     the report strips punctuation anyway.
 *   smart_format false  on, it writes "three" as "3", and the report compares
 *                       words.
 *   filler_words false  "um" and "uh" are dropped. The hesitation cases will
 *                       show that; turning it on is a second configuration
 *                       to measure, not a fix to slip in.
 */

import type { ScoredPiece, SpeechToText, Transcription } from "./provider.ts";

// This module reads a secret, so it must never be bundled for the browser.
if (typeof window !== "undefined") {
  throw new Error("deepgram.ts is server only and must not reach the browser");
}

const MODEL = "nova-3";
const ENDPOINT = `https://api.deepgram.com/v1/listen?model=${MODEL}&language=en`;

/** Per call timeout. A tutor that waits longer than this has already failed. */
const TIMEOUT_MS = 60_000;

/**
 * Read per call rather than at module load: the CI build runs with no key,
 * and importing this file must not fail there.
 */
function apiKey(): string {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    throw new Error("Missing environment variable: DEEPGRAM_API_KEY");
  }
  return key;
}

type Parsed = {
  text: string;
  confidence: number | null;
  pieces: ScoredPiece[] | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** results.channels[0].alternatives[0], narrowed by hand from unknown. */
function parse(body: unknown): Parsed | null {
  const channels = record(record(body)?.results)?.channels;
  if (!Array.isArray(channels) || channels.length === 0) return null;
  const alternatives = record(channels[0])?.alternatives;
  if (!Array.isArray(alternatives) || alternatives.length === 0) return null;
  const best = record(alternatives[0]);
  if (best === null || typeof best.transcript !== "string") return null;

  const confidence =
    typeof best.confidence === "number" ? best.confidence : null;

  let pieces: ScoredPiece[] | null = null;
  if (Array.isArray(best.words)) {
    pieces = [];
    for (const item of best.words) {
      const word = record(item);
      if (
        word === null ||
        typeof word.word !== "string" ||
        typeof word.confidence !== "number"
      ) {
        pieces = null;
        break;
      }
      pieces.push({ text: word.word, confidence: word.confidence });
    }
  }
  return { text: best.transcript, confidence, pieces };
}

export function createDeepgramTranscriber(): SpeechToText {
  return {
    id: "deepgram-nova-3",

    async transcribe({ audio, contentType }): Promise<Transcription> {
      const started = performance.now();
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Token ${apiKey()}`,
          // The bare container type: the codec parameter adds nothing the
          // server does not sniff from the bytes.
          "content-type": contentType.split(";")[0].trim(),
        },
        body: new Uint8Array(audio),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      const body: unknown = response.ok ? await response.json() : null;
      const ms = performance.now() - started;

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Deepgram transcription failed: ${response.status} ${detail.slice(0, 300)}`,
        );
      }

      const parsed = parse(body);
      if (parsed === null) {
        throw new Error("Deepgram answered without a transcript");
      }
      return {
        text: parsed.text,
        // Deepgram scores an empty transcript too, usually 0. Kept as it
        // came: it is the provider's number, not ours.
        confidence: parsed.confidence,
        pieces: parsed.pieces,
        ms: Math.round(ms),
        model: MODEL,
      };
    },
  };
}
