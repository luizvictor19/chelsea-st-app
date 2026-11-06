import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TEXT_PRICES, usdFor } from "./cost.ts";

const USAGE = { inputTokens: 1_300, cachedInputTokens: 0, outputTokens: 400 };

/* Rounded to a millionth of a cent: the sum is floating point. */
function close(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `${actual} is not ${expected}`,
  );
}

describe("usdFor", () => {
  test("prices a known call on each measured model", () => {
    // 1,300 in at 0.30 and 400 out at 1.20, per million.
    close(usdFor("deepseek-flash", USAGE), 0.00039 + 0.00048);
    // 1,300 in at 0.10 and 400 out at 0.50.
    close(usdFor("claude-haiku-5-5", USAGE), 0.00013 + 0.0002);
    // 1,300 in at 2 and 400 out at 10.
    close(usdFor("claude-sonnet-5-5", USAGE), 0.0026 + 0.004);
  });

  test("prices the cached part of the input at the cache price", () => {
    const usage = {
      inputTokens: 300,
      cachedInputTokens: 1_000,
      outputTokens: 0,
    };
    close(usdFor("deepseek-flash", usage), (300 * 0.3 + 1_000 * 0.006) / 1e6);
    assert.ok(
      usdFor("deepseek-flash", usage) <
        usdFor("deepseek-flash", {
          inputTokens: 1_300,
          cachedInputTokens: 0,
          outputTokens: 0,
        }),
    );
  });

  test("refuses a model with no recorded price instead of costing it nothing", () => {
    assert.throws(
      () => usdFor("claude-opus-5-5", USAGE),
      /No price is recorded for claude-opus-5-5/u,
    );
  });

  test("every recorded price is positive", () => {
    for (const [model, price] of Object.entries(TEXT_PRICES)) {
      for (const value of Object.values(price)) {
        assert.ok(value > 0, `${model} has a price of ${value}`);
      }
    }
  });
});
