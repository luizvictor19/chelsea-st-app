/**
 * Proposing the Instrução of a scene: the English phrase the image model is
 * handed, written from the line of the lesson the scene illustrates (#187).
 *
 * Why this exists. On 2026-11-04 all six attempts of the two scenes in the
 * database had a subject equal, word for word, to the scene's description:
 * "No, the box isn't small; it's large" went to the image model as written.
 * That is lesson text, not a picture. It denies before it affirms, it asks
 * the model to hold two sizes of one box in mind, and an image model tends to
 * letter into the picture whatever text it is handed.
 *
 * Phase 1 measured this prompt across providers; phase 2 puts it behind the
 * scene panel's "Sugerir instrução", with the model below. Nothing here is
 * stored: the proposal fills the field, and the field is kept only on the
 * attempt. The answer is read with parseSubject, the same as the subject of a
 * word, because the shape is the same.
 */

import type { ImageStyle } from "./style.ts";
import { sceneRules } from "./subject.ts";

/**
 * The model behind the scene panel's suggestion, chosen by Luiz on
 * 2026-11-04 from the measurement (fixtures/scene-instruction.jsonl, batch
 * "first", 19 inputs, 3 passes): US$ 0.0129 per 100 proposals (the dearest
 * call US$ 0.00027), median latency 1366 ms, worst 3450 ms. Called with the
 * measured settings: effort low, SCENE_SUBJECT_SCHEMA, no temperature, no
 * cache, no fallbacks (Haiku 5.5 has none on the server). The prompt is the
 * measured one plus the fourth rule of SCENE_RULES, one sentence that batch
 * "first" did not have; its own measurement is the "picture" A/B.
 */
export const SCENE_SUBJECT_MODEL = "claude-haiku-5-5";

/**
 * Longer than the twelve of a word, because a scene names two things and the
 * relation between them, and the point of view on top. Asked for, enforced
 * nowhere, for the reason MAX_WORDS in subject.ts gives.
 */
export const SCENE_MAX_WORDS = 20;

/**
 * The rules of a scene, on top of the three it shares with a word. The first
 * three are the hypothesis of the measurement, written before any answer was
 * seen.
 *
 * The fourth came from the measurement (#187, batch "first", 2026-11-04). For
 * "No, the picture isn't large; it's small", the first of three Haiku passes
 * answered "a tiny mouse standing alone, seen from the side": this prompt
 * calls the image it asks for a picture throughout, and the line's own
 * picture was read as that one, made small. The other two passes drew a
 * small framed picture on a wall. Whether the rule closes the 1 in 3 is the
 * A/B of the "picture" input in the phase 2 plan, not this file.
 *
 * The examples in them are deliberately not lines that are measured (the
 * box, the pen on the book, the picture): an example that is also an input
 * would hand the model that answer and score the rule on it.
 */
export const SCENE_RULES: readonly string[] = [
  `The line is lesson text, and lesson text often denies before it affirms: "No, the dog isn't black; it's white". Draw only what it affirms at the end. For that line, one white dog; never a black dog, and never both.`,
  `Everything the affirmed part names is in the picture, with the relation between the things visible: for "the cup is on the chair", a cup and a chair, the cup standing on the seat of the chair. Add nothing the line does not ask for.`,
  `The picture has no words in it. Never copy the line or any part of it into the phrase: no negation, no question, no quotation. Describe what is seen, not what is said.`,
  `A thing the line names is an object inside the scene, even when it is itself an image, such as a poster, a photo or a screen: for "the poster is small", a small poster hanging on a wall, never a whole scene drawn small.`,
];

/**
 * The answer's shape as a JSON schema, for a provider that enforces one (the
 * Claude provider does). The same shape the prompt asks for in words, which
 * is what parseSubject reads.
 */
export const SCENE_SUBJECT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { subject: { type: "string" } },
  required: ["subject"],
  additionalProperties: false,
};

export function buildSceneSubjectPrompt(input: {
  sentence: string;
  question: string | null;
  style: ImageStyle;
}): { system: string; user: string } {
  const sentence = input.sentence.trim();
  if (sentence === "") {
    throw new Error("A scene instruction needs the line it illustrates");
  }
  const question = input.question?.trim() ?? "";
  const rules = [...sceneRules(input.style), ...SCENE_RULES];

  return {
    system: `You write the subject line for a picture that illustrates one line of an English lesson.

The subject is a short phrase in English, at most ${SCENE_MAX_WORDS} words, describing what the picture shows. It is what a person drawing the picture would be told to draw.

Answer with json only, in exactly this shape:
{"subject": "the phrase"}

Describe what is in the picture, never how it is made. The medium and the colours are decided elsewhere, so naming them either repeats that or argues with it: do not write drawing, illustration, photograph, render or painting, and do not choose a palette.

${rules.length} rules, learned from pictures that came out wrong:

${rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n\n")}

No prose, no explanation, no quotation marks inside the phrase.`,
    user:
      question === ""
        ? `The line is: ${sentence}\n\nWrite the subject in English.`
        : `The question is: ${question}\nThe line that answers it is: ${sentence}\n\nWrite the subject in English.`,
  };
}
