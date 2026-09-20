/**
 * Proposing the subject line for one word: the few English words the teacher
 * would otherwise type into the Instrução field.
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

/**
 * How long a subject may be before it stops being a subject.
 *
 * Asked for in the prompt and deliberately enforced nowhere. The only way to
 * impose it is to truncate, and a phrase cut in the middle is a worse subject
 * than a phrase of fourteen words: "a small ball on the ground directly
 * beneath a table, seen from the side" came back over the cap on 2026-09-19
 * and was right. The number is here to push the answer short, and it is
 * doing that — six of the seven answers that day landed at or under it.
 */
const MAX_WORDS = 12;

/**
 * Three rules, each of them bought with real generations on 2026-09-19.
 *
 * They are here and not in style.ts because they are about what to ask for,
 * not about how to draw it. The image model draws whatever it is handed; what
 * these fix is the handing.
 *
 * Their provenance, in order, all of it from that day:
 *
 * 1. The angle. `sitting` took four attempts. Drawn from the front a seated
 *    person does not read as seated: what says the posture is the bent knee,
 *    and from the front the knee points at the viewer and disappears. "seen
 *    from the side" is what made it come out right, and it is only ever the
 *    subject that can say so, because the style constant is fixed and the
 *    category rule is the same for every word in the category.
 *
 *    It was written for a pose and an action, and generalised the same day
 *    once the rule had been run over seven words: a box and a ball read from
 *    the side rather than from above, and the best of the seven answers was
 *    an open book seen from above. The point of view is worth naming for
 *    anything that gets drawn; which point of view is the judgement, and that
 *    is exactly the judgement the teacher is editing the phrase to make.
 *
 * 2. The silhouette. A closed book standing up came back as a box, a folder
 *    and a card, because all four share an outline. An open book is not
 *    mistakable for anything. The same choice exists for most objects and it
 *    is nearly free to make: scissors open, a door ajar.
 *
 * 3. State words. "a closed cardboard box" came back half open and half
 *    closed on both models. The box with its flaps up is the box the model
 *    knows, and asked for a closed one it averages the two. "sealed with
 *    packing tape across the top" fixed it on both, because tape cannot
 *    coexist with a raised flap. The lesson generalises past boxes: an
 *    adjective asks the model to subtract, and it does not subtract, it
 *    averages. A positive feature that exists in one state and not the other
 *    leaves it nothing to average.
 *
 * Exported so the test can hold the prompt to naming all three, rather than
 * to matching a sentence someone can quietly delete.
 */
export const LEARNED_RULES = [
  `Angle is part of the meaning. Name the point of view, whatever the word is: the same thing drawn from the wrong side stops saying it. A seated person seen from the front does not read as seated, because the bent knee points at the viewer and disappears, so write "seen from the side". A box or a ball reads from the side; an open book reads from above.`,

  `Choose the view or the state with the most recognisable silhouette. A closed book standing up could be a box, a folder or a card; an open book could be nothing else. Scissors open, not shut. A door ajar, not flat in its frame.`,

  `For a word that names a state (open, closed, empty, full), do not use the adjective. Name a positive feature that exists only in that state. "a closed cardboard box" comes back halfway open, because the model knows the box with its flaps up and averages the two. "sealed with packing tape across the top" does not, because tape cannot sit on a raised flap.`,
] as const;

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

Three rules, learned from pictures that came out wrong:

${LEARNED_RULES.map((rule, index) => `${index + 1}. ${rule}`).join("\n\n")}

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
 *
 * A full stop at the end is dropped, for the same reason the stray quotes
 * are. Every medium in STYLES ends in one of its own ("Flat vector
 * illustration of {subject}.", "Photograph of {subject}."), so a phrase that
 * ends in a stop produces two. Seen on 2026-09-19:
 * "A ball directly beneath a raised horizontal bar, seen from the side."
 *
 * The capital at the front is left exactly where it is. Lowercasing it would
 * read as tidying, and it would quietly break Jack, England and Mr Brown,
 * which are the subjects where the capital carries the meaning. A capital in
 * the middle of a phrase is ugly and harmless; a proper noun in lower case is
 * wrong about the word.
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
    // After the quotes, because a quoted phrase hides its full stop behind
    // one. Any run of them, and any space after: "side.", "side. " and an
    // ellipsis all end the same way.
    .replace(/[.\s]+$/u, "")
    .trim();
  return cleaned === "" ? null : cleaned;
}
