import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { loadBook } from "@/lib/content/queries";

import { ProgressBar } from "../progress-bar";
import { BookWorkbench } from "./book-workbench";

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

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 p-6 py-12">
      <header className="flex flex-col gap-3">
        <Link href="/teacher/content" className="text-faint font-mono text-xs">
          ← Conteúdo
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight">{book.title}</h1>
        <ProgressBar
          progress={book.progress}
          label="Pontos preenchidos"
          emphasis
        />
      </header>

      {book.gaps.length > 0 && (
        <section
          aria-label="Páginas faltando"
          className="border-accent flex flex-col gap-2 rounded-sm border p-5"
        >
          <p className="text-accent font-mono text-xs tracking-[0.16em] uppercase">
            Páginas faltando
          </p>
          <p className="text-muted">
            Há buraco na sequência. Estes pontos ficaram vazios entre pontos já
            preenchidos:
          </p>
          <ul className="flex flex-wrap gap-2">
            {book.gaps.map((gap) => (
              <li
                key={`${gap.from}-${gap.to}`}
                className="border-accent text-accent rounded-sm border px-3 py-1 font-mono text-sm"
              >
                {gap.from === gap.to ? gap.from : `${gap.from} a ${gap.to}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <BookWorkbench
        bookId={book.id}
        bookPosition={book.position}
        bookTitle={book.title}
        lastPoint={book.lastPoint}
      />

      <section aria-label="Pontos" className="flex flex-col gap-3">
        <h2 className="font-bold tracking-tight">Pontos</h2>
        {book.points.length === 0 ? (
          <p className="text-muted border-rule rounded-sm border border-dashed p-5">
            Defina o último ponto do livro para criar a lista.
          </p>
        ) : (
          <ol className="flex flex-wrap gap-1">
            {book.points.map((point) => (
              <li
                key={point.number}
                title={point.filled ? "preenchido" : "vazio"}
                className={
                  point.filled
                    ? "bg-foreground text-background rounded-sm px-2 py-1 font-mono text-xs"
                    : "border-rule text-faint rounded-sm border px-2 py-1 font-mono text-xs"
                }
              >
                {point.number}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
