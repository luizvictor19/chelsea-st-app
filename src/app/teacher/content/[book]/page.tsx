import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { loadBook } from "@/lib/content/queries";

import { ProgressBar } from "../progress-bar";
import {
  BookWorkbench,
  InterruptedBatch,
  RangeForm,
  ReviewRegion,
  UploadArea,
} from "./book-workbench";
import { PointGrid } from "./point-grid";
import { SetupSteps } from "./setup-steps";

export const metadata: Metadata = {
  title: "Livro — Chelsea St",
};

export default async function BookPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book: raw } = await params;
  const position = Number(raw);
  if (!Number.isInteger(position)) {
    notFound();
  }

  const book = await loadBook(position);
  if (book === null) {
    notFound();
  }

  const hasRange = book.firstPoint !== null && book.lastPoint !== null;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href="/teacher/content"
          className="text-faint hover:text-foreground font-mono text-xs transition-colors"
        >
          ← Conteúdo
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
          <h1 className="text-3xl font-extrabold tracking-tight">
            {book.title}
          </h1>
          {hasRange ? (
            <div className="sm:w-[21.25rem]">
              <ProgressBar
                progress={book.progress}
                label="Pontos preenchidos"
                emphasis
              />
            </div>
          ) : (
            <span className="text-faint font-mono text-xs">livro vazio</span>
          )}
        </div>
      </header>

      <BookWorkbench
        bookId={book.id}
        bookPosition={book.position}
        bookTitle={book.title}
        firstPoint={book.firstPoint}
        lastPoint={book.lastPoint}
      >
        {hasRange ? (
          <div className="flex flex-col gap-4">
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-4">
                <section
                  aria-label="Faixa do livro"
                  className="border-rule bg-surface flex flex-col gap-3.5 rounded-sm border p-5"
                >
                  <div className="flex flex-col gap-1.5">
                    <h2 className="font-bold tracking-tight">Faixa do livro</h2>
                    <p className="text-muted text-sm leading-relaxed">
                      Os dois números vêm do próprio livro, lidos na primeira e
                      na última página. Juntos são o piso e o teto que validam a
                      leitura da margem.
                    </p>
                  </div>
                  <RangeForm />
                </section>

                <UploadArea />

                <InterruptedBatch />
              </div>

              <PointGrid
                points={book.points}
                lessons={book.lessons}
                gaps={book.gaps}
                lastFilledPoint={book.lastFilledPoint}
                lastFilledLesson={book.lastFilledLesson}
              />
            </div>

            <ReviewRegion />
          </div>
        ) : (
          <SetupSteps />
        )}
      </BookWorkbench>
    </section>
  );
}
