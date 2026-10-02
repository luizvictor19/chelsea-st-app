"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { situationOf } from "../content/images/filters";

import { boardKey, undo, type Mark } from "./board";
import type { Course } from "./course";
import {
  levelCount,
  nextPosition,
  previousPosition,
  questionPicture,
  revealLess,
  revealMore,
  showAt,
  slidesAt,
  waitingFor,
  type DeckWord,
  type Position,
  type Slide,
} from "./deck";
import { Whiteboard } from "./whiteboard";

function subscribeToFullscreen(onChange: () => void): () => void {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

/** Whether the word is shown as its approved picture, with the term under it. */
function hasPicture(word: DeckWord): boolean {
  return situationOf(word.representation, word.imageUrl) === "com-imagem";
}

/*
 * How wide the picture is drawn, for the browser to pick a file by. The
 * pictures are square and held to the height of the stage, so the width is
 * the smaller of the column and roughly three quarters of the screen's
 * height. Without it the browser assumes the full width of the viewport and
 * asks for the largest file every time.
 */
function sizesFor(columns: number): string {
  return `min(${Math.floor(100 / columns)}vw, 75vh)`;
}

/*
 * The term as large as its column allows. The width is shared by the words
 * of the slide and the longest term sets the size for all of them, so a set
 * reads as one line of equals. 0.6em is the width of a character of this
 * face at this weight, rounded up; the second bound keeps a short word from
 * taking the height the picture needs.
 */
function termSize(slide: Slide, withPicture: boolean): string {
  const longest = Math.max(...slide.words.map((word) => word.term.length));
  const fit = 88 / slide.words.length / (0.6 * longest);
  const width = Math.min(fit, withPicture ? 7 : 16);
  return `min(${width.toFixed(2)}vw, ${withPicture ? 11 : 30}vh)`;
}

/*
 * A question, one level at a time: the picture of the word it shows, or a
 * neutral card that says which question this is; then the question; then the expected answer under
 * it. With a picture the two lines keep their place while hidden, as the term
 * of a word does, so the picture does not move.
 */
function QuestionCard({
  question,
  level,
}: {
  readonly question: NonNullable<Slide["question"]>;
  readonly level: number;
}) {
  const label = (
    <>
      Ponto {question.pointNumber} · Pergunta {question.number}
    </>
  );
  const picture = questionPicture(question);
  if (picture === null && level < 2) {
    return (
      <p className="text-muted m-auto text-center text-[min(6vw,12vh)] leading-tight font-extrabold tracking-tight">
        {label}
      </p>
    );
  }
  const pictured = picture !== null;
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[3vh] text-center">
      {picture === null ? (
        <p className="text-faint font-mono text-sm">{label}</p>
      ) : (
        <div className="relative min-h-0 w-full flex-1">
          <Image
            src={picture}
            alt=""
            fill
            sizes={sizesFor(1)}
            loading="eager"
            className="object-contain"
          />
        </div>
      )}
      <p
        className={waitingFor(
          2,
          level,
          pictured
            ? "text-[min(3.5vw,6vh)] leading-tight font-extrabold tracking-tight"
            : "text-[min(5vw,10vh)] leading-tight font-extrabold tracking-tight",
        )}
      >
        {question.prompt}
      </p>
      <p
        className={waitingFor(
          3,
          level,
          pictured
            ? "text-muted text-[min(2.8vw,5vh)] leading-tight font-semibold"
            : "text-muted text-[min(3.6vw,7vh)] leading-tight font-semibold",
        )}
      >
        {question.expectedAnswer}
      </p>
    </div>
  );
}

const controlClass =
  "border-rule bg-surface text-foreground hover:border-faint rounded-sm border px-3 py-1.5 text-sm transition-colors disabled:opacity-40";

const selectClass =
  "border-rule bg-surface text-foreground rounded-sm border px-2 py-1.5 text-sm";

