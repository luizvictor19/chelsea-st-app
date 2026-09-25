/**
 * What the judge is told, and the shape it must answer in. Pure, so the
 * wording can be tested for the instructions that matter.
 */

import { createHash } from "node:crypto";

import {
  DIFFERENCE_KINDS,
  NO_ENGLISH_REASONS,
  type Judgement,
} from "./provider.ts";

/** The function the model is forced to call; its arguments are the answer. */
export const JUDGEMENT_TOOL = "report_judgement";

/**
 * The audio models refuse response_format outright, json_schema and
 * json_object alike (probed on 2026-09-25: "Invalid parameter:
 * 'response_format' of type 'json_schema' is not supported with this
 * model"). They do take a function with strict parameters, and a forced call
 * to it is how the answer comes back in a checked shape.
 *
 * Strict mode wants every property required, which is why nothing here is
 * optional. A nullable field is written as anyOf with null: these models
 * refuse the shorter `type: ["string", "null"]` ("schema must have a 'type'
 * key"), probed on 2026-09-25.
 */
export const JUDGEMENT_TOOL_DEFINITION = {
  type: "function",
  function: {
    name: JUDGEMENT_TOOL,
    description: "Report the judgement.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "heard",
        "englishSpeech",
        "noEnglishReason",
        "matches",
        "differences",
      ],
      properties: {
        heard: { type: "string" },
        englishSpeech: { type: "boolean" },
        noEnglishReason: {
          anyOf: [
            { type: "string", enum: [...NO_ENGLISH_REASONS] },
            { type: "null" },
          ],
        },
        matches: { type: "boolean" },
        differences: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["expected", "said", "kind"],
            properties: {
              expected: { anyOf: [{ type: "string" }, { type: "null" }] },
              said: { anyOf: [{ type: "string" }, { type: "null" }] },
              kind: { type: "string", enum: [...DIFFERENCE_KINDS] },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * The instruction. Its one job is to stop the model doing what every
 * transcriber did: hearing the answer it expected. The expected answer is
 * there to compare against, and the prompt says so.
 *
 * Short on purpose. The first version, with a description on every schema
 * field, cost 503 to 513 text input tokens a call, measured from usage on
 * 2026-09-25, which on gpt-audio-1.5 was about half the price of a call.
 * The field descriptions are gone and what they said is here, once.
 *
 * Portuguese before the answer does not count. Measured on 2026-09-25:
 * gpt-audio-1.5 heard m01 ("Não sei... it's a chair.") and marked it as no
 * English speech at all. A student who thinks aloud in Portuguese and then
 * answers in English has answered, and the answer is the English part.
 */
export const JUDGE_SYSTEM = [
  "Compare a beginner's spoken English answer (the audio) with the expected answer.",
  "heard: exactly what the student said. Never correct grammar, fill in words or fix endings. The expected answer is only for comparison, never for deciding what you heard.",
  'differences: every word that differs, however small: a missing "a" or "the", "-s", "-ed", "-ing", "it is" for "it\'s", "um", a repeated word. Ignore punctuation and capital letters. Never list a word said as expected. missing: expected word, said null. extra: said word, expected null. replaced: both.',
  "matches: true only if differences is empty.",
  "If the student says something in Portuguese or another language and then answers in English, ignore the other language: compare only the English answer, and englishSpeech is true.",
  "englishSpeech is false only when there is no English answer at all (silence, noise, only another language); then give noEnglishReason, otherwise null.",
].join("\n");

/** The text that goes beside the audio. */
export function judgeUserText(
  question: string,
  expected: string | null,
): string {
  return expected === null
    ? `Question: "${question}"\nExpected: no English answer.`
    : `Question: "${question}"\nExpected: "${expected}"`;
}

/**
 * Identifies the prompt and schema a result was produced with. A result
 * judged under another wording is a different measurement, so the key of a
 * results line carries this, and the report reads one prompt at a time.
 */
export function promptFingerprint(): string {
  return createHash("sha256")
    .update(JSON.stringify({ JUDGE_SYSTEM, JUDGEMENT_TOOL_DEFINITION }))
    .digest("hex")
    .slice(0, 12);
}

/** Only so the type is checked against the tool's required list. */
export const JUDGEMENT_KEYS: readonly (keyof Judgement)[] =
  JUDGEMENT_TOOL_DEFINITION.function.parameters.required;
