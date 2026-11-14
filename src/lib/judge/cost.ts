/**
 * What a judge call cost, in whole micro-dollars: the exact unit every paid
 * call is recorded in (#248, from #271), and what the measurement of the
 * real cost (#272) and the price of credits (#273) read.
 *
 * The prices of JUDGE_MODELS are dollars per million tokens, which is the
 * same number as micro-dollars per token, so the sum needs no division.
 * Rounded to the nearest micro-dollar: a call is a few thousand of them, and
 * the half a text token at 2.5 can leave is below anything that counts.
 */

import {
  JUDGE_MODELS,
  type JudgeModelId,
  type JudgeUsage,
} from "./provider.ts";

export function costMicroUsd(
  usage: JudgeUsage | null,
  judge: JudgeModelId,
): number | null {
  if (usage === null) return null;
  const model = JUDGE_MODELS.find((each) => each.id === judge);
  if (model === undefined) return null;
  const prices = model.usdPerMillion;
  return Math.round(
    usage.audioInputTokens * prices.audioInput +
      usage.textInputTokens * prices.textInput +
      usage.outputTokens * prices.output,
  );
}
