/**
 * One take of the person, judged: the one function the tutor calls to know
 * what came of an answer, and the record of it that is stored with the audio
 * (#248, #250). Behind AnswerJudge, so the tests run on the fake judge and
 * the provider can change without the tutor knowing.
 *
 * What comes back, as docs/spec-robin.md's table of the person's turn says:
 *
 *   verdict         bate, não bate or incerto, recounted in code from the
 *                   judgement (score.ts). Incerto is never an acceptance: it
 *                   becomes "Again, please".
 *   retry           silence or noise: "Again, please", and the turn is still
 *                   hers.
 *   other-language  only another language, on a question whose answer is in
 *                   English: "In English, please.". A translation question
 *                   never gives it; an English answer there is não bate.
 *   failure         the provider failed (HTTP, timeout, network, unreadable).
 *                   "Não consegui ouvir agora. Tente de novo.", and it does
 *                   not count as an answer. No automatic retry: she tries
 *                   again, and a retry here would double the cost and the
 *                   wait.
 *
 * The server log of a failure carries the judge, the kind and the HTTP
 * status, never the provider's text, the audio or what was said (errors.ts).
 */

import { costMicroUsd } from "./cost.ts";
import { judgeErrorFrom, type JudgeFailureKind } from "./errors.ts";
import { promptFingerprint } from "./prompt.ts";
import type {
  AnswerJudge,
  AnswerLanguage,
  Difference,
  Judgement,
  JudgeModelId,
  JudgeUsage,
} from "./provider.ts";
import {
  recountedVerdict,
  substantiveDifferences,
  type Verdict,
} from "./score.ts";

export type TakeOutcome =
  | { readonly kind: "verdict"; readonly verdict: Verdict }
  | { readonly kind: "retry"; readonly reason: "silence" | "noise" }
  | { readonly kind: "other-language" }
  | { readonly kind: "failure"; readonly failure: JudgeFailureKind };

/**
 * Everything the judge knows about one take: what the tutor acts on, and
 * what the turn's row stores beside the audio (#248). A failure is a record
 * too, with no heard: every judged take is kept with its audio, and the ones
 * the judge could not judge are the ones worth listening to (#256).
 */
export type JudgedTake = {
  readonly outcome: TakeOutcome;
  /** What the judge heard, literally; null on a failure. */
  readonly heard: string | null;
  /** Only the differences that count (substantiveDifferences). */
  readonly differences: readonly Difference[];
  readonly answerLanguage: AnswerLanguage;
  readonly judge: JudgeModelId;
  /** The model the provider says answered; the judge's id on a failure. */
  readonly model: string;
  /** promptFingerprint of the wording the take was judged with. */
  readonly prompt: string;
  /** Wall time of the judging, as the server saw it. */
  readonly ms: number;
  readonly usage: JudgeUsage | null;
  /** Null when the provider gave no usage (a failure, mostly). */
  readonly costMicroUsd: number | null;
  /** The length of the take, from its WAV header. */
  readonly audioMs: number;
};

export const TAKE_REPLIES = {
  again: "Again, please",
  inEnglish: "In English, please.",
  failure: "Não consegui ouvir agora. Tente de novo.",
} as const;

/**
 * What the tutor says for an outcome that is not an answer, or null for bate
 * and não bate, whose words are the engine's (the next question, the
 * correction by imitation).
 */
export function replyFor(outcome: TakeOutcome): string | null {
  switch (outcome.kind) {
    case "verdict":
      return outcome.verdict === "uncertain" ? TAKE_REPLIES.again : null;
    case "retry":
      return TAKE_REPLIES.again;
    case "other-language":
      return TAKE_REPLIES.inEnglish;
    case "failure":
      return TAKE_REPLIES.failure;
  }
}

/** Only bate is an acceptance. Incerto never is. */
export function isAccepted(outcome: TakeOutcome): boolean {
  return outcome.kind === "verdict" && outcome.verdict === "match";
}

/** Bate and não bate are answers; everything else leaves the turn hers. */
export function countsAsAnswer(outcome: TakeOutcome): boolean {
  return outcome.kind === "verdict" && outcome.verdict !== "uncertain";
}

/**
 * The outcome of a judgement, for a question answered in `language`.
 *
 * No speech with a reason, and no claim that it matches, is not an answer:
 * retry for silence and noise, "In English, please" for another language on
 * an English question. Anything else is recounted (score.ts), which turns
 * fields that contradict each other into incerto. Another language on a
 * translation question cannot come from its tool; if it ever does, it is
 * incerto, never "In English, please".
 */
export function outcomeOf(
  judgement: Judgement,
  language: AnswerLanguage,
): TakeOutcome {
  const reason = judgement.noEnglishReason;
  if (!judgement.englishSpeech && reason !== null && !judgement.matches) {
    if (reason === "silence" || reason === "noise") {
      return { kind: "retry", reason };
    }
    return language === "en"
      ? { kind: "other-language" }
      : { kind: "verdict", verdict: "uncertain" };
  }
  return { kind: "verdict", verdict: recountedVerdict(judgement) };
}

export type FailureLog = (
  message: string,
  fields: {
    readonly judge: JudgeModelId;
    readonly kind: JudgeFailureKind;
    readonly status: number | null;
  },
) => void;

const logToServer: FailureLog = (message, fields) => {
  console.error(message, fields);
};

export async function judgeTake(
  judge: AnswerJudge,
  input: {
    readonly audio: Uint8Array;
    readonly audioMs: number;
    readonly question: string;
    readonly expected: string;
    readonly answerLanguage: AnswerLanguage;
  },
  options: { readonly log?: FailureLog } = {},
): Promise<JudgedTake> {
  const log = options.log ?? logToServer;
  const base = {
    answerLanguage: input.answerLanguage,
    judge: judge.id,
    prompt: promptFingerprint(input.answerLanguage),
    audioMs: input.audioMs,
  };
  const started = performance.now();
  try {
    const result = await judge.judge({
      audio: input.audio,
      contentType: "audio/wav",
      question: input.question,
      expected: input.expected,
      answerLanguage: input.answerLanguage,
    });
    return {
      ...base,
      outcome: outcomeOf(result.judgement, input.answerLanguage),
      heard: result.judgement.heard,
      differences: substantiveDifferences(result.judgement.differences),
      model: result.model,
      ms: Math.round(performance.now() - started),
      usage: result.usage,
      costMicroUsd: costMicroUsd(result.usage, judge.id),
    };
  } catch (cause) {
    const error = judgeErrorFrom(cause);
    log("judge failed", {
      judge: judge.id,
      kind: error.kind,
      status: error.status,
    });
    return {
      ...base,
      outcome: { kind: "failure", failure: error.kind },
      heard: null,
      differences: [],
      model: judge.id,
      ms: Math.round(performance.now() - started),
      usage: null,
      costMicroUsd: null,
    };
  }
}
