/**
 * A judge that reads its answers from a script, for the tests: each call
 * takes the next step, a judgement or an error to throw. It records what it
 * was asked, so a test can also say the judge was never called.
 */

import { JudgeError } from "./errors.ts";
import type {
  AnswerJudge,
  Judgement,
  JudgeModelId,
  JudgeUsage,
} from "./provider.ts";

export type FakeStep =
  | { readonly judgement: Judgement; readonly usage?: JudgeUsage | null }
  | { readonly error: unknown };

export type FakeJudge = AnswerJudge & {
  readonly calls: Parameters<AnswerJudge["judge"]>[0][];
};

export function createFakeJudge(
  steps: readonly FakeStep[],
  id: JudgeModelId = "openai-gpt-audio-1.5",
): FakeJudge {
  const queue = [...steps];
  const calls: Parameters<AnswerJudge["judge"]>[0][] = [];
  return {
    id,
    calls,
    async judge(input) {
      calls.push(input);
      const step = queue.shift();
      if (step === undefined) {
        throw new JudgeError("network", "the fake judge ran out of steps");
      }
      if ("error" in step) throw step.error;
      return {
        judgement: step.judgement,
        raw: JSON.stringify(step.judgement),
        usage: step.usage ?? null,
        ms: 1,
        model: "fake",
      };
    },
  };
}
