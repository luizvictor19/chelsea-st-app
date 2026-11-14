import type { Representation, WordClass } from "@/lib/content/queries";
// Relative, with the extension: these are value imports, so they survive to
// runtime, and filters.test.ts runs under node, which resolves neither the
// @/ alias nor a missing extension.
import {
  situationOf,
  type Situation,
} from "../../../../lib/images/situation.ts";

import { REPRESENTATIONS } from "./representation.ts";
import { WORD_CLASS_LABELS } from "./word-class.ts";

export { situationOf, type Situation };

export const SITUATIONS = [
  { value: "com-imagem", label: "Com imagem" },
  { value: "sem-imagem", label: "Sem imagem ainda" },
  { value: "nao-leva", label: "Não leva imagem" },
  { value: "sem-decidir", label: "Sem decidir" },
] as const satisfies readonly { value: Situation; label: string }[];

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
    key: "situacao",
    label: "Situação",
    options: SITUATIONS.map(({ value, label }) => ({
      value: value as string,
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
    readonly symbolText: string | null;
  },
  selection: Selection,
): boolean {
  const passes = (chosen: readonly string[], value: string | null) =>
    chosen.length === 0 || (value !== null && chosen.includes(value));

  return (
    passes(selection.tipo, word.representation) &&
    passes(selection.classe, word.wordClass) &&
    passes(
      selection.situacao,
      situationOf(word.representation, word.imageUrl, word.symbolText),
    )
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
 * a picture at all. A symbol counts, and its character is its picture (0063,
 * #370).
 *
 * The denominator is not the lesson. A word of usage, metalanguage or none
 * will never show anything, and an undecided word might never take a
 * picture, so counting either would make a finished lesson read as
 * unfinished forever.
 */
export function imageCounts(
  words: readonly {
    readonly representation: Representation | null;
    readonly imageUrl: string | null;
    readonly symbolText: string | null;
  }[],
): { withImage: number; takesImage: number } {
  let withImage = 0;
  let takesImage = 0;
  for (const word of words) {
    const situation = situationOf(
      word.representation,
      word.imageUrl,
      word.symbolText,
    );
    if (situation === "com-imagem" || situation === "sem-imagem") {
      takesImage += 1;
      if (situation === "com-imagem") withImage += 1;
    }
  }
  return { withImage, takesImage };
}

/**
 * Where a scene stands. Only two of the four: a scene exists to be drawn, so
 * it is never "Não leva imagem" and never "Sem decidir".
 */
export function sceneSituation(imageUrl: string | null): Situation {
  return imageUrl === null ? "sem-imagem" : "com-imagem";
}

/**
 * Whether a scene survives the filters. Tipo and Classe are about words, and
 * a scene has neither, so either one on hides every scene; Situação applies
 * as it does to a word, and so the section is gone under "Não leva imagem"
 * or "Sem decidir" alone.
 */
export function matchesSceneSelection(
  scene: { readonly imageUrl: string | null },
  selection: Selection,
): boolean {
  if (selection.tipo.length > 0 || selection.classe.length > 0) return false;
  return (
    selection.situacao.length === 0 ||
    selection.situacao.includes(sceneSituation(scene.imageUrl))
  );
}

/** Case insensitive substring on the term. An empty search matches all. */
export function matchesSearch(term: string, search: string): boolean {
  const needle = search.trim().toLowerCase();
  return needle === "" || term.toLowerCase().includes(needle);
}

/**
 * What the panel shows: one word, one scene (#64), or nothing. One value, so
 * a link can never open both.
 */
export type Opened = {
  readonly kind: "word" | "scene";
  readonly id: string;
} | null;

/** The open word or scene from the query string; a word wins a tie. */
export function parseOpened(
  palavra: string | string[] | undefined,
  cena: string | string[] | undefined,
): Opened {
  if (typeof palavra === "string" && palavra !== "") {
    return { kind: "word", id: palavra };
  }
  if (typeof cena === "string" && cena !== "") {
    return { kind: "scene", id: cena };
  }
  return null;
}

/**
 * The whole state of the screen as a link: three filter axes, the search and
 * the open word or scene. Every control is a link, so the back button walks
 * the filters and a view can be handed to someone as a URL.
 *
 * Lives here rather than in the page because the drawer builds these too, and
 * two copies of a URL format drift.
 */
export function filterHref(
  selection: Selection,
  opened: Opened,
  term = "",
): string {
  const search = new URLSearchParams();
  for (const { key } of FILTER_GROUPS) {
    const chosen = selection[key];
    if (chosen.length > 0) search.set(key, chosen.join(","));
  }
  if (term.trim() !== "") search.set("busca", term.trim());
  if (opened !== null) {
    search.set(opened.kind === "word" ? "palavra" : "cena", opened.id);
  }
  const query = search.toString();
  return query === "" ? "/teacher/content/images" : `?${query}`;
}

/** The id of the panel column, the anchor a link from another screen aims at. */
export const SCENE_PANEL_ID = "painel";

/**
 * The point of the questions screen a scene link was followed from, so the
 * scene's panel can lead back to it (#184).
 */
export type QuestionPlace = {
  readonly book: number;
  readonly lesson: number;
  readonly point: number;
};

/**
 * A scene's panel as a link from outside this screen: absolute, since the
 * questions screen builds it too, and aimed at the panel. On a phone the
 * panel sits below the whole list, so a link that only opened it would land
 * at the top of the page with the scene out of sight.
 *
 * `from` is the question the link was followed from, carried as
 * `voltar=livro.licao.ponto` for the panel's way back. Only the link carries
 * it: filterHref does not, so the way back is gone once the teacher moves on
 * to another scene or filter.
 */
export function sceneHref(sceneId: string, from?: QuestionPlace): string {
  const search = new URLSearchParams({ cena: sceneId });
  if (from !== undefined) {
    search.set("voltar", `${from.book}.${from.lesson}.${from.point}`);
  }
  return `/teacher/content/images?${search.toString()}#${SCENE_PANEL_ID}`;
}

/**
 * The `voltar` of a scene link, or null for anything but three whole numbers
 * joined by dots: an old or hand-edited link then loses its way back and
 * nothing else.
 */
export function parseBack(
  raw: string | string[] | undefined,
): QuestionPlace | null {
  if (typeof raw !== "string") return null;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw);
  if (match === null) return null;
  return {
    book: Number(match[1]),
    lesson: Number(match[2]),
    point: Number(match[3]),
  };
}

/** The id of a point's section on the questions screen. */
export function pointAnchor(point: number): string {
  return `ponto-${point}`;
}

/** A point of the questions screen as a link, scrolled to its section. */
export function questionsHref(place: QuestionPlace): string {
  const search = new URLSearchParams({
    livro: String(place.book),
    licao: String(place.lesson),
  });
  return `/teacher/content/questions?${search.toString()}#${pointAnchor(place.point)}`;
}

export type Chip = {
  readonly key: FilterKey;
  readonly value: string;
  readonly label: string;
};

/**
 * Every filter that is on, as something the screen can show while the drawer
 * is shut.
 *
 * A filter you cannot see is a filter you forget, and then half an hour goes
 * into looking for a word the list is quietly hiding. The chips are that
 * half hour.
 */
export function activeChips(selection: Selection): readonly Chip[] {
  const chips: Chip[] = [];
  for (const group of FILTER_GROUPS) {
    for (const value of selection[group.key]) {
      const option = group.options.find((item) => item.value === value);
      chips.push({
        key: group.key,
        value,
        label: option?.label ?? value,
      });
    }
  }
  return chips;
}

/** How many filters are on, counting the search as one. */
export function activeCount(selection: Selection, search: string): number {
  return activeChips(selection).length + (search.trim() === "" ? 0 : 1);
}
