import type { Metadata } from "next";
import Link from "next/link";

import { listVocabularyImages, listWordAttempts } from "@/lib/content/queries";

import { ProgressBar } from "../progress-bar";
import { FILTERS, labelFor, matchesFilter } from "./representation";
import { SuggestButton } from "./suggest-button";
import { WordPanel } from "./word-panel";

export const metadata: Metadata = {
  title: "Imagens do vocabulário · Chelsea St",
};

/** Keeps the other parameter when one of them changes. */
function href(params: { word?: string | null; filter?: string }): string {
  const search = new URLSearchParams();
  if (params.filter !== undefined && params.filter !== "todas") {
    search.set("tipo", params.filter);
  }
  if (params.word) search.set("palavra", params.word);
  const query = search.toString();
  return query === "" ? "/teacher/content/images" : `?${query}`;
}

export default async function VocabularyImagesPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filter = typeof params.tipo === "string" ? params.tipo : "todas";
  const selectedId = typeof params.palavra === "string" ? params.palavra : null;

  const { lessons, progress } = await listVocabularyImages();

  const visible = lessons
    .map((lesson) => ({
      ...lesson,
      // The whole lesson, kept apart from the filtered view of it: the
      // suggestion button acts on the lesson, not on what the filter shows.
      totalWords: lesson.words.length,
      words: lesson.words.filter((word) =>
        matchesFilter(filter, word.representation),
      ),
    }))
    .filter((lesson) => lesson.words.length > 0);

  const selected =
    lessons
      .flatMap((lesson) => lesson.words)
      .find((word) => word.id === selectedId) ?? null;
  const attempts = selected === null ? [] : await listWordAttempts(selected.id);

  return (
    /*
      The screen is the viewport, not the document. Below lg it is ordinary
      flow, one column, panel under the list. From lg the section is exactly
      as tall as what the app chrome leaves it (the 3.5rem nav plus the 5rem
      of padding on the layout's main), the header and filters take their
      natural height off the top, and the two columns share whatever is left
      and scroll inside it. The previous attempt used a viewport max-height on
      a sticky panel, which only described the right height once the panel had
      scrolled up to the top: on first paint it still ran off the screen.
    */
    <section className="flex flex-col gap-8 lg:h-[calc(100dvh-8.5rem)]">
      <header className="flex flex-col gap-3">
        <Link
          href="/teacher/content"
          className="text-faint hover:text-foreground font-mono text-xs transition-colors"
        >
          ← Conteúdo
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Imagens do vocabulário
        </h1>
        <ProgressBar progress={progress} label="Palavras resolvidas" emphasis />
      </header>

      {progress.total === 0 ? (
        <p className="text-muted border-rule rounded-sm border border-dashed p-6">
          Nenhuma palavra extraída ainda. Suba páginas em um livro primeiro.
        </p>
      ) : (
        <>
          <nav aria-label="Filtros" className="flex flex-wrap gap-2">
            {FILTERS.map((option) => (
              <Link
                key={option.key}
                href={href({ filter: option.key, word: selectedId })}
                aria-current={filter === option.key ? "true" : undefined}
                className={
                  filter === option.key
                    ? "border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold"
                    : "border-rule hover:bg-surface rounded-sm border px-3 py-1.5 text-sm transition-colors"
                }
              >
                {option.label}
              </Link>
            ))}
          </nav>

          <div className="grid gap-8 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:overflow-hidden">
            <div className="flex flex-col gap-7 lg:min-h-0 lg:overflow-y-auto lg:pr-3">
              {visible.length === 0 ? (
                <p className="text-muted border-rule rounded-sm border border-dashed p-6">
                  Nenhuma palavra neste filtro.
                </p>
              ) : (
                visible.map((lesson) => (
                  <section
                    key={lesson.lessonNumber ?? "sem-licao"}
                    className="flex flex-col gap-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
                        {lesson.lessonNumber === null
                          ? "Fora de lição"
                          : `Lição ${lesson.lessonNumber}`}
                      </h2>
                      {lesson.lessonContentId !== null && (
                        <SuggestButton
                          lessonContentId={lesson.lessonContentId}
                          words={lesson.totalWords}
                        />
                      )}
                    </div>
                    <ul className="flex flex-col">
                      {lesson.words.map((word) => (
                        <li key={word.id}>
                          <Link
                            href={href({ filter, word: word.id })}
                            aria-current={
                              selectedId === word.id ? "true" : undefined
                            }
                            className={
                              selectedId === word.id
                                ? "bg-surface border-rule flex items-center justify-between gap-3 rounded-sm border px-3 py-2"
                                : "border-rule hover:bg-surface flex items-center justify-between gap-3 rounded-sm border border-transparent px-3 py-2 transition-colors"
                            }
                          >
                            <span className="flex min-w-0 items-baseline gap-3">
                              <span className="text-faint w-10 shrink-0 font-mono text-xs">
                                {word.pointNumber ?? "·"}
                              </span>
                              <span className="truncate font-semibold">
                                {word.term}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              {word.attempts > 0 && (
                                <span className="text-faint font-mono text-xs">
                                  {word.attempts}
                                </span>
                              )}
                              {/*
                                The three states of the panel buttons, said in
                                text: a decision reads as settled, a suggestion
                                reads as the accent colour proposing, and
                                neither stays faint. The suggestion disappears
                                the moment a decision exists, agreement
                                included: after that the list is about what the
                                word is, not who thought of it first.
                              */}
                              {word.representation !== null ? (
                                <span className="text-foreground text-xs">
                                  {labelFor(word.representation)}
                                </span>
                              ) : word.suggestedRepresentation !== null ? (
                                <span className="text-accent/70 text-xs">
                                  sugestão:{" "}
                                  {labelFor(word.suggestedRepresentation)}
                                </span>
                              ) : (
                                <span className="text-faint text-xs">
                                  {labelFor(null)}
                                </span>
                              )}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>

            {/*
              The panel scrolls on its own: with an approved image and a few
              attempts it is taller than the screen, and sticky alone just
              clipped the bottom of it. top-20 clears the sticky teacher nav,
              and the height is what is left of the viewport below it.
            */}
            <div className="lg:min-h-0 lg:overflow-y-auto lg:pr-1">
              {selected === null ? (
                <p className="text-muted border-rule rounded-sm border border-dashed p-6">
                  Escolha uma palavra na lista para decidir o tipo e cuidar da
                  imagem.
                </p>
              ) : (
                <WordPanel
                  key={selected.id}
                  word={selected}
                  attempts={attempts}
                />
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
