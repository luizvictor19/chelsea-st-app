/**
 * How a transcription is judged against what was said. Pure, so the rule can
 * be shown failing when it should, which is most of what makes it trustworthy.
 */

/**
 * Lower case, punctuation gone, spaces collapsed.
 *
 * Contractions are NOT expanded: "it's" and "it is" stay different, because
 * the tutor teaches the contraction and a transcriber that turns one into the
 * other has changed what the student said.
 *
 * So the apostrophe is the one mark that survives, and only inside a word.
 * The typographic one is folded into the straight one first, or "it’s" from
 * one provider and "it's" from another would count as different words. An
 * apostrophe at the edge of a word is a quotation mark and goes.
 *
 * Letters are any script's, so "não" keeps its tilde. Hyphens and dashes
 * become spaces: "twenty-one" is two words to this comparison, and a
 * provider that writes it either way is heard the same.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .split(" ")
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter((word) => word !== "")
    .join(" ");
}

function words(text: string): string[] {
  const normal = normalize(text);
  return normal === "" ? [] : normal.split(" ");
}

/**
 * Whether `phrase` appears in `text` as whole words, in order and adjacent.
 *
 * Whole words, not characters: as a substring, "is pen" is found inside
 * "this pen", and "is close" inside "is closed", which would count a
 * corrected transcription as one that kept the mistake.
 */
export function containsPhrase(text: string, phrase: string): boolean {
  const haystack = words(text);
  const needle = words(phrase);
  if (needle.length === 0) return false;
  for (let at = 0; at + needle.length <= haystack.length; at++) {
    if (needle.every((word, offset) => haystack[at + offset] === word)) {
      return true;
    }
  }
  return false;
}

/**
 * The criterion the whole measurement is for: the mistake is there as it was
 * said, and the correction is not.
 *
 * Both halves are needed. A transcription that holds the error and the
 * correction side by side ("the pens is black, the pens are black") shows
 * the transcriber reaching for the right answer, and the tutor reading it
 * cannot tell which one the student said.
 */
export function errorPreserved(
  transcript: string,
  errorSpan: string,
  correctedSpan: string,
): boolean {
  return (
    containsPhrase(transcript, errorSpan) &&
    !containsPhrase(transcript, correctedSpan)
  );
}

/** Same words, after normalisation. */
export function matchesSpoken(transcript: string, spoken: string): boolean {
  return normalize(transcript) === normalize(spoken);
}

/** Nothing but punctuation and space, which is the right answer to silence. */
export function isEmptyTranscript(transcript: string): boolean {
  return normalize(transcript) === "";
}
