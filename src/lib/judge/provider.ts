/**
 * Judging a spoken answer against the one expected, behind one interface, the
 * same shape as the other providers and for the same reason.
 *
 * Why a judge and not a transcriber: measured on 2026-09-25 (PR #38), all
 * three transcribers wrote "is standing" for "stand in" and "closed" for
 * "close", and traded words they did not catch for words that make sense.
 * Comparing a transcript with the expected answer inherits every one of
 * those corrections. Here the model hears the audio with the expected answer
 * in hand and is asked for the differences directly.
 *
 * A separate module from lib/stt, because the input is not the same: a
 * transcriber gets only the audio, and keeping it that way is what made its
 * measurement fair. A judge gets the question and the answer, which is
 * exactly the context a transcriber must never see.
 */

export const DIFFERENCE_KINDS = ["missing", "extra", "replaced"] as const;
export type DifferenceKind = (typeof DIFFERENCE_KINDS)[number];

export type Difference = {
  /** The word the expected answer has here; null for an extra word. */
  readonly expected: string | null;
  /** The word the student said here; null for a missing word. */
  readonly said: string | null;
  readonly kind: DifferenceKind;
};

export const NO_ENGLISH_REASONS = [
  "silence",
  "noise",
  "other_language",
] as const;
export type NoEnglishReason = (typeof NO_ENGLISH_REASONS)[number];

/** What the model answered, read and checked, nothing inferred. */
export type Judgement = {
  /** What the student said, literally, mistakes and all. */
  readonly heard: string;
  /** False for silence, noise, or speech in another language only. */
  readonly englishSpeech: boolean;
  /** Why there was no English speech; null when there was. */
  readonly noEnglishReason: NoEnglishReason | null;
  /** Whether what was said matches the expected answer. */
  readonly matches: boolean;
  readonly differences: readonly Difference[];
};

export type JudgeUsage = {
  readonly audioInputTokens: number;
  readonly textInputTokens: number;
  readonly outputTokens: number;
};

export type JudgeResult = {
  readonly judgement: Judgement;
  /** The model's JSON as it came, so a reading can be checked against it. */
  readonly raw: string;
  readonly usage: JudgeUsage | null;
  /** Wall time of the request, upload included. */
  readonly ms: number;
  readonly model: string;
};

export interface AnswerJudge {
  readonly id: JudgeModelId;
  judge(input: {
    audio: Uint8Array;
    /** "audio/wav" or "audio/mpeg": the only two the audio models accept. */
    contentType: string;
    question: string;
    /** Null when no English answer is expected at all. */
    expected: string | null;
  }): Promise<JudgeResult>;
}

/**
 * The judges under measurement, with their prices per million tokens, read
 * on 2026-09-25 from the OpenAI pricing page (developers.openai.com/api/docs/
 * pricing). Billed by tokens, not by minute: audio input is the dear part.
 *
 * Why these two. Read from the models list and probed on 2026-09-25: the
 * models that take audio in Chat Completions are gpt-audio, gpt-audio-1.5
 * and gpt-audio-mini. gpt-5.x and gpt-4o refuse an input_audio part ("Content
 * blocks are expected to be either text or image_url type"); the realtime
 * models are another API. gpt-audio-1.5 is the newest large one, and costs
 * the same as gpt-audio; gpt-audio-mini is the small one.
 */
export const JUDGE_MODELS = [
  {
    id: "openai-gpt-audio-1.5",
    model: "gpt-audio-1.5",
    label: "OpenAI gpt-audio-1.5",
    usdPerMillion: { audioInput: 32, textInput: 2.5, output: 10 },
  },
  {
    id: "openai-gpt-audio-mini",
    model: "gpt-audio-mini",
    label: "OpenAI gpt-audio-mini",
    usdPerMillion: { audioInput: 10, textInput: 0.6, output: 2.4 },
  },
] as const satisfies readonly {
  id: string;
  model: string;
  label: string;
  usdPerMillion: { audioInput: number; textInput: number; output: number };
}[];

export type JudgeModelId = (typeof JUDGE_MODELS)[number]["id"];

export function isJudgeModelId(value: string): value is JudgeModelId {
  return JUDGE_MODELS.some((model) => model.id === value);
}
