import type { Metadata } from "next";
import Link from "next/link";

import { listBooks } from "@/lib/content/queries";

import { ProgressBar } from "./progress-bar";

export const metadata: Metadata = {
  title: "Conteúdo — Chelsea St",
};

export default async function ContentIndexPage() {
  const { books, overall } = await listBooks();

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 p-6 py-12">
      <header className="flex flex-col gap-3">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Conteúdo
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">Os 12 livros</h1>
        <ProgressBar progress={overall} label="Curso inteiro" emphasis />
        <Link
          href="/teacher/content/images"
          className="text-accent text-sm font-semibold"
        >
          Imagens do vocabulário →
        </Link>
      </header>

      {books.length === 0 ? (
        <p className="text-muted border-rule rounded-sm border border-dashed p-6">
          Nenhum livro cadastrado ainda.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {books.map((book) => (
            <li key={book.id}>
              <Link
                href={`/teacher/content/${book.position}`}
                className="border-rule bg-surface hover:border-accent flex flex-col gap-3 rounded-sm border p-5"
              >
                <div className="flex items-baseline gap-3">
                  <span className="text-faint font-mono text-xs">
                    {String(book.position).padStart(2, "0")}
                  </span>
                  <span className="font-bold tracking-tight">{book.title}</span>
                </div>
                <ProgressBar
                  progress={book.progress}
                  label={
                    book.lastPoint === null
                      ? "Último ponto não definido"
                      : "Pontos preenchidos"
                  }
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
