/**
 * What a text call cost, from the usage the provider returned.
 *
 * Prices are US$ per million tokens, each with the page and the day it was
 * read, because a price is a measurement of somebody else's page and goes out
 * of date without saying so. Only the models something here measures are
 * listed; a model that is not is refused rather than costed at zero, so a
 * typo cannot make a run look free.
 */

import type { TextUsage } from "./provider.ts";

export type TextPrice = {
  /** Input read at the full rate. */
  readonly input: number;
  /** Input served from the provider's cache. */
  readonly cachedInput: number;
  /** Output, reasoning included. */
  readonly output: number;
};

export const TEXT_PRICES: Readonly<Record<string, TextPrice>> = {
  /*
   * api-docs.deepseek.com/quick_start/pricing, read 2026-11-04. The peak
   * price, which is the ceiling: off-peak is half (peak is 01:00 to 04:00 and
   * 06:00 to 10:00 UTC, Monday to Friday). Each measured call keeps its UTC
   * time, so the real figure can be worked out from the file.
   */
  "deepseek-flash": { input: 0.3, cachedInput: 0.006, output: 1.2 },
  /*
   * platform.claude.com/docs/en/about-claude/pricing, read 2026-11-04. The
   * rate for prompts up to 100,000 tokens; above that it is five times
   * dearer, and nothing measured here comes near it.
   */
  "claude-haiku-5-5": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  /* Same page and day. Cache hits are 0.05x the input price on this model. */
  "claude-sonnet-5-5": { input: 2, cachedInput: 0.1, output: 10 },
};

export function usdFor(model: string, usage: TextUsage): number {
  const price = TEXT_PRICES[model];
  if (price === undefined) {
    throw new Error(`No price is recorded for ${model}`);
  }
  return (
    (usage.inputTokens * price.input +
      usage.cachedInputTokens * price.cachedInput +
      usage.outputTokens * price.output) /
    1_000_000
  );
}
