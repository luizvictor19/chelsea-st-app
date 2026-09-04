import {
  CHART_REFERENCE,
  DICTATION_MARKER,
  LESSON_HEADER,
  REVISION_EXERCISE_MARKER,
} from "./constants.ts";
import type { Band, OcrWord } from "./types.ts";

export type MarkerKind =
  "lesson_header" | "dictation" | "chart_ref" | "revision_exercise";

export type Marker = {
  readonly kind: MarkerKind;
  readonly number: number;
  /** The rows the phrase occupies, so its line can be told apart from prose. */
  readonly band: Band;
};

const PATTERNS: readonly { kind: MarkerKind; pattern: RegExp }[] = [
  { kind: "lesson_header", pattern: LESSON_HEADER },
  { kind: "dictation", pattern: DICTATION_MARKER },
  { kind: "chart_ref", pattern: CHART_REFERENCE },
  { kind: "revision_exercise", pattern: REVISION_EXERCISE_MARKER },
];

/**
 * Finds the fixed phrases on a page and, more usefully, where they sit.
 *
 * Matching against the joined page text rather than word by word, because every
 * one of these spans several words. An index from character offset back to word
 * keeps the position, which is what the phrase is needed for: a heading or an
 * icon caption is not prose, and its line has to be excluded before the
 * justification test runs or it lands among the explanations.
 */
export function findMarkers(words: readonly OcrWord[]): readonly Marker[] {
  const offsets: number[] = [];
  let text = "";
  for (const word of words) {
    if (text.length > 0) {
      text += " ";
    }
    offsets.push(text.length);
    text += word.text;
  }

  const wordAt = (offset: number): number => {
    // The last word starting at or before this offset.
    let low = 0;
    let high = offsets.length - 1;
    let found = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (offsets[middle] <= offset) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  };

  const markers: Marker[] = [];
  for (const { kind, pattern } of PATTERNS) {
    for (const match of text.matchAll(
      new RegExp(pattern.source, pattern.flags),
    )) {
      if (match.index === undefined || words.length === 0) {
        continue;
      }
      const first = wordAt(match.index);
      const last = wordAt(match.index + match[0].length - 1);
      let top = Infinity;
      let bottom = -Infinity;
      for (let i = first; i <= last; i += 1) {
        top = Math.min(top, words[i].y);
        bottom = Math.max(bottom, words[i].y + words[i].height);
      }
      markers.push({ kind, number: Number(match[1]), band: { top, bottom } });
    }
  }

  return markers.sort((a, b) => a.band.top - b.band.top);
}
