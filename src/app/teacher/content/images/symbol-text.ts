import { normalizeSubject } from "./subject-store.ts";

/**
 * The character a word decided symbol shows in place of a picture (0063,
 * #370), as the panel writes it: the text the teacher typed, trimmed, and
 * null when nothing is left. The same rule as the Instrução field, so it is
 * that function: null is the waiting state the database accepts, and a blank
 * string, which vocabulary_items_symbol_text_not_blank refuses, never reaches
 * the write.
 */
export const symbolTextOf = normalizeSubject;

/**
 * The teacher's sentence for a character the database refused, or null when
 * the refusal is another one. A refusal by
 * vocabulary_items_symbol_text_only_symbol means the word stopped being a
 * symbol after this screen was loaded, in another tab or by the bulk bar.
 */
export function symbolRefusal(message: string): string | null {
  if (message.includes("vocabulary_items_symbol_text_only_symbol")) {
    return "Esta palavra não é mais Símbolo. Recarregue a página para ver o tipo atual.";
  }
  if (message.includes("vocabulary_items_symbol_text_not_blank")) {
    return "O caractere não pode ser só espaço.";
  }
  return null;
}

/** For an update that matched no row: deleted, or hidden from this account. */
export const SYMBOL_NOT_SAVED =
  "O caractere não foi salvo: a palavra não foi encontrada. Recarregue a página.";
