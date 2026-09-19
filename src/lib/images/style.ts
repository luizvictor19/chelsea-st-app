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
  "text, no letters, no numbers, no watermark. Minimal, clean, friendly.";

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
export const SUBJECT_RULES = {
  photo: "Show the subject on its own, with nothing around it.",
  pose:
    "Show one person standing still, the whole body visible, the posture " +
    "clearly readable. No arrow.",
  action:
    "Show one person in the middle of the movement, with a single arrow " +
    "indicating the direction of the movement.",
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
