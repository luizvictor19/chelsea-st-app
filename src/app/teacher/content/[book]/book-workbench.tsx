"use client";

import { useState } from "react";

import {
  extractPage,
  resolveBatch,
  type ResolvedPage,
} from "@/lib/extraction/pipeline";
import { createTesseractReader } from "@/lib/extraction/ocr-tesseract";

import { configureBook } from "../actions";
import { bitmapToCanvas, fileToBitmap } from "./browser-bitmap";
import { ReviewPanel } from "./review-panel";

/** A page that could not be read, kept so the batch can carry on without it. */
export type PageFailure = {
  readonly id: string;
  readonly reason: string;
};

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "reading"; readonly done: number; readonly total: number }
  | {
      readonly kind: "reviewing";
      readonly pages: readonly ResolvedPage[];
      readonly failures: readonly PageFailure[];
    }
  | { readonly kind: "failed"; readonly message: string };

export function BookWorkbench({
  bookId,
  bookTitle,
  lastPoint,
}: {
  bookId: string;
  bookTitle: string;
  lastPoint: number | null;
}) {
  const [ceiling, setCeiling] = useState(
    lastPoint === null ? "" : String(lastPoint),
  );
  const [savingCeiling, setSavingCeiling] = useState(false);
  const [ceilingError, setCeilingError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  async function saveCeiling() {
    const value = Number(ceiling);
    if (!Number.isInteger(value) || value < 1) {
      setCeilingError("Digite um número inteiro maior que zero.");
      return;
    }
    setSavingCeiling(true);
    setCeilingError(null);
    const result = await configureBook(bookId, value);
    setSavingCeiling(false);
    if (result.status === "error") {
      setCeilingError(result.message);
    }
  }

  async function readFiles(files: FileList) {
    if (lastPoint === null) {
      setPhase({
        kind: "failed",
        message: "Defina o último ponto do livro antes de subir páginas.",
      });
      return;
    }

    const list = [...files];
    setPhase({ kind: "reading", done: 0, total: list.length });

    // The engine runs here, in the teacher's browser. The pages never leave the
    // machine and the raw text never reaches the database: only what comes back
    // from the review below is written.
    const reader = createTesseractReader({
      encode: async (image) => bitmapToCanvas(image),
    });

    try {
      const extractions = [];
      const failures: PageFailure[] = [];
      for (const [index, file] of list.entries()) {
        // One bad page must not cost the other fifty-nine. It is named in the
        // review with its reason, and the batch carries on without it.
        try {
          const bitmap = await fileToBitmap(file);
          extractions.push(await extractPage(file.name, index, bitmap, reader));
        } catch (error) {
          failures.push({
            id: file.name,
            reason:
              error instanceof Error ? error.message : "erro desconhecido",
          });
        }
        setPhase({ kind: "reading", done: index + 1, total: list.length });
      }
      setPhase({
        kind: "reviewing",
        pages: resolveBatch(extractions, lastPoint),
        failures,
      });
    } finally {
      await reader.close();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label="Último ponto do livro"
        className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-5"
      >
        <h2 className="font-bold tracking-tight">Último ponto do livro</h2>
        <p className="text-muted text-sm">
          É o teto que valida a leitura da margem. Sem ele nenhuma página pode
          ser lida.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            aria-label="Último ponto"
            inputMode="numeric"
            value={ceiling}
            onChange={(event) => setCeiling(event.target.value)}
            className="border-rule bg-background w-32 rounded-sm border px-3 py-2 font-mono"
          />
          <button
            type="button"
            onClick={saveCeiling}
            disabled={savingCeiling}
            className="border-rule rounded-sm border px-4 py-2 font-semibold disabled:opacity-60"
          >
            {savingCeiling ? "Salvando..." : "Salvar"}
          </button>
        </div>
        {ceilingError !== null && (
          <p role="alert" className="text-accent text-sm">
            {ceilingError}
          </p>
        )}
      </section>

      <section
        aria-label="Subir páginas"
        className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-5"
      >
        <h2 className="font-bold tracking-tight">Subir páginas</h2>
        <p className="text-muted text-sm">
          Pode subir na ordem que quiser: os números da margem dão a ordem. Nada
          é gravado antes de você confirmar.
        </p>
        <input
          type="file"
          accept="image/*"
          multiple
          aria-label="Páginas do livro"
          onChange={(event) => {
            if (event.target.files !== null && event.target.files.length > 0) {
              void readFiles(event.target.files);
            }
          }}
          className="text-sm"
        />

        {phase.kind === "reading" && (
          <div className="flex flex-col gap-1">
            <p className="text-muted text-sm">
              Lendo {phase.done} de {phase.total}. Em WASM isso leva alguns
              segundos por página.
            </p>
            <div className="bg-rule h-2 w-full overflow-hidden rounded-sm">
              <div
                className="bg-accent h-full"
                style={{ width: `${(phase.done / phase.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {phase.kind === "failed" && (
          <p role="alert" className="text-accent text-sm">
            {phase.message}
          </p>
        )}
      </section>

      {phase.kind === "reviewing" && (
        <ReviewPanel
          bookId={bookId}
          bookTitle={bookTitle}
          pages={phase.pages}
          failures={phase.failures}
          onDone={() => setPhase({ kind: "idle" })}
        />
      )}
    </div>
  );
}
