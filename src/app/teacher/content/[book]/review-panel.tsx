"use client";

import { useEffect, useMemo, useState } from "react";

import type { BlockKind } from "@/lib/extraction/classify";
import {
  isRefused,
  pointForBlock,
  reviewOrder,
  type ResolvedPage,
} from "@/lib/extraction/pipeline";

import {
  asksForPoint,
  canConfirm,
  chosenPoint,
  type PageQuestion,
} from "@/lib/content/point-question";

import { GRAMMAR_TABLE_PLACEHOLDER } from "@/lib/extraction/grammar-table";
import { splitTerms } from "@/lib/extraction/terms";

import { confirmPoint, filledPoints } from "../actions";
import type { PageFailure } from "./book-workbench";
import { CropCanvas } from "./crop-canvas";
import { GrammarTablePreview } from "./grammar-table-preview";

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
  /** The point already holds content, read from the database on opening. */
  alreadyInDatabase: boolean;
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
    alreadyInDatabase: false,
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
  /*
   * Points this session has already emptied.
   *
   * A spread and the continuation after it write to the same point. If both
   * were shown as already filled, the second would clear the point a second
   * time and take the first one's work with it. Once a point has been replaced
   * here, later pages write beside what was just put there.
   */
  const [clearedPoints, setClearedPoints] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [drafts, setDrafts] = useState<Record<string, PageDraft>>(() =>
    Object.fromEntries(
      pages.map((page) => [page.extraction.id, initialDraft(page)]),
    ),
  );

  // What the database already holds. Asked once, after mount, so a reload shows
  // where the teacher stopped instead of offering to write it all again.
  useEffect(() => {
    let cancelled = false;
    const wanted = [
      ...new Set(
        pages.flatMap((page) =>
          page.points.length > 0
            ? page.points
            : page.inheritedPoint === null
              ? []
              : [page.inheritedPoint],
        ),
      ),
    ];
    void filledPoints(bookId, wanted).then((filled) => {
      if (cancelled || filled.length === 0) {
        return;
      }
      const done = new Set(filled);
      setDrafts((current) => {
        const next = { ...current };
        for (const page of pages) {
          const targets =
            page.points.length > 0
              ? page.points
              : page.inheritedPoint === null
                ? []
                : [page.inheritedPoint];
          if (targets.length > 0 && targets.every((n) => done.has(n))) {
            next[page.extraction.id] = {
              ...next[page.extraction.id],
              alreadyInDatabase: true,
            };
          }
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, pages]);

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

  /** The page's side of the question, which does not change while typing. */
  function questionOf(page: ResolvedPage): PageQuestion {
    return {
      points: page.points,
      inheritedPoint: page.inheritedPoint,
      disputeCandidates: [
        ...new Set(page.disputes.flatMap((dispute) => dispute.candidates)),
      ].sort((a, b) => a - b),
    };
  }

  function targetPoint(page: ResolvedPage, draft: PageDraft): number | null {
    return chosenPoint(questionOf(page), draft);
  }

  function update(id: string, change: Partial<PageDraft>) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...change },
    }));
  }

  function removeBlock(id: string, index: number) {
    setDrafts((current) => {
      const draft = current[id];
      return {
        ...current,
        [id]: {
          ...draft,
          blocks: draft.blocks.filter((_, i) => i !== index),
        },
      };
    });
  }

  /*
   * Adds an empty block right after the one being looked at, never at the end,
   * because the order of blocks is the order of the page.
   *
   * It exists for content the geometry threw away, which in practice means an
   * explanation: a shaded panel is found on 61 pages out of 61 and does not go
   * missing. Measured, the right-margin rule loses two real explanations across
   * the whole book, both a single declarative line that does not fill the
   * column.
   *
   * If this button starts being used routinely for the same kind of block, that
   * is a bug in the extraction and not a workflow. It is here to repair the
   * odd page, not to patch sixty by hand.
   */
  function addBlockAfter(id: string, index: number) {
    setDrafts((current) => {
      const draft = current[id];
      const blocks = [...draft.blocks];
      blocks.splice(index + 1, 0, {
        kind: "explanation",
        content: "",
        needsReview: false,
      });
      return { ...current, [id]: { ...draft, blocks } };
    });
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

  /**
   * The terms a set of vocabulary blocks introduces.
   *
   * Read straight off the block, which already holds them separated, because
   * the separation is geometric and was worked out where the positions still
   * existed. Splitting text on whitespace here is what turned "a day" into
   * "day" and "the fewest" into "the" and "fewest", and put "the" into the
   * vocabulary as a word of its own.
   *
   * No filter on length either: the book teaches "a" and "I", and a term earns
   * its place by occupying a column, not by being long enough.
   */
  function termsOf(blocks: readonly BlockDraft[]): string[] {
    return blocks
      .filter((block) => block.kind === "vocabulary")
      .flatMap((block) => splitTerms(block.content))
      .map((term) => term.toLowerCase());
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
      const wholePoint = draft.alreadyInDatabase && !clearedPoints.has(target);
      const result = await confirmPoint({
        bookId,
        bookPosition,
        pointNumber: target,
        lessonNumber: page.lessonNumber,
        sourcePage: page.extraction.id,
        replaceWholePoint: wholePoint,
        blocks: draft.blocks.map(asConfirmed),
        vocabulary: termsOf(draft.blocks),
      });
      if (result.status === "ok" && wholePoint) {
        setClearedPoints((current) => new Set([...current, target]));
      }
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
      const wholePoint =
        draft.alreadyInDatabase && !clearedPoints.has(pointNumber);
      const result = await confirmPoint({
        bookId,
        bookPosition,
        pointNumber,
        lessonNumber: page.lessonNumber,
        sourcePage: page.extraction.id,
        replaceWholePoint: wholePoint,
        blocks: blocks.map(asConfirmed),
        vocabulary: termsOf(blocks),
      });
      if (result.status === "error") {
        update(id, { error: result.message });
        return;
      }
      if (wholePoint) {
        setClearedPoints((current) => new Set([...current, pointNumber]));
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
        <button
          type="button"
          onClick={onDone}
          className="text-faint hover:text-foreground text-sm transition-colors"
        >
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
        const question = questionOf(page);
        const target = chosenPoint(question, draft);
        // Every candidate the batch could not choose between, as one question.
        // A page carries at most one number at a given height, so several
        // questions on one page read as several numbers to find.
        const candidates = question.disputeCandidates;
        // Derived from the page, never from the answer: the question has to
        // stay put while a number is being typed into it.
        const asking = asksForPoint(question) && !draft.saved;
        const ready = canConfirm(question, draft);
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
                    {draft.alreadyInDatabase && !draft.saved && (
                      <span
                        className="text-accent font-mono text-xs tracking-[0.16em] uppercase"
                        title="Confirmar aqui apaga tudo que este ponto já tem, inclusive o que outra página escreveu."
                      >
                        já gravado ·{" "}
                      </span>
                    )}
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
                disabled={draft.saved || !ready}
                title={
                  ready
                    ? undefined
                    : "Diga primeiro qual é o ponto desta página"
                }
                className="bg-accent text-accent-foreground rounded-sm px-4 py-2 font-semibold transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:opacity-50"
              >
                {draft.saved
                  ? "Gravado"
                  : draft.alreadyInDatabase
                    ? "Substituir o ponto inteiro"
                    : "Confirmar e gravar"}
              </button>
            </header>

            {asking && (
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
                          ? "bg-accent text-accent-foreground rounded-sm px-3 py-1 font-mono text-sm transition-colors"
                          : "border-rule hover:border-foreground hover:bg-background rounded-sm border px-3 py-1 font-mono text-sm transition-colors"
                      }
                    >
                      {candidate}
                    </button>
                  ))}
                  {/*
                    Only where it can do something: there is a candidate to
                    reject, or a page before this one to inherit from. With
                    neither, pressing it would leave the page with no point at
                    all, which is the one outcome nothing else on this screen
                    allows.
                  */}
                  {(candidates.length > 0 || page.inheritedPoint !== null) && (
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
                          ? "bg-foreground text-background rounded-sm px-3 py-1 text-sm transition-colors"
                          : "border-rule hover:border-foreground hover:bg-background rounded-sm border px-3 py-1 text-sm transition-colors"
                      }
                    >
                      Sem número, é continuação
                    </button>
                  )}
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
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => addBlockAfter(page.extraction.id, index)}
                        className="border-rule hover:border-foreground hover:bg-background rounded-sm border px-2 py-1 text-xs transition-colors"
                      >
                        + bloco abaixo
                      </button>
                      <button
                        type="button"
                        onClick={() => removeBlock(page.extraction.id, index)}
                        className="border-rule hover:border-accent hover:text-accent rounded-sm border px-2 py-1 text-xs transition-colors"
                      >
                        excluir
                      </button>
                    </div>
                    {block.kind === "grammar_table" && (
                      <p className="text-faint text-xs">
                        Uma linha por linha da tabela, colunas separadas por{" "}
                        <span className="font-mono">|</span>, e linha em branco
                        entre blocos. Uma linha sem{" "}
                        <span className="font-mono">|</span> é o título do bloco
                        seguinte. É isto que a aluna vê na aula.
                      </p>
                    )}
                    {block.kind === "vocabulary" && (
                      <p className="text-faint text-xs">
                        Um termo por vírgula. A vírgula é a fronteira entre
                        colunas do livro, então corrija-a se ela ficou no lugar
                        errado.
                      </p>
                    )}
                    <textarea
                      aria-label="Conteúdo do bloco"
                      value={block.content}
                      placeholder={
                        block.kind === "grammar_table"
                          ? GRAMMAR_TABLE_PLACEHOLDER
                          : undefined
                      }
                      rows={block.needsReview ? 8 : 3}
                      onChange={(event) =>
                        updateBlock(page.extraction.id, index, {
                          content: event.target.value,
                        })
                      }
                      className="border-rule bg-background w-full rounded-sm border p-2 font-mono text-sm"
                    />
                    {block.kind === "grammar_table" && (
                      <div className="border-rule bg-background rounded-sm border p-3">
                        <p className="text-faint mb-2 font-mono text-xs tracking-[0.16em] uppercase">
                          Como a aluna vai ver
                        </p>
                        <GrammarTablePreview content={block.content} />
                      </div>
                    )}
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
