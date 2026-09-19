import type { WordClass } from "@/lib/content/queries";

/**
 * The twelve classes with their Portuguese names, in the order the select
 * offers them.
 *
 * Like REPRESENTATIONS, this cannot come from the database: the labels are
 * Portuguese and the enum is not. word-class.test.ts holds the part that can
 * be checked, that the list covers the enum exactly, so a class added to the
 * database and forgotten here is a red test rather than a value the select
 * can show but never set.
 */
export const WORD_CLASS_LABELS = [
  { value: "noun", label: "Substantivo" },
  { value: "verb", label: "Verbo" },
  { value: "adjective", label: "Adjetivo" },
  { value: "adverb", label: "Advérbio" },
  { value: "pronoun", label: "Pronome" },
  { value: "preposition", label: "Preposição" },
  { value: "determiner", label: "Determinante" },
  { value: "conjunction", label: "Conjunção" },
  { value: "numeral", label: "Numeral" },
  { value: "question_word", label: "Palavra interrogativa" },
  { value: "interjection", label: "Interjeição" },
  { value: "phrase", label: "Locução" },
] as const satisfies readonly { value: WordClass; label: string }[];

export function wordClassLabel(value: WordClass | null): string {
  if (value === null) return "sem classe";
  return WORD_CLASS_LABELS.find((item) => item.value === value)?.label ?? value;
}
