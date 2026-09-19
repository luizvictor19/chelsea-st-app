/**
 * The only file that knows the text API and holds its key.
 *
 * Model: deepseek-flash, chosen on 2026-09-19 as the cheapest chat model that
 * supports JSON output. It is also what the legacy names now resolve to:
 * deepseek-chat and deepseek-reasoner are served by V4.1-Flash and billed at
 * the Flash price. Docs: https://api-docs.deepseek.com
 */

import type { TextProvider } from "./provider";

// This module reads a secret, so it must never be bundled for the browser.
if (typeof window !== "undefined") {
  throw new Error("deepseek.ts is server only and must not reach the browser");
}

const BASE_URL = "https://api.deepseek.com";
const MODEL = "deepseek-flash";

/**
 * Zero, because this is classification and not writing. The same word should
 * get the same answer on Tuesday as it did on Monday, or the measurement of
 * how good the suggestions are is measuring the dice as much as the model.
 */
const TEMPERATURE = 0;

/**
 * Read per call rather than at module load: the CI build runs with no text
 * key, and importing this file must not fail there.
 */
function apiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error("Missing environment variable: DEEPSEEK_API_KEY");
  }
  return key;
}

/** The one field of the response this needs, narrowed by hand from unknown. */
function readContent(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

export function createDeepSeekProvider(): TextProvider {
  return {
    async complete({ system, user }): Promise<{ text: string; model: string }> {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          // The prompt must contain the word "json" for this to be accepted,
          // which buildSuggestionPrompt takes care of.
          response_format: { type: "json_object" },
          temperature: TEMPERATURE,
          stream: false,
        }),
        cache: "no-store",
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Text API failed: ${response.status} ${detail.slice(0, 300)}`,
        );
      }

      const content = readContent(await response.json());
      // The docs warn that this endpoint occasionally answers with empty
      // content, so an empty answer is a failure to say out loud rather than
      // something to hand on as if it were a result.
      if (content === null || content.trim() === "") {
        throw new Error("Text API answered with no content");
      }
      return { text: content, model: MODEL };
    },
  };
}
