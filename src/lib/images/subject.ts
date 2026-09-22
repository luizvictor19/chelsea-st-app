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
import { type DrawableKind, type ImageStyle, isDrawableKind } from "./style.ts";

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
 * Four rules, the first three bought with real generations on 2026-09-19 and
 * the fourth with the proposals measured on 2026-09-22.
 *
 * They are here and not in style.ts because they are about what to ask for,
 * not about how to draw it. The image model draws whatever it is handed; what
 * these fix is the handing.
 *
 * Three of them hold whatever the picture is made of, and are below as
 * constants. The second one does not, and is a pair; see RECOGNITION.
 *
 * Their provenance, in order:
 *
 * 1. The angle. `sitting` took four attempts. Drawn from the front a seated
 *    person does not read as seated: what says the posture is the bent knee,
 *    and from the front the knee points at the viewer and disappears. "seen
 *    from the side" is what made it come out right, and it is only ever the
 *    subject that can say so, because the style constants are fixed and the
 *    category rule is the same for every word in the category.
 *
 *    It was written for a pose and an action, and generalised the same day
 *    once the rule had been run over seven words: a box and a ball read from
 *    the side rather than from above, and the best of the seven answers was
 *    an open book seen from above. The point of view is worth naming for
 *    anything that gets drawn; which point of view is the judgement, and that
 *    is exactly the judgement the teacher is editing the phrase to make.
 *
 * 2. Recognisability, which is the one that is not the same question twice.
 *    See RECOGNITION.
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
 * 4. One subject, added on 2026-09-22 and not from the same day as the three
 *    above. Before contrast sets (0022), contrast was solved inside a single
 *    picture, and the proposals still asked for it: large, small, long and
 *    short came back as two objects in one scene in 12 answers of 12 ("a
 *    tiny cube beside a giant cube"). That way was abandoned after four
 *    attempts, because the image model draws the pair and cannot say which of
 *    the two is which. Each word now has its own picture of one thing, and a
 *    set shows the pictures side by side. The rule is for every word, and
 *    reads nothing about sets: a word that is in none gets one subject too.
 *    A preposition still relates two things (a ball on a table), and the rule
 *    says so, because that second thing is the meaning and not a yardstick.
 *
 *    The frame, added the same day: one subject alone let "one huge cube"
 *    and "a single tiny cube" both fill the frame, and side by side in a set
 *    two pictures that fill the frame the same way show no difference. So
 *    for size and length the frame is the yardstick: the large or long thing
 *    fills it or crosses it, the small or short one sits small in the middle
 *    of a nearly empty one. RECOGNITION.realistic used to say a photograph is
 *    read "by its size next to something familiar", which invited the second
 *    object back, and now reads size against the frame too.
 */
const ANGLE_RULE = `Angle is part of the meaning. Name the point of view, whatever the word is: the same thing drawn from the wrong side stops saying it. A seated person seen from the front does not read as seated, because the bent knee points at the viewer and disappears, so write "seen from the side". A box or a ball reads from the side; an open book reads from above.`;

const ONE_SUBJECT_RULE = `One subject, showing only this word's side of it. Show the word once, never beside its opposite or a different degree of it, and never add a second object only to measure it against: never both in the same scene. For size and length, the frame is the yardstick: a large or long thing fills almost the whole frame, or runs from edge to edge; a small or short thing takes up a small part in the middle of a nearly empty frame. So for large, one huge cube that fills almost the whole frame; for small, one tiny cube in the middle of a nearly empty frame. A second thing belongs in the picture only when the word itself relates two things, as a ball resting on a table does for on.`;

const STATE_RULE = `For a word that names a state (open, closed, empty, full), do not use the adjective. Name a positive feature that exists only in that state. "a closed cardboard box" comes back halfway open, because the model knows the box with its flaps up and averages the two. "sealed with packing tape across the top" does not, because tape cannot sit on a raised flap.`;

/**
 * What makes a picture recognisable, which is a different question in each
 * style, so this rule is a pair where the other two are constants.
 *
 * The flat one is from 2026-09-19 and is a measurement: a closed book
 * standing up came back as a box, a folder and a card, because all four share
 * an outline, and an open book is not mistakable for anything. In a flat
 * vector there is nothing else for it to be recognised by. No texture, no
 * light, no depth: the outline is the whole picture, so choosing the view
 * with the clearest outline is choosing whether the word arrives at all.
 *
 * The realistic one is from 2026-09-20 and is NOT a measurement. It is a
 * reading of what the flat rule assumes, made when the second style went in.
 * Two things are wrong with sending the flat rule to a photograph. It asks
 * for the wrong criterion: a photograph is recognised by material, by scale
 * against something familiar and by context, and the outline is the least of
 * it. And on the words the realistic style exists for, it asks for something
 * that does not exist, because a room and a ceiling have no silhouette. A
 * model told to find the most recognisable outline of a room has one obvious
 * way out, which is to answer with an object standing in the room, and that
 * is the failure the style was added to stop.
 *
 * Which of those two is real gets settled by a generation and not here.
 */
const RECOGNITION: Record<ImageStyle, string> = {
  flat: `Choose the view or the state with the most recognisable silhouette. A closed book standing up could be a box, a folder or a card; an open book could be nothing else. Scissors open, not shut. A door ajar, not flat in its frame.`,

  realistic: `Recognition comes from material, scale and context, not from the outline. A photograph is known by the surface a thing is made of, by its size, read from how much of the frame it takes up and never from an object placed beside it for scale, and by where it sits, so name whichever of the three the word turns on. Some words have no outline to choose a view for at all: a room, a ceiling, a wall. Do not hunt for one, and never let an object standing inside a place stand in for the place.`,
};

/**
 * The four rules for one style, in the order they are numbered to the model.
 *
 * A function rather than a constant per style, so the two that do not depend
 * on the style are written once: a rule bought with a real generation should
 * not be sitting in two places waiting for one of them to be edited.
 *
 * Exported so the test can hold the prompt to naming all four, rather than
 * to matching a sentence someone can quietly delete.
 */
export function learnedRules(style: ImageStyle): readonly string[] {
  return [ANGLE_RULE, RECOGNITION[style], STATE_RULE, ONE_SUBJECT_RULE];
}

export function buildSubjectPrompt(
  term: string,
  kind: string,
  style: ImageStyle,
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

Describe what is in the picture, never how it is made. The medium and the colours are decided elsewhere, so naming them either repeats that or argues with it: do not write drawing, illustration, photograph, render or painting, and do not choose a palette.

Where the thing is, is a different matter. When the word names a place, or names something that only means anything in one, the surroundings are part of what the picture has to show, so describe them. When the word names a thing that could sit anywhere, leave the surroundings out: a book needs no background, and naming one argues with the setting that is already fixed.

Four rules, learned from pictures that came out wrong:

${learnedRules(style)
  .map((rule, index) => `${index + 1}. ${rule}`)
  .join("\n\n")}

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