export function LiveLesson({
  course,
  initial,
}: {
  readonly course: Course;
  readonly initial: Position;
}) {
  const { books, lessons, deck } = course;
  const [view, setView] = useState(() => showAt(initial));
  const { position, level } = view;
  const screen = useRef<HTMLElement>(null);
  // The whiteboard: kept here and not in the card, so what was drawn stays
  // through a change of card and while minimised. Memory only, gone on reload.
  const [boardOpen, setBoardOpen] = useState(false);
  const [marks, setMarks] = useState<readonly Mark[]>([]);
  const fullscreen = useSyncExternalStore(
    subscribeToFullscreen,
    () => document.fullscreenElement !== null,
    () => false,
  );

  const slides = slidesAt(deck, position.pointNumber);
  const slide = slides.at(position.index) ?? null;
  const next = nextPosition(deck, position);
  const previous = previousPosition(deck, position);
  const upcoming =
    next === null
      ? null
      : (slidesAt(deck, next.pointNumber).at(next.index) ?? null);

  const book =
    books.find(
      (candidate) =>
        candidate.firstPoint <= position.pointNumber &&
        position.pointNumber <= candidate.lastPoint,
    ) ?? books[0];
  const bookLessons = lessons.filter(
    (lesson) => lesson.bookPosition === book.position,
  );
  const lesson =
    bookLessons.find(
      (candidate) =>
        candidate.firstPoint <= position.pointNumber &&
        position.pointNumber <= candidate.lastPoint,
    ) ?? null;
  // The points to choose from: those of the lesson, or the whole book while
  // the point belongs to no lesson (book 2 has none yet).
  const range = lesson ?? book;
  const points = Array.from(
    { length: range.lastPoint - range.firstPoint + 1 },
    (_, offset) => range.firstPoint + offset,
  );
  const withSlides = useMemo(
    () => new Set(deck.map((item) => item.pointNumber)),
    [deck],
  );
  const anyPicture = slide?.words.some(hasPicture) ?? false;
  const levels = slide === null ? 1 : levelCount(slide, anyPicture);

  const go = useCallback((target: Position | null) => {
    if (target === null) return;
    setView(showAt(target));
    // The URL keeps the place, so a reload comes back to this slide. Replaced
    // and not pushed: forty words are not forty entries of history.
    window.history.replaceState(
      null,
      "",
      `?ponto=${target.pointNumber}&item=${target.index + 1}`,
    );
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen();
    } else {
      void screen.current?.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const tag =
        event.target instanceof HTMLElement ? event.target.tagName : "";
      // A list keeps its own arrows while it has the focus, and a text being
      // typed on the board keeps every key, the Q included.
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;

      const onBoard = boardKey(event, boardOpen);
      if (onBoard !== "pass") {
        event.preventDefault();
        if (onBoard === "toggle") setBoardOpen((open) => !open);
        if (onBoard === "undo") setMarks(undo);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(next);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(previous);
      } else if (event.key === "ArrowDown" || event.key === " ") {
        // On a button the space is that button's own click.
        if (event.key === " " && tag === "BUTTON") return;
        event.preventDefault();
        setView((current) => revealMore(current, levels));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setView(revealLess);
      } else if (event.key === "f" || event.key === "F") {
        toggleFullscreen();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, next, previous, levels, toggleFullscreen, boardOpen]);

  const upcomingPicture =
    upcoming === null || upcoming.question === null
      ? null
      : questionPicture(upcoming.question);
  const hiding = level < 2;
  const question = slide?.question ?? null;

  return (
    /*
      The screen is the viewport, as on the images screen: 8.5rem is the nav
      plus the padding of the layout's main. In full screen the element is the
      whole display and needs its own ground, since what the browser paints
      behind a full screen element is black.
    */
    <section
      ref={screen}
      className={
        fullscreen
          ? "bg-background flex h-dvh flex-col gap-4 p-6"
          : "bg-background flex h-[calc(100dvh-8.5rem)] min-h-[28rem] flex-col gap-4"
      }
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="sr-only">Aula ao vivo</h1>
        <label className="text-faint flex items-center gap-2 text-xs">
          Livro
          <select
            className={selectClass}
            value={book.position}
            onChange={(event) => {
              const chosen = books.find(
                (candidate) =>
                  candidate.position === Number(event.target.value),
              );
              if (chosen !== undefined) {
                go({ pointNumber: chosen.firstPoint, index: 0 });
              }
              event.target.blur();
            }}
          >
            {books.map((candidate) => (
              <option key={candidate.position} value={candidate.position}>
                {candidate.title}
              </option>
            ))}
          </select>
        </label>
        {bookLessons.length > 0 && (
          <label className="text-faint flex items-center gap-2 text-xs">
            Lição
            <select
              className={selectClass}
              value={lesson?.number ?? ""}
              onChange={(event) => {
                const chosen = bookLessons.find(
                  (candidate) =>
                    candidate.number === Number(event.target.value),
                );
                if (chosen !== undefined) {
                  go({ pointNumber: chosen.firstPoint, index: 0 });
                }
                event.target.blur();
              }}
            >
              {lesson === null && <option value="">sem lição</option>}
              {bookLessons.map((candidate) => (
                <option key={candidate.number} value={candidate.number}>
                  {candidate.number}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-faint flex items-center gap-2 text-xs">
          Ponto
          <select
            className={selectClass}
            value={position.pointNumber}
            onChange={(event) => {
              go({ pointNumber: Number(event.target.value), index: 0 });
              event.target.blur();
            }}
          >
            {points.map((point) => (
              <option key={point} value={point}>
                {withSlides.has(point) ? point : `${point} · sem palavras`}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={controlClass}
            onClick={toggleFullscreen}
            title="Tecla F"
          >
            {fullscreen ? "Sair da tela cheia" : "Tela cheia"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="bg-surface border-rule relative flex min-w-0 flex-1 flex-col rounded-sm border p-4">
          {!boardOpen && (
            <button
              type="button"
              className="border-rule bg-surface text-faint hover:text-foreground absolute top-2 right-2 z-10 rounded-sm border px-2 py-1 text-xs opacity-70 transition-opacity hover:opacity-100"
              onClick={() => setBoardOpen(true)}
              title="Tecla Q"
            >
              Quadro
            </button>
          )}
          <Whiteboard
            open={boardOpen}
            marks={marks}
            onMarks={setMarks}
            onMinimise={() => setBoardOpen(false)}
          />
          {slide === null ? (
            <p className="text-muted m-auto text-lg">
              Este ponto não tem palavras.
            </p>
          ) : question !== null ? (
            <QuestionCard question={question} level={level} />
          ) : (
            <div
              className="grid min-h-0 flex-1 gap-4"
              style={{
                gridTemplateColumns: `repeat(${slide.words.length}, minmax(0, 1fr))`,
                fontSize: termSize(slide, anyPicture),
              }}
            >
              {slide.words.map((word) => {
                const picture = hasPicture(word) ? word.imageUrl : null;
                const waiting =
                  situationOf(word.representation, word.imageUrl) ===
                  "sem-imagem";
                return (
                  <figure
                    key={word.id}
                    className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-3"
                  >
                    {picture !== null && (
                      <div className="relative min-h-0 w-full flex-1">
                        <Image
                          src={picture}
                          alt={hiding ? "" : word.term}
                          fill
                          sizes={sizesFor(slide.words.length)}
                          loading="eager"
                          className="object-contain"
                        />
                      </div>
                    )}
                    {/*
                      The term of a pictured word is the second level, and
                      waits for the arrow down. It keeps its place while
                      hidden, so showing it does not move the picture. A word
                      with no picture has nothing else to show, and is never
                      hidden.
                    */}
                    <figcaption
                      className={
                        hiding && picture !== null
                          ? "invisible text-center leading-tight font-extrabold tracking-tight"
                          : "text-center leading-tight font-extrabold tracking-tight"
                      }
                    >
                      {word.term}
                    </figcaption>
                    {waiting && (
                      <span className="text-faint font-mono text-xs">
                        sem imagem
                      </span>
                    )}
                  </figure>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3">
        <button
          type="button"
          className={controlClass}
          disabled={previous === null}
          onClick={() => go(previous)}
          aria-label="Cartão anterior"
          title="Seta para a esquerda"
        >
          ← Anterior
        </button>
        <span className="text-faint font-mono text-xs">
          Ponto {position.pointNumber}
          {slides.length > 0 && ` · ${position.index + 1} de ${slides.length}`}
          {levels > 1 && ` · ↓ revela · ↑ esconde`}
        </span>
        <button
          type="button"
          className={controlClass}
          disabled={next === null}
          onClick={() => go(next)}
          aria-label="Próximo cartão"
          title="Seta para a direita"
        >
          Próxima →
        </button>
      </footer>

      {/*
        The pictures of the next slide, asked for ahead of time and never
        shown, so the arrow lands on a picture that is already here. The same
        sizes as the real one, or the browser would fetch a different file.
      */}
      {upcoming !== null && (
        <div aria-hidden="true" className="pointer-events-none fixed size-0">
          {upcomingPicture !== null && (
            <Image
              src={upcomingPicture}
              alt=""
              fill
              sizes={sizesFor(1)}
              loading="eager"
              className="opacity-0"
            />
          )}
          {upcoming.words.map((word) =>
            hasPicture(word) && word.imageUrl !== null ? (
              <Image
                key={word.id}
                src={word.imageUrl}
                alt=""
                fill
                sizes={sizesFor(upcoming.words.length)}
                loading="eager"
                className="opacity-0"
              />
            ) : null,
          )}
        </div>
      )}
    </section>
  );
}
