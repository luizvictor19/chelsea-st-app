import type { Metadata } from "next";
import Link from "next/link";

import { listVocabularyImages, listWordAttempts } from "@/lib/content/queries";

import { ProgressBar } from "../progress-bar";
import { overwriteWarning } from "@/lib/images/suggest";

import {
  FILTER_GROUPS,
  matchesSelection,
  parseSelection,
  situationOf,
  toggled,
  type FilterKey,
  type Selection,
  type Situation,
} from "./filters";
import { disagreement, labelFor } from "./representation";
import { SuggestButton } from "./suggest-button";
import { WordPanel } from "./word-panel";

export const metadata: Metadata = {
  title: "Imagens do vocabulário · Chelsea St",
};

/**
 * The whole state of the screen as a link: three filter axes and the selected
 * word. Every control is a link, so the back button walks the filters and a
 * view can be pasted to someone.
 */
function href(selection: Selection, word: string | null): string {
  const search = new URLSearchParams();
  for (const { key } of FILTER_GROUPS) {
    const chosen = selection[key];
    if (chosen.length > 0) search.set(key, chosen.join(","));
  }
  if (word) search.set("palavra", word);
  const query = search.toString();
  return query === "" ? "/teacher/content/images" : `?${query}`;
}

/** The tick, the waiting circle, or nothing. */
function StatusMark({ situation }: { readonly situation: Situation }) {
  if (situation === "com-imagem") {
    return (
      <svg
        viewBox="0 0 16 16"
        className="text-foreground size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        role="img"
        aria-label="com imagem"
      >
        <path d="M3 8.5l3.5 3.5L13 4.5" />
      </svg>
    );
  }
  if (situation === "sem-imagem") {
    return (
      <svg
        viewBox="0 0 16 16"
        className="text-faint size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="2.5 2"
        role="img"
        aria-label="sem imagem ainda"
      >
        <circle cx="8" cy="8" r="5.25" />
      </svg>
    );
  }
  return <span className="size-3.5" aria-hidden="true" />;
}

export default async function VocabularyImagesPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const selection: Selection = {
    tipo: parseSelection(params.tipo),
    classe: parseSelection(params.classe),
    situacao: parseSelection(params.situacao),
  };
  const selectedId = typeof params.palavra === "string" ? params.palavra : null;

  const { lessons, progress } = await listVocabularyImages();

  const visible = lessons
    .map((lesson) => ({
      ...lesson,
      // The whole lesson, kept apart from the filtered view of it: the
      // suggestion button acts on the lesson, not on what the filter shows.
      // Both the count it is disabled by and the count it warns with are
      // taken here, before the filter, for the same reason.
      totalWords: lesson.words.length,
      withImage: lesson.words.filter((word) => word.imageUrl !== null).length,
      overwrite: overwriteWarning(lesson.words),
      words: lesson.words.filter((word) => matchesSelection(word, selection)),
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
          {/*
            Three axes, each a labelled group, multi select inside a group and
            all three required at once. Every option is a link, so the whole
            state is the query string: the back button walks the filters and a
            view can be handed to someone as a URL.
          */}
          <nav aria-label="Filtros" className="flex flex-col gap-2">
            {FILTER_GROUPS.map((group) => (
              <div
                key={group.key}
                className="flex flex-wrap items-baseline gap-2"
              >
                <span className="text-faint w-16 shrink-0 font-mono text-xs tracking-[0.16em] uppercase">
                  {group.label}
                </span>
                {group.options.map((option) => {
                  const on = selection[group.key as FilterKey].includes(
                    option.value,
                  );
                  return (
                    <Link
                      key={option.value}
                      href={href(
                        toggled(
                          selection,
                          group.key as FilterKey,
                          option.value,
                        ),
                        selectedId,
                      )}
                      aria-pressed={on}
                      className={
                        on
                          ? "border-foreground bg-foreground text-background rounded-sm border px-2.5 py-1 text-xs font-semibold"
                          : "border-rule hover:bg-surface rounded-sm border px-2.5 py-1 text-xs transition-colors"
                      }
                    >
                      {option.label}
                    </Link>
                  );
                })}
              </div>
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
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                      <h2 className="text-faint mr-auto font-mono text-xs tracking-[0.16em] uppercase">
                        {lesson.lessonNumber === null
                          ? "Fora de lição"
                          : `Lição ${lesson.lessonNumber}`}
                      </h2>
                      {/*
                        The two counts read left to right and the button sits
                        after them: how much of the lesson is done, how much
                        has been proposed, and then the control that changes
                        the second number.
                      */}
                      <span className="text-faint text-xs whitespace-nowrap">
                        {lesson.withImage}/{lesson.totalWords} com imagem
                      </span>
                      <span className="text-faint text-xs whitespace-nowrap">
                        {lesson.overwrite.suggestions}/{lesson.totalWords} com
                        sugestão
                      </span>
                      {lesson.lessonContentId !== null && (
                        <SuggestButton
                          lessonContentId={lesson.lessonContentId}
                          words={lesson.totalWords}
                          existingSuggestions={lesson.overwrite.suggestions}
                          existingClasses={lesson.overwrite.classes}
                        />
                      )}
                    </div>
                    <ul className="flex flex-col">
                      {lesson.words.map((word) => (
                        <li key={word.id}>
                          <Link
                            href={href(selection, word.id)}
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
                              {/*
                                Where the word stands, as a mark rather than a
                                number: a tick once the picture exists, a
                                hollow circle while one is owed, and nothing
                                at all for a word that is undecided or will
                                never have one. Silence is the right answer
                                twice here, for opposite reasons.
                              */}
                              <StatusMark
                                situation={situationOf(
                                  word.representation,
                                  word.imageUrl,
                                )}
                              />
                              {/*
                                Amber is the model talking and the accent is
                                the teacher deciding, so both things the model
                                says are amber: what it proposes for an
                                undecided word, and what it still thinks about
                                a word decided against it. Agreement is not
                                worth the space; disagreement is the point.
                              */}
                              {word.representation !== null ? (
                                <span className="text-foreground text-xs">
                                  {labelFor(word.representation)}
                                  {disagreement(
                                    word.representation,
                                    word.suggestedRepresentation,
                                  ) !== null && (
                                    <span className="text-warning/90">
                                      {" "}
                                      ·{" "}
                                      {labelFor(
                                        word.suggestedRepresentation,
                                      ).toLowerCase()}
                                      ?
                                    </span>
                                  )}
                                </span>
                              ) : word.suggestedRepresentation !== null ? (
                                <span className="text-warning text-xs">
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
