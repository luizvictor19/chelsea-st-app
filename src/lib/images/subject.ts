/**
 * Proposing the subject line for one word: the few English words the teacher
 * would otherwise type into the Assunto field.
 *
 * What comes back is a proposal and nothing else. It fills the field, it is
 * stored nowhere, and the teacher edits it before anything is generated. The
 * subject is the half of the prompt they own, so a model may offer a draft of
 * it but never commit one.
 *
 * Decided on 2026-09-19.
 */

// The extension is required: isDrawableKind is a value, so this import
// survives into the runtime, and node resolves neither a bare specifier nor a
// missing extension the way the bundler does.
import { type DrawableKind, isDrawableKind } from "./style.ts";

/**
 * What the subject has to describe for each kind. Close to SUBJECT_RULES in
 * style.ts, and deliberately not the same text: those tell an image model how
 * to draw, these tell a text model what to write a sentence about.
 */
const SUBJECT_SHAPE: Record<DrawableKind, string> = {
  photo: "the object on its own, with nothing around it",
  pose: "a person whose body is at rest, in the position the word names",
  action: "a person doing the thing the word names",
  figure: "a diagram that shows it, with no person in it",
};

/** How long a subject may be before it stops being a subject. */
const MAX_WORDS = 12;

export function buildSubjectPrompt(
  term: string,
  kind: string,
): { system: string; user: string } {
  const word = term.trim();
  if (word === "") {
    throw new Error("A subject proposal needs a word");
  }
  if (!isDrawableKind(kind)) {
    throw new Error(`No subject is proposed for ${kind}`);
  }

  return {
    system: `You write the subject line for a picture that teaches one English word.

The subject is a short phrase in English, at most ${MAX_WORDS} words, describing what the picture shows. It is not a sentence about the word and not a definition: it is what a person drawing the picture would be told to draw.

Answer with json only, in exactly this shape:
{"subject": "the phrase"}

Describe only what is in the picture. The background, the colours and the drawing style are already fixed elsewhere, so saying anything about them either repeats that or argues with it.

No prose, no explanation, no quotation marks inside the phrase.`,
    user: `The word is "${word}" and it is a ${kind}, so the subject describes ${SUBJECT_SHAPE[kind]}. Write the subject in English.`,
  };
}

/**
 * The phrase out of the model's answer, or null.
 *
 * Untrusted input like any other answer: anything that is not a non-empty
 * string under "subject" is refused rather than pushed into the field, and a
 * refusal leaves the teacher typing, which is what they were doing anyway.
 */
export function parseSubject(text: string): string | null {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");

  let body: unknown;
  try {
    body = JSON.parse(unfenced);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;

  const subject = (body as { subject?: unknown }).subject;
  if (typeof subject !== "string") return null;

  const cleaned = subject
    .trim()
    .replace(/^["']|["']$/gu, "")
    .trim();
  return cleaned === "" ? null : cleaned;
}
