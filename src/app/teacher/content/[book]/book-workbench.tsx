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
  bookPosition,
  bookTitle,
  firstPoint,
  lastPoint,
}: {
  bookId: string;
  bookPosition: number;
  bookTitle: string;
  firstPoint: number | null;
  lastPoint: number | null;
}) {
  const [floor, setFloor] = useState(
    firstPoint === null ? "" : String(firstPoint),
  );
  const [ceiling, setCeiling] = useState(
    lastPoint === null ? "" : String(lastPoint),
  );
  const [savingCeiling, setSavingCeiling] = useState(false);
  const [ceilingError, setCeilingError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  async function saveRange() {
    const from = Number(floor);
    const to = Number(ceiling);
    if (
      !Number.isInteger(from) ||
      from < 1 ||
      !Number.isInteger(to) ||
      to < 1
    ) {
      setCeilingError("Os dois números são inteiros maiores que zero.");
      return;
    }
    if (to < from) {
      setCeilingError("O último ponto não pode ser menor que o primeiro.");
      return;
    }
    setSavingCeiling(true);
    setCeilingError(null);
    const result = await configureBook(bookId, bookPosition, from, to);
    setSavingCeiling(false);
    if (result.status === "error") {
      setCeilingError(result.message);
    }
  }

  async function readFiles(files: FileList) {
    if (firstPoint === null || lastPoint === null) {
      setPhase({
        kind: "failed",
        message:
          "Defina o primeiro e o último ponto do livro antes de subir páginas.",
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
        pages: resolveBatch(extractions, {
          first: firstPoint,
          last: lastPoint,
        }),
        failures,
      });
    } finally {
      await reader.close();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label="Faixa de pontos do livro"
        className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-5"
      >
        <h2 className="font-bold tracking-tight">
          Primeiro e último ponto do livro
        </h2>
        <p className="text-muted text-sm">
          Os dois vêm do próprio livro, lidos na primeira e na última página.
          Não do lote que você está subindo, e não do livro anterior: o livro 5
          começa onde o livro 5 começa, mesmo que o 4 ainda não tenha subido.
        </p>
        <p className="text-muted text-sm">
          Juntos eles são o piso e o teto que validam a leitura da margem. Uma
          leitura fora deles é ruído.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-faint font-mono text-xs">primeiro</span>
            <input
              aria-label="Primeiro ponto"
              inputMode="numeric"
              value={floor}
              onChange={(event) => setFloor(event.target.value)}
              className="border-rule bg-background w-28 rounded-sm border px-3 py-2 font-mono"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-faint font-mono text-xs">último</span>
            <input
              aria-label="Último ponto"
              inputMode="numeric"
              value={ceiling}
              onChange={(event) => setCeiling(event.target.value)}
              className="border-rule bg-background w-28 rounded-sm border px-3 py-2 font-mono"
            />
          </label>
          <button
            type="button"
            onClick={saveRange}
            disabled={savingCeiling}
            className="border-rule hover:border-foreground hover:bg-background disabled:hover:border-rule rounded-sm border px-4 py-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
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
          bookPosition={bookPosition}
          bookTitle={bookTitle}
          pages={phase.pages}
          failures={phase.failures}
          onDone={() => setPhase({ kind: "idle" })}
        />
      )}
    </div>
  );
}
