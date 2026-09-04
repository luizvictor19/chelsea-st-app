import type { Metadata } from "next";
import Link from "next/link";

import { listWordsWithoutImage } from "@/lib/content/queries";

import { ProgressBar } from "../progress-bar";

export const metadata: Metadata = {
  title: "Imagens do vocabulário — Chelsea St",
};

export default async function VocabularyImagesPage() {
  const { words, progress } = await listWordsWithoutImage();

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 p-6 py-12">
      <header className="flex flex-col gap-3">
        <Link href="/teacher/content" className="text-faint font-mono text-xs">
          ← Conteúdo
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Imagens do vocabulário
        </h1>
        <ProgressBar progress={progress} label="Palavras com imagem" emphasis />
      </header>

      {words.length === 0 ? (
        <p className="text-muted border-rule rounded-sm border border-dashed p-6">
          {progress.total === 0
            ? "Nenhuma palavra extraída ainda. Suba páginas em um livro primeiro."
            : "Todas as palavras já têm imagem."}
        </p>
      ) : (
        <section
          aria-label="Palavras sem imagem"
          className="flex flex-col gap-3"
        >
          <p className="text-muted text-sm">
            {words.length} palavra(s) esperando imagem, na ordem em que aparecem
            no curso.
          </p>
          <ul className="flex flex-col gap-2">
            {words.map((word) => (
              <li
                key={word.id}
                className="border-rule bg-surface flex flex-wrap items-center justify-between gap-3 rounded-sm border p-4"
              >
                <div className="flex flex-col">
                  <span className="font-semibold">{word.term}</span>
                  {word.firstPointNumber !== null && (
                    <span className="text-faint font-mono text-xs">
                      ponto {word.firstPointNumber}
                    </span>
                  )}
                </div>
                <span className="text-faint text-sm">
                  upload chega na próxima fase
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
