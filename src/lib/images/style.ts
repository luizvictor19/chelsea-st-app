/**
 * The style half of every prompt. The teacher writes the subject and nothing
 * else: the style is not editable on the screen, because the point of having
 * one is that a few hundred pictures read as one set instead of as a few
 * hundred separate decisions.
 *
 * Decided on 2026-09-18, style 1 of three proposed. The comparison that
 * settled it is not in this repository.
 */
export const STYLE_PROMPT =
  "Flat vector illustration of {subject}. Single subject, centered, bold " +
  "outlines, flat colors, no shading, plain warm off-white background, no " +
  "text, no letters, no numbers, no watermark. Minimal, clean, friendly. " +
  // 2026-09-19: the first real figure came back inside a black frame. The
  // style asked for a plain background and never said the background was
  // the whole image, so a border was not forbidden.
  "No frame, no border, the background fills the entire image.";

/** Where the subject is substituted into STYLE_PROMPT. */
const SUBJECT_SLOT = "{subject}";

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
/**
 * The person in every pose and action, described the same way each time.
 *
 * 2026-09-19: the first two real images each invented their own person, and
 * one of them changed the colour of its own shirt between the top and the
 * bottom of the figure. Nothing in the style said the character was fixed,
 * so nothing kept it fixed.
 *
 * This is the minimum cast, one man, enough to make a set of pictures look
 * like one course. It gets replaced by the cast of the scene once
 * spec-tutor.md exists and says who the student is looking at.
 */
const CHARACTER =
  "Always the same character: a man with short dark hair, a plain white " +
  "t-shirt, blue trousers and brown shoes. Keep every color flat and " +
  "consistent across the whole figure.";

export const SUBJECT_RULES = {
  photo: "Show the subject on its own, with nothing around it.",
  // No posture may be named here. "standing still" read as the posture
  // standing, which is also a word in the vocabulary, and contradicted every
  // subject that was sitting or lying.
  pose:
    "Show the whole body, the posture clearly readable, and no movement. " +
    "No arrow. " +
    CHARACTER,
  /*
   * The arrow is a drawing device, not what makes something an action. Plenty
   * of action words have no direction for one to point at (speak, listen,
   * smile, read, write, wait, hold), and asked for an arrow unconditionally
   * the model draws one anyway, pointing at nothing.
   */
  action:
    "Show one person in the middle of the movement, the whole body visible, " +
    "the gesture at its clearest moment. If the movement has a direction, " +
    "add a simple arrow showing it; if it does not, no arrow. " +
    CHARACTER,
  figure: "Draw it as a diagram, with no person in it.",
} as const;

/** The kinds an image is generated for. symbol and none are not among them. */
export type DrawableKind = keyof typeof SUBJECT_RULES;

export function isDrawableKind(kind: string): kind is DrawableKind {
  return kind in SUBJECT_RULES;
}

/**
 * The full prompt for one word: the style, the subject, and what this kind of
 * word has to show.
 *
 * Refuses twice before anything is spent. A symbol is rendered by the screen
 * as the character itself and none has no picture at all, so neither has a
 * prompt to build; and an empty subject would generate from "illustration
 * of .". Every call costs credits, so a request that was never going to
 * produce anything useful fails here rather than after it is paid for.
 */
export function buildPrompt(subject: string, kind: string): string {
  if (!isDrawableKind(kind)) {
    throw new Error(`No image is generated for ${kind}`);
  }
  // A trailing stop would land next to the one already in the sentence.
  const cleaned = subject.trim().replace(/[.\s]+$/u, "");
  if (cleaned === "") {
    throw new Error("A prompt needs a subject");
  }
  return `${STYLE_PROMPT.replace(SUBJECT_SLOT, cleaned)} ${SUBJECT_RULES[kind]}`;
}
