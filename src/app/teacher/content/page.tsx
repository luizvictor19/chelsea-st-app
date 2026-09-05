import type { Metadata } from "next";

import { listBooks } from "@/lib/content/queries";

import { BookCard } from "./book-card";

export const metadata: Metadata = {
  title: "Conteúdo · Chelsea St",
};

/** The course is twelve books, whether or not the database holds them yet. */
const COURSE_BOOKS = 12;

export default async function ContentIndexPage() {
  const { books, complete, total, course } = await listBooks();

  const expected = Math.max(total, COURSE_BOOKS);
  const completePercent = Math.round((complete / expected) * 100);
  // The one book to do next: the first still missing its range.
  const nextToConfigure =
    books.find((book) => book.firstPoint === null || book.lastPoint === null)
      ?.id ?? null;

  return (
    <section className="flex flex-col gap-7">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
        <div className="flex flex-col gap-2">
          <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
            Conteúdo
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Os 12 livros
          </h1>
        </div>

        <div className="flex flex-col gap-1.5 sm:w-80">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted text-sm">Livros completos</span>
            <span className="text-faint font-mono text-xs">
              {complete} de {expected}
            </span>
          </div>
          <div
            aria-hidden
            className="bg-rule h-1 w-full overflow-hidden rounded-full"
          >
            <div
              className="bg-accent h-full"
              style={{ width: `${completePercent}%` }}
            />
          </div>
          {course === null ? (
            <p className="text-faint text-xs leading-relaxed">
              A porcentagem do curso só aparece quando os 12 tiverem faixa: até
              lá não existe denominador.
            </p>
          ) : (
            <p className="text-faint text-xs leading-relaxed">
              Curso inteiro:{" "}
              <span className="text-muted font-mono">
                {course.filled} de {course.total} pontos ·{" "}
                {Math.round(course.fraction * 100)}%
              </span>
            </p>
          )}
        </div>
      </header>

      {books.length === 0 ? (
        <p className="text-muted border-rule rounded-sm border border-dashed p-6">
          Nenhum livro cadastrado ainda.
        </p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {books.map((book) => (
              <li key={book.id} className="flex">
                <BookCard book={book} next={book.id === nextToConfigure} />
              </li>
            ))}
          </ul>
          {total < COURSE_BOOKS ? (
            <p className="text-faint font-mono text-xs">
              {total} de {COURSE_BOOKS} livros cadastrados no banco.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
