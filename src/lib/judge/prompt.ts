/**
 * What the judge is told, and the shape it must answer in. Pure, so the
 * wording can be tested for the instructions that matter.
 */

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
    description:
      "Report how the student's spoken answer compares with the expected answer.",
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
        heard: {
          type: "string",
          description:
            "Exactly what the student said, word for word, with every mistake kept. Empty if nothing was said.",
        },
        englishSpeech: {
          type: "boolean",
          description:
            "False if the recording has no English speech: silence, background noise, or only another language.",
        },
        noEnglishReason: {
          anyOf: [
            { type: "string", enum: [...NO_ENGLISH_REASONS] },
            { type: "null" },
          ],
          description: "Why there is no English speech; null when there is.",
        },
        matches: {
          type: "boolean",
          description:
            "True only if the student said the expected answer with no difference at all.",
        },
        differences: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["expected", "said", "kind"],
            properties: {
              expected: {
                anyOf: [{ type: "string" }, { type: "null" }],
                description:
                  "The word in the expected answer; null if the student added a word.",
              },
              said: {
                anyOf: [{ type: "string" }, { type: "null" }],
                description:
                  "The word the student said; null if the student left a word out.",
              },
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
 * there to compare against, and the prompt says in as many words that it is
 * not a guide to what was said.
 */
export const JUDGE_SYSTEM = [
  "You check a beginner student's spoken English answer against the answer the teacher expects.",
  "",
  'Write down what the student actually said, literally. Do NOT correct grammar, do NOT fill in missing words, do NOT fix word endings. If the student says "the book are on the table", write "the book are on the table". The expected answer is only for comparison: never use it to decide what you heard.',
  "",
  'Then list every difference between what the student said and the expected answer, one word at a time, however small. A missing "a" or "the" is a difference. A missing or extra "-s", "-ed" or "-ing" is a difference: "stand" instead of "stands" is a replaced word. "it is" instead of "it\'s" is a difference. Hesitations such as "um" and repeated words count as extra words. Ignore only punctuation and capital letters. List only the words that differ: a word the student said exactly as expected is not a difference and must not be in the list.',
  "",
  "matches is true only when there is no difference at all.",
  "",
  "If the recording has no English speech (silence, background noise, or only Portuguese or another language), set englishSpeech to false and give the reason. Write in heard whatever words you did hear, in the language they were said, or an empty string.",
  "",
  `Answer only by calling ${JUDGEMENT_TOOL}.`,
].join("\n");

/** The text that goes beside the audio. */
export function judgeUserText(
  question: string,
  expected: string | null,
): string {
  return [
    `The teacher asked: "${question}"`,
    expected === null
      ? "No English answer is expected: this recording should have no English speech."
      : `The expected answer is: "${expected}"`,
    "The student's answer is the audio.",
  ].join("\n");
}

/** Only so the type is checked against the tool's required list. */
export const JUDGEMENT_KEYS: readonly (keyof Judgement)[] =
  JUDGEMENT_TOOL_DEFINITION.function.parameters.required;
