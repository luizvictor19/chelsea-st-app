/**
 * Claude behind the same TextProvider as DeepSeek, written for measuring the
 * two against each other (#187, phase 1) and used by the scene panel's
 * "Sugerir instrução" (phase 2), which the measurement gave to Haiku 5.5.
 * The SDK is therefore a dependency of the app, and this file stays server
 * only.
 *
 * Choices, each of which would change a measured number if made the other way:
 *
 * - No automatic retries by default (`maxRetries: 0`). A retry inside the SDK
 *   adds latency and a second bill that never shows in the JSONL. A failed
 *   call is a line with its error. A caller on a screen passes its own
 *   retries and timeout (ClaudeCallOptions): neither changes the answer, only
 *   whether a passing 529 reaches the teacher.
 * - No `fallbacks`. A refusal answered by another model under this model's
 *   name would be a wrong number; a refusal is an error with its category.
 * - Effort `low`. The task is one short phrase from one sentence, and the
 *   reasoning is billed as output. Thinking itself is adaptive and cannot be
 *   turned off on these models, so it is not set.
 * - No temperature: these models refuse a non-default one with a 400.
 * - No prompt cache: it would make the first call of a run cost differently
 *   from the rest.
 *
 * Docs: https://platform.claude.com/docs
 */

import Anthropic from "@anthropic-ai/sdk";

import type { TextProvider, TextUsage } from "./provider.ts";

// This module reads a secret, so it must never be bundled for the browser.
if (typeof window !== "undefined") {
  throw new Error("claude.ts is server only and must not reach the browser");
}

/** A minute: one short answer at low effort comes back in seconds. */
const TIMEOUT_MS = 60_000;

/**
 * How the request is sent, as opposed to what is asked. The defaults are the
 * measurement's (no retry, a minute), so the script calls with none.
 */
export type ClaudeCallOptions = {
  /** Retries of 408, 409, 429, 5xx and a failed connection, with backoff. */
  readonly maxRetries?: number;
  /** Per attempt, in milliseconds; a timed out attempt is retried too. */
  readonly timeoutMs?: number;
};

/**
 * The SDK's suggested ceiling for a request that is not streamed. Billing is
 * for what is generated, not for the ceiling, and a low ceiling cuts an
 * answer off in the middle of its reasoning.
 */
const MAX_TOKENS = 16_000;

/** Read per call, as in deepseek.ts, so importing this never needs the key. */
function apiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("Missing environment variable: ANTHROPIC_API_KEY");
  }
  return key;
}

/**
 * A response that ended other than with end_turn: a refusal, or an answer cut
 * at max_tokens. Billed all the same, so it carries the usage, and the
 * measurement keeps the cost of a call that produced nothing usable.
 */
export class ClaudeStopError extends Error {
  readonly stopReason: string;
  readonly usage: TextUsage;

  constructor(stopReason: string, category: string | null, usage: TextUsage) {
    super(
      `Claude stopped with ${stopReason}${category === null ? "" : ` (${category})`}`,
    );
    this.name = "ClaudeStopError";
    this.stopReason = stopReason;
    this.usage = usage;
  }
}

/**
 * @param model a Claude model id, such as "claude-haiku-5-5".
 * @param schema the JSON schema the answer must follow: the counterpart of
 *   DeepSeek's json_object mode, and stricter, since the shape is enforced and
 *   not only asked for.
 * @param options retries and timeout; see ClaudeCallOptions.
 */
export function createClaudeProvider(
  model: string,
  schema: Record<string, unknown>,
  options: ClaudeCallOptions = {},
): TextProvider {
  return {
    async complete({ system, user }) {
      const client = new Anthropic({
        apiKey: apiKey(),
        maxRetries: options.maxRetries ?? 0,
        timeout: options.timeoutMs ?? TIMEOUT_MS,
      });
      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema },
        },
      });

      const usage: TextUsage = {
        inputTokens: response.usage.input_tokens,
        cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
        outputTokens: response.usage.output_tokens,
      };
      if (response.stop_reason !== "end_turn") {
        const details = response.stop_details;
        throw new ClaudeStopError(
          response.stop_reason ?? "no stop reason",
          details === null ? null : (details.category ?? "no category"),
          usage,
        );
      }

      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");
      if (text.trim() === "") {
        throw new Error("Claude answered with no text");
      }
      return {
        text,
        model: response.model,
        usage,
      };
    },
  };
}
