/**
 * What came of a take, and what the tutor says for it. Pure and free of
 * node: the screen imports it (judge-take.ts, which hashes the prompt, is
 * the server's). judge-take.ts explains each outcome.
 */

import type { JudgeFailureKind } from "./errors.ts";
import type { AnswerLanguage, Judgement } from "./provider.ts";
import { recountedVerdict, type Verdict } from "./score.ts";

export type TakeOutcome =
  | { readonly kind: "verdict"; readonly verdict: Verdict }
  | { readonly kind: "retry"; readonly reason: "silence" | "noise" }
  | { readonly kind: "other-language" }
  | { readonly kind: "failure"; readonly failure: JudgeFailureKind };

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
