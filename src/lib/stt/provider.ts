/**
 * Speech to text behind one interface, the same shape the image and text
 * providers use and for the same reason: the measurement this module exists
 * for compares transcribers, and a comparison is only honest if swapping the
 * provider touches one file.
 *
 * What is being measured is not accuracy in general. It is whether the
 * transcriber keeps the student's mistake. A model that hears "the book are on
 * the table" and writes "the book is on the table" has made the tutor praise
 * an error, and nothing downstream can know it happened.
 *
 * Every implementation is called the same way on purpose: English fixed, no
 * context prompt. A prompt that told the model what the student was asked
 * would pull the transcription towards the right answer, which is exactly the
 * bias being measured.
 */

/** One word or token of the answer, with the provider's own confidence. */
export type ScoredPiece = {
  readonly text: string;
  /** 0 to 1. */
  readonly confidence: number;
};

export type Transcription = {
  readonly text: string;
  /**
   * 0 to 1, or null when the provider gave nothing to derive it from. Never
   * filled in with a guess: a null is a finding, a made-up number is not.
   *
   * Not the same quantity across providers, which is why the report compares
   * each provider only with itself. Deepgram's is its own utterance score.
   * OpenAI's is derived here from the token logprobs; see openai.ts.
   */
  readonly confidence: number | null;
  /** Per word (Deepgram) or per token (OpenAI), or null when not returned. */
  readonly pieces: readonly ScoredPiece[] | null;
  /** Wall time of the request, upload included, as the tutor would feel it. */
  readonly ms: number;
  /** The model asked for, as the provider names it. */
  readonly model: string;
};

export interface SpeechToText {
  /** Stable name for results files and the report. */
  readonly id: SttModelId;
  transcribe(input: {
    audio: Uint8Array;
    /** As the recorder reported it, e.g. "audio/webm;codecs=opus". */
    contentType: string;
  }): Promise<Transcription>;
}

/**
 * The transcribers under measurement.
 *
 * `usdPerMinute` is the list price for pre-recorded audio, read on 2026-09-25
 * from the pricing pages as summarised by third parties (the OpenAI pricing
 * page answers 403 to a fetch). It is an estimate by duration, which is what
 * the report is asked for. OpenAI actually bills the two gpt-4o models by
 * audio and text tokens; the per-minute figure is their published equivalent.
 * Deepgram bills per second at the per-minute rate.
 *
 *   gpt-4o-mini-transcribe  0.003
 *   gpt-4o-transcribe       0.006
 *   nova-3                  0.0043, pay as you go, batch
 */
export const STT_MODELS = [
  {
    id: "openai-gpt-4o-mini-transcribe",
    label: "OpenAI gpt-4o-mini-transcribe",
    usdPerMinute: 0.003,
  },
  {
    id: "openai-gpt-4o-transcribe",
    label: "OpenAI gpt-4o-transcribe",
    usdPerMinute: 0.006,
  },
  {
    id: "deepgram-nova-3",
    label: "Deepgram nova-3",
    usdPerMinute: 0.0043,
  },
] as const satisfies readonly {
  id: string;
  label: string;
  usdPerMinute: number;
}[];

export type SttModelId = (typeof STT_MODELS)[number]["id"];

export function isSttModelId(value: string): value is SttModelId {
  return STT_MODELS.some((model) => model.id === value);
}
