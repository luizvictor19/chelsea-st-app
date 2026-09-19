/**
 * The style half of every prompt. The teacher writes the subject and nothing
 * else: the style is not editable on the screen, because the point of having
 * one is that a few hundred pictures read as one set instead of as a few
 * hundred separate decisions.
 *
 * Decided on 2026-09-18, style 1 of three proposed. The comparison that
 * settled it is not in this repository.
 */
/**
 * The first words of every prompt: what medium this is, and what it is of.
 *
 * 2026-09-19: moving the subject to the front pushed the medium to the
 * seventh sentence. An image model weighs its opening, and the flat style is
 * the part Seedream obeys and Mystic used to ignore, so it is worth the first
 * words. The subject rides with it, which is what the reordering was for.
 */
export const MEDIUM_PROMPT = "Flat vector illustration of {subject}.";

/** Where the subject is substituted into MEDIUM_PROMPT. */
const SUBJECT_SLOT = "{subject}";

/**
 * The rest of the style, which can wait until the end.
 *
 * 2026-09-19: this used to ask for bold outlines and no shading. A real
 * generation of "sitting" ignored both and came back with no outlines at all,
 * flat shapes in solid colour, a narrow palette and a soft shadow under the
 * figure, and it was better than what had been asked for. The words are the
 * picture we want now.
 *
 * The point is not that one style beats the other. It is that while the
 * constant describes a drawing nobody wants, the result is a toss-up between
 * two of them, which is what had already happened: "book" came back thickly
 * outlined and cartoonish, "sitting" came back like this, and the set stopped
 * looking like a set. Having one style is the whole reason this constant is
 * not editable on the screen.
 */
export const STYLE_PROMPT =
  "Simple shapes, solid flat colors, no outlines, a limited muted palette, " +
  "plain warm off-white background, a soft shadow under the subject only, " +
  "no text, no letters, no numbers, no watermark. Minimal, clean, friendly. " +
  // 2026-09-19: the first real figure came back inside a black frame. The
  // style asked for a plain background and never said the background was
  // the whole image, so a border was not forbidden.
  "No frame, no border, the background fills the entire image.";

/*
 * The angle is part of what the word means, not a detail of the drawing.
 *
 * 2026-09-19: "sitting" took four attempts, and what fixed it was saying the
 * view. A seated person drawn from the front does not read as seated; the
 * bent knee in profile is what says it. The subject is where the teacher
 * names the angle, so the rule asks them to.
 */
const ANGLE =
  "The viewing angle is part of the meaning: draw the view the subject " +
  "names, and if it names none, choose the one that makes the posture or " +
  "the movement unmistakable.";

/*
 * 2026-09-19: "Single subject" used to live in the style, applying to every
 * category. It is an instruction for photographing one object, and it argues
 * with pose, action and figure, which are a person plus a thing or two things.
 * Asked for a man sitting on a chair under it, the model drew the chair and
 * left the man out. How many things are in the frame is a question each
 * category answers differently, so each category answers it below.
 */

/**
 * What has to be in the frame for each kind to be readable, appended after
 * the style.
 *
 * Its own constant with its own date, kept apart from STYLE_PROMPT because
 * the two answer different questions and were decided at different times.
 * The style says how everything is drawn; this says what the picture has to
 * contain for this kind of word, and it comes straight from the category
 * rules in docs/spec-imagens.md.
 *
 * Decided on 2026-09-19.
 */
/*
 * There is no fixed character here, and the absence is the decision.
 *
 * Tried on 2026-09-19: the rules described one man, in the same words every
 * time, and three real generations came back with a chair and nobody in it
 * and two people who matched neither the description nor each other. A text
 * to image model keeps no identity between calls, and Seedream 4 takes no
 * reference image to keep one with, so a description was the only lever and
 * it did not move anything. What it did do was lengthen every pose and
 * action prompt by two sentences.
 *
 * Character consistency waits for the tutor's scene, and for a model that
 * accepts a reference image.
 */

export const SUBJECT_RULES = {
  photo: "Single subject: show it on its own, with nothing around it.",
  // No posture may be named here. "standing still" read as the posture
  // standing, which is also a word in the vocabulary, and contradicted every
  // subject that was sitting or lying.
  pose:
    "Show the whole person, and the object they are using when the subject " +
    "names one. The posture clearly readable, and no movement. No arrow. " +
    ANGLE,
  /*
   * The arrow is a drawing device, not what makes something an action. Plenty
   * of action words have no direction for one to point at (speak, listen,
   * smile, read, write, wait, hold), and asked for an arrow unconditionally
   * the model draws one anyway, pointing at nothing.
   */
  action:
    "Show the whole person, and the object they are using when the subject " +
    "names one. The person is in the middle of the movement, the gesture at " +
    "its clearest moment. If the movement has a direction, add a simple " +
    "arrow showing it; if it does not, no arrow. " +
    ANGLE,
  figure:
    "Draw it as a diagram, with no person in it. Only the objects the " +
    "subject names, and nothing else in the background.",
} as const;

/** The kinds an image is generated for. symbol and none are not among them. */
export type DrawableKind = keyof typeof SUBJECT_RULES;

export function isDrawableKind(kind: string): kind is DrawableKind {
  return kind in SUBJECT_RULES;
}

/**
 * The full prompt for one word: the medium and the subject, then what this
 * kind has to show, then the rest of the style.
 *
 * 2026-09-19: the order is the fix, not the wording. The character used to be
 * the last sentence of the prompt, after eleven style constraints, and a
 * generation of "sitting" came back as an empty chair. Who is in the picture
 * belongs next to the subject; how it is drawn can wait until the end, except
 * for the medium, which belongs in the first words and takes the subject with
 * it.
 *
 * Refuses twice before anything is spent. A symbol is rendered by the screen
 * as the character itself and none has no picture at all, so neither has a
 * prompt to build; and an empty subject would generate from nothing. Every
 * call costs credits, so a request that was never going to produce anything
 * useful fails here rather than after it is paid for.
 */
export function buildPrompt(subject: string, kind: string): string {
  if (!isDrawableKind(kind)) {
    throw new Error(`No image is generated for ${kind}`);
  }
  // A trailing stop would land next to the one this sentence ends with.
  const cleaned = subject.trim().replace(/[.\s]+$/u, "");
  if (cleaned === "") {
    throw new Error("A prompt needs a subject");
  }
  const opening = MEDIUM_PROMPT.replace(SUBJECT_SLOT, cleaned);
  return `${opening} ${SUBJECT_RULES[kind]} ${STYLE_PROMPT}`;
}
