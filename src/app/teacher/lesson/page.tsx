import type { Metadata } from "next";

import { loadCourse } from "./course";
import { clampPosition, type Position } from "./deck";
import { LiveLesson } from "./live-lesson";

export const metadata: Metadata = {
  title: "Aula ao vivo · Chelsea St",
};

/** A whole number from the query string, or null for anything else. */
function wholeNumber(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return Number(value);
}

export default async function LiveLessonPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const course = await loadCourse();

  if (course.books.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-extrabold tracking-tight">Aula ao vivo</h1>
        <p className="text-muted border-rule rounded-sm border border-dashed p-6">
          Nenhum livro tem pontos ainda. Configure um livro em Conteúdo
          primeiro.
        </p>
      </section>
    );
  }

  // The URL holds the place: `ponto` is the point and `item` the slide inside
  // it, counted from 1. A point outside every book is no place at all, and
  // the lesson starts at the first slide of the course instead.
  const asked = wholeNumber(params.ponto);
  const inABook =
    asked !== null &&
    course.books.some(
      (book) => book.firstPoint <= asked && asked <= book.lastPoint,
    );
  const first = course.deck.at(0);
  const initial: Position = inABook
    ? clampPosition(course.deck, {
        pointNumber: asked,
        index: (wholeNumber(params.item) ?? 1) - 1,
      })
    : {
        pointNumber: first?.pointNumber ?? course.books[0].firstPoint,
        index: 0,
      };

  return <LiveLesson course={course} initial={initial} />;
}
