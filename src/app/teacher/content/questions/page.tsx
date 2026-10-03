import type { Metadata } from "next";
import Link from "next/link";

import { loadQuestionsScreen } from "@/lib/questions/queries";

import { LessonQuestions } from "./lesson-questions";

export const metadata: Metadata = {
  title: "Perguntas · Chelsea St",
};

/** A whole number from the query string, or null for anything else. */
function numberOf(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

export default async function QuestionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const {
    lessons,
    lesson,
    points,
    questions,
    words,
    sets,
    bookQuestions,
    bookPoints,
  } = await loadQuestionsScreen({
    book: numberOf(params.livro),
    lesson: numberOf(params.licao),
  });

  // The picker, one row per book that has lessons.
  const books = [...new Set(lessons.map((option) => option.book))].map(
    (book) => ({
      book,
      lessons: lessons.filter((option) => option.book === book),
    }),
  );

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <Link
          href="/teacher/content"
          className="text-faint hover:text-foreground font-mono text-xs transition-colors"
        >
          ← Conteúdo
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight">Perguntas</h1>
        {/*
          Every control is a link, as on the images screen: the lesson is in
          the URL, so the back button walks the lessons and a view can be
          handed to someone.
        */}
        <nav aria-label="Livro e lição" className="flex flex-col gap-2">
          {books.map(({ book, lessons: ofBook }) => (
            <div key={book} className="flex flex-wrap items-center gap-2">
              <span className="text-faint w-16 font-mono text-xs tracking-[0.16em] uppercase">
                Livro {book}
              </span>
              {ofBook.map((option) => {
                const on = option.id === lesson?.id;
                return (
                  <Link
                    key={option.id}
                    href={`?livro=${option.book}&licao=${option.number}`}
                    aria-current={on ? "page" : undefined}
                    aria-label={`Livro ${option.book}, lição ${option.number}`}
                    className={
                      on
                        ? "border-accent bg-accent text-accent-foreground rounded-sm border px-2.5 py-1 text-xs font-semibold"
                        : "border-rule hover:bg-surface rounded-sm border px-2.5 py-1 text-xs transition-colors"
                    }
                  >
                    Lição {option.number}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </header>

      {lesson === null ? (
        <p className="text-muted border-rule rounded-sm border border-dashed p-6">
          Nenhuma lição registrada ainda. Suba páginas em um livro primeiro.
        </p>
      ) : points.length === 0 ? (
        <p className="text-muted border-rule rounded-sm border border-dashed p-6">
          A lição {lesson.number} do livro {lesson.book} ainda não tem pontos.
        </p>
      ) : (
        <div className="flex max-w-4xl flex-col gap-6">
          <p className="text-muted text-sm">
            Livro {lesson.book} · Lição {lesson.number} · pontos{" "}
            {points[0].number} a {points[points.length - 1].number}. As palavras
            sublinhadas ainda não foram apresentadas até o ponto da pergunta. É
            um aviso: a decisão é sua.
          </p>
          {/*
            Keyed by lesson, so the forms of one lesson never open on the
            points of another.
          */}
          <LessonQuestions
            key={lesson.id}
            book={lesson.book}
            lesson={lesson.number}
            points={points}
            questions={questions}
            words={words}
            sets={sets}
            bookQuestions={bookQuestions}
            bookPoints={bookPoints}
          />
        </div>
      )}
    </section>
  );
}
