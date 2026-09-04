"use client";

import { useMemo, useState } from "react";

import type { BlockKind } from "@/lib/extraction/classify";
import {
  isRefused,
  pointForBlock,
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
  /** The number this page carries, when it carries one. */
  pointNumber: number | null;
  /** The page adds to the point the page before it opened. */
  continuation: boolean;
  /** Typed by the teacher when neither of the two above is known. */
  typedPoint: string;
  blocks: BlockDraft[];
  saved: boolean;
  error: string | null;
};

function initialDraft(page: ResolvedPage): PageDraft {
  return {
    pointNumber: page.points[0] ?? null,
    continuation: page.points.length === 0 && page.disputes.length === 0,
    typedPoint: "",
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
  bookPosition,
  bookTitle,
  pages,
  failures = [],
  onDone,
}: {
  bookId: string;
  bookPosition: number;
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

  /**
   * The point this page's blocks will be written to.
   *
   * A page that carries a number uses it. A continuation uses the point the
   * page before it opened, or the one the teacher typed when the upload gave no
   * predecessor to inherit from.
   */
  function targetPoint(page: ResolvedPage, draft: PageDraft): number | null {
    if (draft.continuation) {
      const typed = Number(draft.typedPoint);
      if (Number.isInteger(typed) && typed > 0) {
        return typed;
      }
      return page.inheritedPoint;
    }
    return draft.pointNumber;
  }

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

  /** Words a vocabulary block introduces, folded the way the column is. */
  function wordsOf(blocks: readonly BlockDraft[]): string[] {
    return blocks
      .filter((block) => block.kind === "vocabulary")
      .flatMap((block) => block.content.split(/\s+/))
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length > 1);
  }

  async function save(page: ResolvedPage) {
    const id = page.extraction.id;
    const draft = drafts[id];
    const ordered = orderedByPage.get(id) ?? [];

    const asConfirmed = (block: BlockDraft) => ({
      kind: block.kind,
      content: block.content,
      needsReview: block.needsReview,
    });

    // A continuation adds to the point the page before it opened. Everything on
    // it belongs there, and it appends rather than replaces so it does not wipe
    // what that page already wrote.
    if (draft.continuation) {
      const target = targetPoint(page, draft);
      if (target === null) {
        update(id, {
          error:
            "Escolha o número do ponto, ou diga a qual ponto esta continuação pertence.",
        });
        return;
      }
      const result = await confirmPoint({
        bookId,
        bookPosition,
        pointNumber: target,
        lessonNumber: page.lessonNumber,
        mode: "append",
        blocks: draft.blocks.map(asConfirmed),
        vocabulary: wordsOf(draft.blocks),
      });
      update(
        id,
        result.status === "ok"
          ? { saved: true, error: null }
          : { error: result.message },
      );
      return;
    }

    // A spread carries two numbers and its content is split between them: a
    // block belongs to the last number printed above it.
    const placements =
      page.placements.length > 0
        ? page.placements
        : draft.pointNumber === null
          ? []
          : [{ number: draft.pointNumber, y: 0 }];

    if (placements.length === 0) {
      update(id, {
        error:
          "Escolha o número do ponto, ou marque a página como continuação.",
      });
      return;
    }

    const byPoint = new Map<number, BlockDraft[]>();
    // Every number the page carries is written, even when nothing landed under
    // it, so the point still counts as covered.
    for (const placement of placements) {
      byPoint.set(placement.number, []);
    }
    draft.blocks.forEach((block, index) => {
      const top = ordered[index]?.band.top ?? 0;
      const target = pointForBlock(placements, top) ?? placements[0].number;
      byPoint.get(target)?.push(block);
    });

    for (const [pointNumber, blocks] of byPoint) {
      const result = await confirmPoint({
        bookId,
        bookPosition,
        pointNumber,
        lessonNumber: page.lessonNumber,
        mode: "replace",
        blocks: blocks.map(asConfirmed),
        vocabulary: wordsOf(blocks),
      });
      if (result.status === "error") {
        update(id, { error: result.message });
        return;
      }
    }

    update(id, { saved: true, error: null });
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
        const target = targetPoint(page, draft);
        // Every candidate the batch could not choose between, as one question.
        // A page carries at most one number at a given height, so several
        // questions on one page read as several numbers to find.
        const candidates = [
          ...new Set(page.disputes.flatMap((dispute) => dispute.candidates)),
        ].sort((a, b) => a - b);
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
                {target === null ? (
                  // Unresolved is one state, not a number missing from beside a
                  // lesson that is known. Showing the lesson here reads as a
                  // defect rather than as a question.
                  <span className="text-accent font-bold tracking-tight">
                    Número do ponto não resolvido
                  </span>
                ) : (
                  <span className="font-bold tracking-tight">
                    {draft.continuation
                      ? `Continuação do ponto ${target}`
                      : page.points.length > 1
                        ? `Pontos ${page.points.join(" e ")}`
                        : `Ponto ${target}`}
                    {page.lessonNumber !== null && (
                      <span className="text-muted font-normal">
                        {" "}
                        · Lição {page.lessonNumber}
                      </span>
                    )}
                  </span>
                )}
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

            {(candidates.length > 0 || target === null) && (
              <div className="border-accent flex flex-col gap-3 rounded-sm border p-4">
                <p className="text-accent font-mono text-xs tracking-[0.16em] uppercase">
                  Qual é o ponto desta página?
                </p>
                <p className="text-muted text-sm">
                  {candidates.length > 0
                    ? "A leitura da margem ficou ambígua. Escolha o número certo, ou diga que a página é continuação da anterior."
                    : "A página não carrega número e não há página anterior neste envio para herdar. Diga a qual ponto ela pertence."}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {candidates.map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      onClick={() =>
                        update(page.extraction.id, {
                          pointNumber: candidate,
                          continuation: false,
                          typedPoint: "",
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
                  {draft.continuation && page.inheritedPoint === null && (
                    <input
                      aria-label="Ponto a que esta continuação pertence"
                      inputMode="numeric"
                      placeholder="ponto"
                      value={draft.typedPoint}
                      onChange={(event) =>
                        update(page.extraction.id, {
                          typedPoint: event.target.value,
                        })
                      }
                      className="border-rule bg-background w-24 rounded-sm border px-2 py-1 font-mono text-sm"
                    />
                  )}
                </div>
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
