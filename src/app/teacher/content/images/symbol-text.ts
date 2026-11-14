/**
 * The character a word decided symbol shows in place of a picture (0064,
 * #370), as the panel writes it: the text the teacher typed, trimmed, and
 * null when nothing is left. Null is the waiting state the database accepts;
 * a blank string is what vocabulary_items_symbol_text_not_blank refuses, so
 * it never reaches the write.
 */
export function symbolTextOf(input: string): string | null {
  const text = input.trim();
  return text === "" ? null : text;
}
