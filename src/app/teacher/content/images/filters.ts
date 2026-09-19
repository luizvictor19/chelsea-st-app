import type { Representation, WordClass } from "@/lib/content/queries";
// Relative, with the extension: these are value imports, so they survive to
// runtime, and filters.test.ts runs under node, which resolves neither the
// @/ alias nor a missing extension.
import { isDrawableKind } from "../../../../lib/images/style.ts";

import { REPRESENTATIONS } from "./representation.ts";
import { WORD_CLASS_LABELS } from "./word-class.ts";

/**
 * Where a word stands, as one of four states that partition the vocabulary:
 * every word is in exactly one, so the four counts always add up to the
 * whole and a word can never hide between filters.
 */
export type Situation =
  "com-imagem" | "sem-imagem" | "nao-leva" | "sem-decidir";

export const SITUATIONS = [
  { value: "com-imagem", label: "Com imagem" },
  { value: "sem-imagem", label: "Sem imagem ainda" },
  { value: "nao-leva", label: "Não leva imagem" },
  { value: "sem-decidir", label: "Sem decidir" },
] as const satisfies readonly { value: Situation; label: string }[];

export function situationOf(
  representation: Representation | null,
  imageUrl: string | null,
): Situation {
  if (representation === null) return "sem-decidir";
  // none and symbol are decided and will never have a picture, which is not
  // the same as waiting for one.
  if (!isDrawableKind(representation)) return "nao-leva";
  return imageUrl === null ? "sem-imagem" : "com-imagem";
}

/** The three axes, each filtering independently of the others. */
export const FILTER_GROUPS = [
  {
    key: "tipo",
    label: "Tipo",
    options: REPRESENTATIONS.map(({ kind, label }) => ({
      value: kind as string,
      label,
    })),
  },
  {
    key: "classe",
    label: "Classe",
    options: WORD_CLASS_LABELS.map(({ value, label }) => ({
      value: value as string,
      label,
    })),
  },
  {
    key: "situacao",
    label: "Situação",
    options: SITUATIONS.map(({ value, label }) => ({
      value: value as string,
      label,
    })),
  },
] as const;

export type FilterKey = (typeof FILTER_GROUPS)[number]["key"];

/** One axis of the query string, as a set. Absent or empty means no filter. */
export function parseSelection(raw: string | string[] | undefined): string[] {
  const text = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

export type Selection = Readonly<Record<FilterKey, readonly string[]>>;

/**
 * Whether a word survives all three axes.
 *
 * An empty axis constrains nothing, so no filter selected shows everything,
 * and the axes are ANDed while the values inside one are ORed: Foto or
 * Postura, and a noun, and waiting for a picture.
 */
export function matchesSelection(
  word: {
    readonly representation: Representation | null;
    readonly wordClass: WordClass | null;
    readonly imageUrl: string | null;
  },
  selection: Selection,
): boolean {
  const passes = (chosen: readonly string[], value: string | null) =>
    chosen.length === 0 || (value !== null && chosen.includes(value));

  return (
    passes(selection.tipo, word.representation) &&
    passes(selection.classe, word.wordClass) &&
    passes(selection.situacao, situationOf(word.representation, word.imageUrl))
  );
}

/** The query string with one value toggled inside its group. */
export function toggled(
  selection: Selection,
  key: FilterKey,
  value: string,
): Selection {
  const current = selection[key];
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  return { ...selection, [key]: next };
}

/**
 * How many of a lesson's words have their picture, out of the ones that take
 * a picture at all.
 *
 * The denominator is not the lesson. A word decided as none or symbol will
 * never have an image, and an undecided word might never take one, so
 * counting either would make a finished lesson read as unfinished forever.
 */
export function imageCounts(
  words: readonly {
    readonly representation: Representation | null;
    readonly imageUrl: string | null;
  }[],
): { withImage: number; takesImage: number } {
  let withImage = 0;
  let takesImage = 0;
  for (const word of words) {
    const situation = situationOf(word.representation, word.imageUrl);
    if (situation === "com-imagem" || situation === "sem-imagem") {
      takesImage += 1;
      if (situation === "com-imagem") withImage += 1;
    }
  }
  return { withImage, takesImage };
}

/** Case insensitive substring on the term. An empty search matches all. */
export function matchesSearch(term: string, search: string): boolean {
  const needle = search.trim().toLowerCase();
  return needle === "" || term.toLowerCase().includes(needle);
}

/** Whether anything is narrowing the list, which is when Limpar is worth showing. */
export function hasAnyFilter(selection: Selection, search: string): boolean {
  return (
    search.trim() !== "" ||
    FILTER_GROUPS.some((group) => selection[group.key].length > 0)
  );
}
