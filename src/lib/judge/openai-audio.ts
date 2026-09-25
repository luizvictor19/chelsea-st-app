/**
 * The only file that knows the OpenAI audio chat API for judging answers.
 *
 * Read and probed on 2026-09-25: POST /v1/chat/completions with an
 * input_audio content part, whose format is "wav" or "mp3" and nothing else
 * ("Invalid value: 'webm'. Supported values are: 'wav' and 'mp3'."). The
 * browser records webm, so the caller converts; see scripts/measure-judge.ts.
 * response_format is refused by these models, so the answer comes back as
 * the arguments of a forced, strict function call. See prompt.ts.
 */

import { parseJudgement } from "./parse.ts";
import {
  JUDGE_SYSTEM,
  JUDGEMENT_TOOL,
  JUDGEMENT_TOOL_DEFINITION,
  judgeUserText,
} from "./prompt.ts";
import type {
  AnswerJudge,
  JudgeModelId,
  JudgeResult,
  JudgeUsage,
} from "./provider.ts";

// This module reads a secret, so it must never be bundled for the browser.
if (typeof window !== "undefined") {
  throw new Error(
    "openai-audio.ts is server only and must not reach the browser",
  );
}

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

/** Per call timeout. A tutor that waits longer than this has already failed. */
const TIMEOUT_MS = 60_000;

/**
 * Zero, because this is a judgement and not writing: the same recording
 * should get the same verdict twice, or the two rounds measure the dice.
 */
const TEMPERATURE = 0;

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("Missing environment variable: OPENAI_API_KEY");
  }
  return key;
}

function audioFormat(contentType: string): "wav" | "mp3" {
  const base = contentType.split(";")[0].trim().toLowerCase();
  if (base === "audio/wav" || base === "audio/x-wav") return "wav";
  if (base === "audio/mpeg" || base === "audio/mp3") return "mp3";
  throw new Error(`The audio models take wav or mp3, not ${contentType}`);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** choices[0].message.tool_calls[0].function.arguments, narrowed by hand. */
function readArguments(body: unknown): string | null {
  const choices = record(body)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const calls = record(record(choices[0])?.message)?.tool_calls;
  if (!Array.isArray(calls) || calls.length === 0) return null;
  const fn = record(record(calls[0])?.function);
  if (fn?.name !== JUDGEMENT_TOOL) return null;
  return typeof fn.arguments === "string" ? fn.arguments : null;
}

function readUsage(body: unknown): JudgeUsage | null {
  const usage = record(record(body)?.usage);
  const details = record(usage?.prompt_tokens_details);
  const prompt = usage?.prompt_tokens;
  const completion = usage?.completion_tokens;
  const audio = details?.audio_tokens;
  if (
    typeof prompt !== "number" ||
    typeof completion !== "number" ||
    typeof audio !== "number"
  ) {
    return null;
  }
  return {
    audioInputTokens: audio,
    textInputTokens: prompt - audio,
    outputTokens: completion,
  };
}

export function createOpenAiAudioJudge(
  id: JudgeModelId,
  model: string,
): AnswerJudge {
  return {
    id,

    async judge({
      audio,
      contentType,
      question,
      expected,
    }): Promise<JudgeResult> {
      const format = audioFormat(contentType);
      const started = performance.now();
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          modalities: ["text"],
          temperature: TEMPERATURE,
          tools: [JUDGEMENT_TOOL_DEFINITION],
          tool_choice: { type: "function", function: { name: JUDGEMENT_TOOL } },
          messages: [
            { role: "system", content: JUDGE_SYSTEM },
            {
              role: "user",
              content: [
                { type: "text", text: judgeUserText(question, expected) },
                {
                  type: "input_audio",
                  input_audio: {
                    data: Buffer.from(audio).toString("base64"),
                    format,
                  },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      const body: unknown = response.ok ? await response.json() : null;
      const ms = performance.now() - started;

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `OpenAI judge failed: ${response.status} ${detail.slice(0, 300)}`,
        );
      }

      const raw = readArguments(body);
      if (raw === null) {
        throw new Error("OpenAI judge answered without the judgement call");
      }
      let judgement;
      try {
        judgement = parseJudgement(raw);
      } catch (cause) {
        // The raw answer goes with the error: it was paid for, and it is the
        // only way to see what the model got wrong.
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `Unreadable judgement (${reason}): ${raw.slice(0, 1000)}`,
        );
      }
      return {
        judgement,
        raw,
        usage: readUsage(body),
        ms: Math.round(ms),
        model,
      };
    },
  };
}
