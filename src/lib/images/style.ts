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
 * The full prompt for one word.
 *
 * Throws on an empty subject rather than generating from "illustration of .".
 * Every call costs credits, so a prompt that was never going to produce
 * anything useful should fail before it is sent, not after it is paid for.
 */
export function buildPrompt(subject: string): string {
  // A trailing stop would land next to the one already in the sentence.
  const cleaned = subject.trim().replace(/[.\s]+$/u, "");
  if (cleaned === "") {
    throw new Error("A prompt needs a subject");
  }
  return STYLE_PROMPT.replace(SUBJECT_SLOT, cleaned);
}
