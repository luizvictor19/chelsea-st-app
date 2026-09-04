"use client";

import { useMemo, useState } from "react";

import type { BlockKind } from "@/lib/extraction/classify";
import {
  isRefused,
  reviewOrder,
  type ResolvedPage,
} from "@/lib/extraction/pipeline";

import { confirmPoint } from "../actions";
import type { PageFailure } from "./book-workbench";
import { CropCanvas } from "./crop-canvas";

const KIND_LABELS: Record<BlockKind, string> = {
  vocabulary: "Vocabulário",
  grammar_table: "Tabela de gramática",
  explanation: "Explicação",
  dictation: "Ditado",
  revision_exercise: "Exercício de revisão",
  chart_ref: "Referência de chart",
};

type BlockDraft = {
  kind: BlockKind;
  content: string;
  needsReview: boolean;
};

type PageDraft = {
  /** Null means the teacher has not decided, or said it is a continuation. */
  pointNumber: number | null;
  continuation: boolean;
  blocks: BlockDraft[];
  saved: boolean;
  error: string | null;
};

function initialDraft(page: ResolvedPage): PageDraft {
  return {
    pointNumber: page.points[0] ?? null,
    continuation: page.points.length === 0 && page.disputes.length === 0,
    blocks: reviewOrder(page.extraction.blocks).map((block) => ({
      kind: block.kind,
      content: block.content,
      needsReview: block.needsReview,
    })),
    saved: false,
    error: null,
  };
}

