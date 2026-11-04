/**
 * Claude behind the same TextProvider as DeepSeek, written for measuring the
 * two against each other (#187). Nothing in the app imports it yet, which is
 * why the SDK is a devDependency: if a measurement picks Claude for a screen,
 * the SDK moves to dependencies in that change.
 *
 * Choices, each of which would change a measured number if made the other way:
 *
 * - No automatic retries (`maxRetries: 0`). A retry inside the SDK adds
 *   latency and a second bill that never shows in the JSONL. A failed call is
 *   a line with its error.
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

import type { TextProvider } from "./provider.ts";

// This module reads a secret, so it must never be bundled for the browser.
if (typeof window !== "undefined") {
  throw new Error("claude.ts is server only and must not reach the browser");
}

/** A minute: one short answer at low effort comes back in seconds. */
const TIMEOUT_MS = 60_000;

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
 * @param model a Claude model id, such as "claude-haiku-5-5".
 * @param schema the JSON schema the answer must follow: the counterpart of
 *   DeepSeek's json_object mode, and stricter, since the shape is enforced and
 *   not only asked for.
 */
export function createClaudeProvider(
  model: string,
  schema: Record<string, unknown>,
): TextProvider {
  return {
    async complete({ system, user }) {
      const client = new Anthropic({
        apiKey: apiKey(),
        maxRetries: 0,
        timeout: TIMEOUT_MS,
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

      if (response.stop_reason !== "end_turn") {
        const details = response.stop_details;
        const category =
          details === null ? "" : ` (${details.category ?? "no category"})`;
        throw new Error(
          `Claude stopped with ${response.stop_reason}${category}`,
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
        usage: {
          inputTokens: response.usage.input_tokens,
          cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  };
}
