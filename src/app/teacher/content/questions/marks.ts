// Relative, with the extension, for marks.test.ts under node.
import type { Mark, Place } from "../../../../lib/questions/presented.ts";

/**
 * How the validator's marks are shown: the stretches of a sentence to
 * underline, and one line naming each word once with where it stands.
 */

/** A stretch of the text, marked or not, in order and covering all of it. */
export type Segment = {
  readonly text: string;
  readonly mark: Mark | null;
};

/** The text cut at its marks. Marks are in order and never overlap. */
export function segments(
  text: string,
  marks: readonly Mark[],
): readonly Segment[] {
  const parts: Segment[] = [];
  let from = 0;
  for (const mark of marks) {
    if (mark.start > from) {
      parts.push({ text: text.slice(from, mark.start), mark: null });
    }
    parts.push({ text: text.slice(mark.start, mark.end), mark });
    from = mark.end;
  }
  if (from < text.length) parts.push({ text: text.slice(from), mark: null });
  return parts;
}

/**
 * Where a marked word stands, seen from the point of the question: "fora do
 * vocabulário" for a word no item carries, "só no ponto 26" for one that
 * comes later. The book is named only when it is another one.
 */
export function standing(mark: Mark, at: Place): string {
  if (mark.presentedAt === null) return "fora do vocabulário";
  return mark.presentedAt.book === at.book
    ? `só no ponto ${mark.presentedAt.point}`
    : `só no livro ${mark.presentedAt.book}, ponto ${mark.presentedAt.point}`;
}

/**
 * "London (só no ponto 26), Windsor (fora do vocabulário)": each marked word
 * once, in the order it first appears, however many times it is written.
 * Empty when there is no mark.
 */
export function summary(marks: readonly Mark[], at: Place): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const mark of marks) {
    const key = mark.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`${mark.word} (${standing(mark, at)})`);
  }
  return parts.join(", ");
}