export function ReviewPanel({
  bookId,
  bookTitle,
  pages,
  failures = [],
  onDone,
}: {
  bookId: string;
  bookTitle: string;
  pages: readonly ResolvedPage[];
  failures?: readonly PageFailure[];
  onDone: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, PageDraft>>(() =>
    Object.fromEntries(
      pages.map((page) => [page.extraction.id, initialDraft(page)]),
    ),
  );

  // The blocks in the order the screen shows them, kept beside the drafts so a
  // block's band is available for its crop.
  const orderedByPage = useMemo(
    () =>
      new Map(
        pages.map((page) => [
          page.extraction.id,
          reviewOrder(page.extraction.blocks),
        ]),
      ),
    [pages],
  );

  const unresolved = useMemo(
    () => pages.filter((page) => page.disputes.length > 0),
    [pages],
  );
  const unsupported = useMemo(
    () => pages.filter((page) => page.extraction.unsupported !== null),
    [pages],
  );
  const duplicates = useMemo(
    () => pages.filter((page) => page.duplicateOf !== null),
    [pages],
  );
  const refused = useMemo(
    () => pages.filter((page) => isRefused(page.extraction)),
    [pages],
  );
  const readable = useMemo(
    () =>
      pages.filter(
        (page) =>
          page.extraction.unsupported === null &&
          page.duplicateOf === null &&
          !isRefused(page.extraction),
      ),
    [pages],
  );

  function update(id: string, change: Partial<PageDraft>) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...change },
    }));
  }

  function updateBlock(id: string, index: number, change: Partial<BlockDraft>) {
    setDrafts((current) => {
      const draft = current[id];
      const blocks = draft.blocks.map((block, i) =>
        i === index ? { ...block, ...change } : block,
      );
      return { ...current, [id]: { ...draft, blocks } };
    });
  }

  async function save(page: ResolvedPage) {
    const id = page.extraction.id;
    const draft = drafts[id];
    if (draft.continuation) {
      // A continuation page adds nothing of its own; it belongs to the point
      // the page before it opened.
      update(id, { saved: true, error: null });
      return;
    }
    if (draft.pointNumber === null) {
      update(id, {
        error: "Escolha o número do ponto ou marque como continuação.",
      });
      return;
    }

    const result = await confirmPoint({
      bookId,
      pointNumber: draft.pointNumber,
      lessonNumber: page.lessonNumber,
      blocks: draft.blocks.map((block) => ({
        kind: block.kind,
        content: block.content,
        needsReview: block.needsReview,
      })),
      vocabulary: draft.blocks
        .filter((block) => block.kind === "vocabulary")
        .flatMap((block) => block.content.split(/\s+/))
        .map((word) => word.trim().toLowerCase())
        .filter((word) => word.length > 1),
    });

    update(
      id,
      result.status === "ok"
        ? { saved: true, error: null }
        : { error: result.message },
    );
  }

  return (
    <section aria-label="Revisão da extração" className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="text-2xl font-extrabold tracking-tight">
          Revisão, {bookTitle}
        </h2>
        <button type="button" onClick={onDone} className="text-faint text-sm">
          Descartar
        </button>
      </header>

      <p className="text-muted text-sm">
        {readable.length} páginas lidas
        {duplicates.length > 0 &&
          `, ${duplicates.length} reconhecida(s) como reenvio`}
        {unsupported.length > 0 && `, ${unsupported.length} não suportada(s)`}
        {refused.length > 0 && `, ${refused.length} recusada(s)`}
        {failures.length > 0 && `, ${failures.length} com erro`}
        {unresolved.length > 0 && `, ${unresolved.length} sem número resolvido`}
        . Nada foi gravado ainda.
      </p>

      {unsupported.length > 0 && (
        <div className="border-rule rounded-sm border border-dashed p-5">
          <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
            Não suportadas
          </p>
          <p className="text-muted mt-2 text-sm">
            Exercícios de revisão ainda não são suportados. Estas páginas não
            foram extraídas e nada delas será gravado:
          </p>
          <ul className="text-muted mt-2 font-mono text-xs">
            {unsupported.map((page) => (
              <li key={page.extraction.id}>{page.extraction.id}</li>
            ))}
          </ul>
        </div>
      )}

      {failures.length > 0 && (
        <div className="border-accent rounded-sm border p-5">
          <p className="text-accent font-mono text-xs tracking-[0.16em] uppercase">
            Não foi possível ler
          </p>
          <p className="text-muted mt-2 text-sm">
            Estas páginas deram erro e foram puladas. O resto do lote seguiu.
          </p>
          <ul className="text-muted mt-2 flex flex-col gap-1 text-sm">
            {failures.map((failure) => (
              <li key={failure.id}>
                <span className="font-mono text-xs">{failure.id}</span>
                <span className="text-faint"> — {failure.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {refused.length > 0 && (
        <div className="border-accent rounded-sm border p-5">
          <p className="text-accent font-mono text-xs tracking-[0.16em] uppercase">
            Recusadas
          </p>
          <p className="text-muted mt-2 text-sm">
            Sem número na margem, sem caixa sombreada, sem cabeçalho de lição e
            sem parágrafo de ditado: não são páginas deste livro. Nada delas
            será gravado.
          </p>
          <ul className="text-muted mt-2 font-mono text-xs">
            {refused.map((page) => (
              <li key={page.extraction.id}>{page.extraction.id}</li>
            ))}
          </ul>
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="border-rule rounded-sm border border-dashed p-5">
          <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
            Reenvios
          </p>
          <ul className="text-muted mt-2 text-sm">
            {duplicates.map((page) => (
              <li key={page.extraction.id} className="font-mono text-xs">
                {page.extraction.id} → mesma página que {page.duplicateOf}
              </li>
            ))}
          </ul>
        </div>
      )}

      {readable.map((page) => {
        const draft = drafts[page.extraction.id];
        if (draft === undefined) {
          return null;
        }
        return (
          <article
            key={page.extraction.id}
            className="border-rule bg-surface flex flex-col gap-4 rounded-sm border p-5"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-faint font-mono text-xs">
                  {page.extraction.id}
                </span>
                <span className="font-bold tracking-tight">
                  {draft.continuation
                    ? `Continuação do ponto ${page.inheritedPoint ?? "?"}`
                    : `Ponto ${draft.pointNumber ?? "?"}`}
                  {page.lessonNumber !== null && (
                    <span className="text-muted font-normal">
                      {" "}
                      · Lição {page.lessonNumber}
                    </span>
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void save(page)}
                disabled={draft.saved}
                className="bg-accent text-accent-foreground rounded-sm px-4 py-2 font-semibold disabled:opacity-50"
              >
                {draft.saved ? "Gravado" : "Confirmar e gravar"}
              </button>
            </header>

            {page.disputes.length > 0 && (
              <div className="border-accent flex flex-col gap-2 rounded-sm border p-4">
                <p className="text-accent font-mono text-xs tracking-[0.16em] uppercase">
                  Número do ponto não resolvido
                </p>
                <p className="text-muted text-sm">
                  A leitura da margem ficou ambígua. Escolha o número certo, ou
                  diga que a página é continuação.
                </p>
                {page.disputes.map((dispute) => (
                  <div key={dispute.y} className="flex flex-wrap gap-2">
                    {dispute.candidates.map((candidate) => (
                      <button
                        key={candidate}
                        type="button"
                        onClick={() =>
                          update(page.extraction.id, {
                            pointNumber: candidate,
                            continuation: false,
                          })
                        }
                        className={
                          draft.pointNumber === candidate && !draft.continuation
                            ? "bg-accent text-accent-foreground rounded-sm px-3 py-1 font-mono text-sm"
                            : "border-rule rounded-sm border px-3 py-1 font-mono text-sm"
                        }
                      >
                        {candidate}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        update(page.extraction.id, {
                          continuation: true,
                          pointNumber: null,
                        })
                      }
                      className={
                        draft.continuation
                          ? "bg-foreground text-background rounded-sm px-3 py-1 text-sm"
                          : "border-rule rounded-sm border px-3 py-1 text-sm"
                      }
                    >
                      Sem número, é continuação
                    </button>
                  </div>
                ))}
              </div>
            )}

            <ul className="flex flex-col gap-4">
              {draft.blocks.map((block, index) => (
                <li
                  key={index}
                  className={
                    block.needsReview
                      ? "border-accent flex flex-col gap-3 rounded-sm border p-4 md:flex-row"
                      : "border-rule flex flex-col gap-3 rounded-sm border p-4"
                  }
                >
                  {block.needsReview && (
                    <div className="md:w-1/2">
                      <p className="text-accent font-mono text-xs tracking-[0.16em] uppercase">
                        Recorte original
                      </p>
                      {(() => {
                        const band = orderedByPage.get(page.extraction.id)?.[
                          index
                        ]?.band;
                        return band === undefined ? null : (
                          <CropCanvas
                            page={page.extraction.page}
                            band={band}
                            label="Recorte da caixa original"
                          />
                        );
                      })()}
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-2">
                    <select
                      aria-label="Tipo do bloco"
                      value={block.kind}
                      onChange={(event) =>
                        updateBlock(page.extraction.id, index, {
                          kind: event.target.value as BlockKind,
                        })
                      }
                      className="border-rule bg-background self-start rounded-sm border px-2 py-1 text-sm"
                    >
                      {Object.entries(KIND_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <textarea
                      aria-label="Conteúdo do bloco"
                      value={block.content}
                      rows={block.needsReview ? 8 : 3}
                      onChange={(event) =>
                        updateBlock(page.extraction.id, index, {
                          content: event.target.value,
                        })
                      }
                      className="border-rule bg-background w-full rounded-sm border p-2 font-mono text-sm"
                    />
                  </div>
                </li>
              ))}
            </ul>

            {draft.blocks.length === 0 && (
              <p className="text-muted text-sm">Nada extraído desta página.</p>
            )}

            {draft.error !== null && (
              <p role="alert" className="text-accent text-sm">
                {draft.error}
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}
