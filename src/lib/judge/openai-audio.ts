/**
 * The only file that knows the OpenAI audio chat API for judging answers.
 *
 * Read and probed on 2026-09-25: POST /v1/chat/completions with an
 * input_audio content part, whose format is "wav" or "mp3" and nothing else
 * ("Invalid value: 'webm'. Supported values are: 'wav' and 'mp3'."). The app
 * records WAV in the browser (src/lib/audio/wav-recorder.ts); the measurement
 * cases are webm, and scripts/measure-judge.ts converts them.
 * response_format is refused by these models, so the answer comes back as
 * the arguments of a forced, strict function call. See prompt.ts.
 */

import { JudgeError, judgeErrorFrom } from "./errors.ts";
import { parseJudgement, parseTranslationJudgement } from "./parse.ts";
import { JUDGEMENT_TOOL, judgeUserText, promptFor } from "./prompt.ts";
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

/**
 * Per call timeout for the measurement script. The app passes its own,
 * shorter one (src/lib/judge/server.ts): a tutor that waits a minute has
 * already failed.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

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
  options: { readonly timeoutMs?: number } = {},
): AnswerJudge {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    id,

    async judge({
      audio,
      contentType,
      question,
      expected,
      answerLanguage,
    }): Promise<JudgeResult> {
      const format = audioFormat(contentType);
      const { system, tool } = promptFor(answerLanguage);
      const parse =
        answerLanguage === "pt" ? parseTranslationJudgement : parseJudgement;
      const started = performance.now();
      // Every way this fails is a JudgeError whose message carries no text
      // from the provider: see errors.ts.
      let response: Response;
      let body: unknown = null;
      try {
        response = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey()}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            modalities: ["text"],
            temperature: TEMPERATURE,
            tools: [tool],
            tool_choice: {
              type: "function",
              function: { name: JUDGEMENT_TOOL },
            },
            messages: [
              { role: "system", content: system },
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
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new JudgeError("http", detail.slice(0, 300), response.status);
        }
        body = await response.json().catch(() => null);
      } catch (cause) {
        throw judgeErrorFrom(cause);
      }
      const ms = performance.now() - started;

      const raw = readArguments(body);
      if (raw === null) {
        throw new JudgeError(
          "no-call",
          JSON.stringify(body)?.slice(0, 1000) ?? "",
        );
      }
      let judgement;
      try {
        judgement = parse(raw);
      } catch (cause) {
        // The raw answer goes with the error: it was paid for, and it is the
        // only way to see what the model got wrong. In detail, never in the
        // message, because it holds what the person said.
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new JudgeError("unreadable", `${reason}: ${raw.slice(0, 1000)}`);
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
