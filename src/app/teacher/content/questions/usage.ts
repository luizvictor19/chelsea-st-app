// Relative, with the extension, for usage.test.ts under node.
import {
  HIGH_ABOVE,
  LOW_BELOW,
  NO_USAGE,
  countedSentences,
  meanUsage,
  usageTotal,
  type Band,
  type Usage,
  type UsageReader,
} from "../../../../lib/questions/word-usage.ts";

/**
 * How the usage count is shown: the name of each band, the sentence a chip
 * says when pointed at, the lessons the panel lists and the words an open
 * form lights. Pure, so it is tested here and the components only draw it.
 */

/** The bands in the order the legend shows them, each by its name. */
export const BANDS = [
  { band: "none", label: "sem pergunta" },
  { band: "low", label: "pouco usada" },
  { band: "medium", label: "uso médio" },
  { band: "high", label: "muito usada" },
] as const satisfies readonly { band: Band; label: string }[];

export function bandLabel(band: Band): string {
  return BANDS.find((entry) => entry.band === band)?.label ?? band;
}

/** "2,3": a mean or a line between bands, as a Brazilian reads a number. */
export function decimal(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function questions(count: number): string {
  return count === 1 ? "1 pergunta" : `${count} perguntas`;
}

function split(usage: Usage): string {
  const published =
    usage.published === 1 ? "1 publicada" : `${usage.published} publicadas`;
  const unpublished =
    usage.unpublished === 1
      ? "1 não publicada"
      : `${usage.unpublished} não publicadas`;
  return `${published}, ${unpublished}`;
}

/**
 * What an open form does to a word: null when no form uses it, otherwise how
 * many questions the forms would add to its count, which is zero for a word
 * the question being edited already had.
 */
export type Light = number | null;

/**
 * The chip's tooltip, which is also what a screen reader says for it: the
 * band in words, so the colour is never the only way to know it.
 *
 * "pen · 3 perguntas (2 publicadas, 1 não publicada) · uso médio"
 */
export function chipTitle(
  term: string,
  usage: Usage,
  band: Band,
  light: Light,
): string {
  const total = usageTotal(usage);
  const parts = [
    term,
    ...(total === 0 ? [] : [`${questions(total)} (${split(usage)})`]),
    bandLabel(band),
  ];
  if (light !== null) {
    parts.push(
      light === 0
        ? "o rascunho aberto usa esta palavra"
        : `o rascunho aberto soma ${light}`,
    );
  }
  return parts.join(" · ");
}

/** "Média da lição: 2,3 perguntas por palavra." and where the lines fall. */
export function meanSentence(mean: number): string {
  if (mean === 0) return "Nenhuma palavra desta lição tem pergunta ainda.";
  return `Média da lição: ${decimal(mean)} por palavra. Pouco usada abaixo de ${decimal(LOW_BELOW * mean)}, muito usada acima de ${decimal(HIGH_ABOVE * mean)}.`;
}

/** The mean of a lesson: over every word it presents, the unused included. */
export function lessonMean(
  ids: readonly string[],
  usage: ReadonlyMap<string, Usage>,
): number {
  return meanUsage(ids.map((id) => usageTotal(usage.get(id) ?? NO_USAGE)));
}

/**
 * The lessons of the book before `lesson`, in order, each with its points.
 * A point no lesson holds yet is in none of them.
 */
export function earlierLessons(
  bookPoints: readonly {
    readonly number: number;
    readonly lesson: number | null;
  }[],
  lesson: number,
): readonly { readonly lesson: number; readonly points: readonly number[] }[] {
  const byLesson = new Map<number, number[]>();
  for (const point of bookPoints) {
    if (point.lesson === null || point.lesson >= lesson) continue;
    const points = byLesson.get(point.lesson) ?? [];
    points.push(point.number);
    byLesson.set(point.lesson, points);
  }
  return [...byLesson.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, points]) => ({
      lesson: number,
      points: [...points].sort((a, b) => a - b),
    }));
}

/** The sentences of a question, as countedSentences reads them. */
type Sentences = Parameters<typeof countedSentences>[0];

/** A form that is open: what it holds, and the question it edits, if any. */
export type OpenDraft = {
  readonly draft: Sentences;
  /** As the count has it now; null for a question not added yet. */
  readonly saved: Sentences | null;
};

/**
 * The words the open forms use, each with what saving would add to it.
 *
 * A new question adds one to every word it uses. An edit adds one only to
 * the words the stored question does not have: the others are already in
 * the count, and are lit with nothing to add.
 */
export function draftLights(
  reader: UsageReader,
  open: readonly OpenDraft[],
): ReadonlyMap<string, number> {
  const lights = new Map<string, number>();
  for (const { draft, saved } of open) {
    const before =
      saved === null ? new Set<string>() : reader.used(countedSentences(saved));
    for (const id of reader.used(countedSentences(draft))) {
      lights.set(id, (lights.get(id) ?? 0) + (before.has(id) ? 0 : 1));
    }
  }
  return lights;
}
