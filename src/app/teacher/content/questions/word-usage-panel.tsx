"use client";

import { useId, useState } from "react";

import {
  NO_USAGE,
  bandOf,
  usageTotal,
  type Band,
  type Usage,
} from "@/lib/questions/word-usage";

import { BANDS, chipTitle, meanSentence, type Light } from "./usage";

/**
 * The colour of each band, on the chip's edge and behind its number. The
 * number and the tooltip say the same thing in words, and the band with no
 * question has a dashed edge besides: the colour is never the only clue.
 */
const BAND_STYLE: Record<
  Band,
  { readonly edge: string; readonly fill: string }
> = {
  none: { edge: "border-usage-none border-dashed", fill: "bg-usage-none" },
  low: { edge: "border-usage-low", fill: "bg-usage-low" },
  medium: { edge: "border-usage-medium", fill: "bg-usage-medium" },
  high: { edge: "border-usage-high", fill: "bg-usage-high" },
};

/** A word of the vocabulary, as a chip names it. */
export type ChipWord = { readonly id: string; readonly term: string };

/** What every chip of the screen is drawn from. */
export type UsageView = {
  readonly usage: ReadonlyMap<string, Usage>;
  /** The words the open forms use: see draftLights. */
  readonly lights: ReadonlyMap<string, number>;
};

/**
 * A word with the number of questions that use it. Lit while an open form
 * uses the word, with what saving that form would add.
 */
export function UsageChip({
  word,
  mean,
  view,
}: {
  readonly word: ChipWord;
  /** The mean of the lesson that presents the word. */
  readonly mean: number;
  readonly view: UsageView;
}) {
  const usage = view.usage.get(word.id) ?? NO_USAGE;
  const total = usageTotal(usage);
  const band = bandOf(total, mean);
  const light: Light = view.lights.get(word.id) ?? null;
  const title = chipTitle(word.term, usage, band, light);
  const style = BAND_STYLE[band];
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-sm border py-0.5 pr-0.5 pl-2 text-sm ${style.edge} ${
        light === null ? "" : "bg-foreground/15 ring-foreground ring-2"
      }`}
    >
      {/* The tooltip, for a reader that never sees one. */}
      <span className="sr-only">{title}</span>
      <span aria-hidden="true">{word.term}</span>
      <span
        aria-hidden="true"
        className={`text-background min-w-5 rounded-sm px-1 text-center font-mono text-xs font-semibold ${style.fill}`}
      >
        {total}
      </span>
      {light !== null && light > 0 && (
        <span aria-hidden="true" className="pr-1 font-mono text-xs font-bold">
          +{light}
        </span>
      )}
    </span>
  );
}

/** The words of one point, in the order the point shows them. */
export type PointWords = {
  readonly point: number;
  readonly words: readonly ChipWord[];
};

/** A lesson before this one: its words, and the mean they are read against. */
export type EarlierLesson = {
  readonly lesson: number;
  readonly mean: number;
  readonly points: readonly PointWords[];
};

function isUnused(word: ChipWord, view: UsageView): boolean {
  return usageTotal(view.usage.get(word.id) ?? NO_USAGE) === 0;
}

/** The chips of a run of points, each point on a line of its own. */
function PointRows({
  points,
  mean,
  view,
  onlyUnused,
}: {
  readonly points: readonly PointWords[];
  readonly mean: number;
  readonly view: UsageView;
  readonly onlyUnused: boolean;
}) {
  const rows = points
    .map(({ point, words }) => ({
      point,
      words: onlyUnused ? words.filter((word) => isUnused(word, view)) : words,
    }))
    .filter((row) => row.words.length > 0);
  if (rows.length === 0) {
    return (
      <p className="text-faint text-sm">
        {onlyUnused
          ? "Nenhuma palavra sem pergunta aqui."
          : "Nenhuma palavra apresentada aqui."}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map(({ point, words }) => (
        <li key={point} className="flex items-baseline gap-3">
          <span className="text-faint w-16 shrink-0 font-mono text-xs">
            Ponto {point}
          </span>
          <ul className="flex flex-wrap gap-2">
            {words.map((word) => (
              <li key={word.id}>
                <UsageChip word={word} mean={mean} view={view} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Uso das palavras": every word the lesson presents, in the book's order,
 * with how many questions of the book use it, and the lessons before it
 * folded away underneath.
 *
 * A word is read against the mean of the lesson that presents it, here and
 * in the lessons before: a word of lesson 1 is not little used because
 * lesson 4 asks more.
 */
export function WordUsagePanel({
  lesson,
  mean,
  points,
  earlier,
  view,
}: {
  readonly lesson: number;
  readonly mean: number;
  readonly points: readonly PointWords[];
  readonly earlier: readonly EarlierLesson[];
  readonly view: UsageView;
}) {
  const [onlyUnused, setOnlyUnused] = useState(false);
  const titleId = useId();

  const words = points.flatMap((point) => point.words);
  const unused = words.filter((word) => isUnused(word, view)).length;
  const earlierWords = earlier.flatMap((before) =>
    before.points.flatMap((point) => point.words),
  );
  const earlierUnused = earlierWords.filter((word) =>
    isUnused(word, view),
  ).length;

  return (
    <section
      aria-labelledby={titleId}
      className="border-rule bg-surface flex flex-col gap-4 rounded-sm border p-4"
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id={titleId} className="text-lg font-extrabold tracking-tight">
            Uso das palavras
          </h2>
          <button
            type="button"
            aria-pressed={onlyUnused}
            onClick={() => setOnlyUnused(!onlyUnused)}
            className={
              onlyUnused
                ? "border-foreground bg-foreground text-background rounded-sm border px-3 py-1 text-sm font-semibold"
                : "border-rule hover:bg-background rounded-sm border px-3 py-1 text-sm font-semibold transition-colors"
            }
          >
            Só sem pergunta
          </button>
        </div>
        <p className="text-muted text-sm">
          O número é em quantas perguntas do livro a palavra aparece, publicadas
          ou não. Lição {lesson}: {words.length}{" "}
          {words.length === 1 ? "palavra" : "palavras"}, {unused} sem pergunta.{" "}
          {meanSentence(mean)}
        </p>
        <ul aria-label="Legenda" className="flex flex-wrap gap-x-4 gap-y-1">
          {BANDS.map(({ band, label }) => (
            <li key={band} className="flex items-center gap-1.5 text-xs">
              <span
                aria-hidden="true"
                className={`size-3 rounded-sm border ${BAND_STYLE[band].edge} ${BAND_STYLE[band].fill}`}
              />
              {label}
            </li>
          ))}
        </ul>
      </header>

      <PointRows
        points={points}
        mean={mean}
        view={view}
        onlyUnused={onlyUnused}
      />

      {earlier.length > 0 && (
        <details className="border-rule border-t pt-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Lições anteriores
            <span className="text-faint font-normal">
              {" "}
              · {earlierWords.length}{" "}
              {earlierWords.length === 1 ? "palavra" : "palavras"},{" "}
              {earlierUnused} sem pergunta
            </span>
          </summary>
          <div className="flex flex-col gap-4 pt-3">
            {earlier.map((before) => (
              <div key={before.lesson} className="flex flex-col gap-2">
                <h3 className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
                  Lição {before.lesson}
                </h3>
                <PointRows
                  points={before.points}
                  mean={before.mean}
                  view={view}
                  onlyUnused={onlyUnused}
                />
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
