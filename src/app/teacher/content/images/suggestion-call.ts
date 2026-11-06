// Relative, with the extension: suggestion-call.test.ts runs under node, which
// resolves neither the @/ alias nor a missing extension.
import { ClaudeStopError } from "../../../../lib/text/claude.ts";
import { usdFor } from "../../../../lib/text/cost.ts";
import type { TextProvider, TextUsage } from "../../../../lib/text/provider.ts";

import { claudeFailure, type FailureWording } from "./claude-failure.ts";

/**
 * One call to the model behind a content suggestion (#225): the kinds and
 * classes of a lesson, its contrast sets, a word's instruction. The scene's
 * instruction keeps its own path (scene-suggestion.ts) and shares the
 * sentences and SUGGESTION_CALL.
 *
 * Never throws. A failure comes back as the teacher's sentence and the reason
 * in English, apart, because the two lesson buttons must not carry the
 * reason on their answer: on this screen a `cause` on a failed answer is how
 * a lost response is told from an answered one (settle, askTwiceIfLost, the
 * witness of Sugerir tipos), and a Claude failure carrying one would be asked
 * again as if it had been lost. Those two put the reason in their function
 * log line; the word's instruction hands it to the console.
 */

export type ModelAnswer =
  | {
      readonly ok: true;
      readonly text: string;
      readonly model: string;
      readonly usage: TextUsage | null;
    }
  | {
      readonly ok: false;
      /** The teacher's sentence, in Portuguese. */
      readonly error: string;
      /** The reason in English, for the console or the log. */
      readonly cause: string;
      /** What a stop was billed for; null when nothing was. */
      readonly usage: TextUsage | null;
    };

export async function askModel(
  provider: TextProvider,
  prompt: { readonly system: string; readonly user: string },
  wording: FailureWording,
): Promise<ModelAnswer> {
  try {
    const { text, model, usage } = await provider.complete({
      system: prompt.system,
      user: prompt.user,
      json: true,
    });
    return { ok: true, text, model, usage };
  } catch (cause) {
    return {
      ok: false,
      error: claudeFailure(cause, wording),
      cause: cause instanceof Error ? cause.message : String(cause),
      usage: cause instanceof ClaudeStopError ? cause.usage : null,
    };
  }
}

/**
 * What a call cost, for the log line, or null. A log line must never be
 * what fails an action: a usage that did not come back, or a model with no
 * price recorded, is a missing number and not an error.
 */
export function usdOrNull(
  model: string,
  usage: TextUsage | null,
): number | null {
  if (usage === null) return null;
  try {
    return usdFor(model, usage);
  } catch {
    return null;
  }
}

/**
 * How the instruction is sent, as opposed to what it asks (#187), for the
 * scene and, since #225, the word. Two retries are the SDK's default: a
 * passing 429 or 529, not billed, never reaches the teacher. 15 s per attempt
 * is four times the slowest call measured (3450 ms, batch "first"); a timed
 * out attempt retried can be billed twice, about US$ 0.0003. Three attempts
 * and the SDK's own backoff come near 47 s, but the SDK waits as long as a
 * retry-after header asks, with no ceiling: the 60 s deadline is what keeps
 * the call inside the screen's maxDuration of 120 s, with room for the reads
 * around it.
 */
export const SUGGESTION_CALL = {
  maxRetries: 2,
  timeoutMs: 15_000,
  deadlineMs: 60_000,
} as const;

/**
 * How the two lesson buttons send theirs (#225). Not measured on Claude yet:
 * phase 2 of #225 measures it and this changes if it must. DeepSeek took
 * 59.6 s at worst for a batch of kinds and 30.8 s median for a lesson's
 * sets, so an attempt gets 30 s, twice the instruction's. The 60 s for the
 * whole call is the ceiling that matters: a batch of kinds still has its ten
 * writes to do after the answer, inside the 75 s the button's witness waits
 * (WITNESS_DEADLINE_MS) before it gives the batch up and asks again.
 */
export const LESSON_CALL = {
  maxRetries: 2,
  timeoutMs: 30_000,
  deadlineMs: 60_000,
} as const;
