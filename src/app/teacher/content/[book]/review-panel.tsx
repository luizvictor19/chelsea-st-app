"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { StoredPage } from "@/lib/content/batch-store";
import {
  asksForPoint,
  canConfirm,
  chosenPoint,
  type PageQuestion,
} from "@/lib/content/point-question";
import {
  initialFocus,
  nextAfter,
  resolveFocus,
  type PageState,
} from "@/lib/content/review-navigation";
import type { BlockKind } from "@/lib/extraction/classify";
import { GRAMMAR_TABLE_PLACEHOLDER } from "@/lib/extraction/grammar-table";
import { pointForBlock } from "@/lib/extraction/pipeline";
import type { Placement } from "@/lib/extraction/reconcile";
import { joinTerms, splitTerms } from "@/lib/extraction/terms";

import { confirmPoint, filledPoints } from "../actions";
import type { PageFailure } from "./book-workbench";
import { CropCanvas } from "./crop-canvas";
import { GrammarTablePreview } from "./grammar-table-preview";
import { PageRail, type RailPage } from "./page-rail";
import {
  disputeCandidates,
  headingFor,
  summaryFor,
  targetsOf,
  toStored,
  type ReviewCrop,
  type ReviewSourcePage,
} from "./review-source";

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
  /*
   * The crop travels with the block rather than being looked up by position.
   * Adding or deleting a block moves every block after it, so an index into the
   * extraction stops meaning what it meant and the crop beside a table becomes
   * a crop of some other table.
   */
  crop: ReviewCrop | null;
  /** Where it sat on the page, which is what places it on a spread. */
  top: number;
};

type PageDraft = {
  /** The number this page carries, when it carries one. */
  pointNumber: number | null;
  /** The page adds to the point the page before it opened. */
  continuation: boolean;
  /** Typed by the teacher when neither of the two above is known. */
  typedPoint: string;
  blocks: BlockDraft[];
  /** What is on the screen is what is in the database. Any edit ends it. */
  saved: boolean;
  /** The points this page was actually written to, edited since or not. */
  savedPoints: readonly number[];
  /** The point already holds content, read from the database on opening. */
  alreadyInDatabase: boolean;
  error: string | null;
};

/**
 * The page was written once and has been edited since.
 *
 * Which is not "saved": the database is behind the screen, and the only way
 * that edit ever reaches it is by being confirmed again.
 */
function changedSinceSaving(draft: PageDraft): boolean {
  return !draft.saved && draft.savedPoints.length > 0;
}

function initialDraft(page: ReviewSourcePage): PageDraft {
  return {
    pointNumber: page.points[0] ?? null,
    continuation: page.points.length === 0 && page.disputes.length === 0,
    typedPoint: "",
    blocks: page.blocks.map((block) => ({
      kind: block.kind,
      content: block.content,
      needsReview: block.needsReview,
      crop: block.crop,
      top: block.top,
    })),
    // Written once and edited since is not saved: the edit still has to reach
    // the database, and a restore that called it saved buried it again.
    saved: page.savedPoints.length > 0 && !page.changedSinceSaving,
    savedPoints: page.savedPoints,
    alreadyInDatabase: false,
    error: null,
  };
}

/** The page's side of the question, which does not change while typing. */
function questionOf(page: ReviewSourcePage): PageQuestion {
  return {
    points: page.points,
    inheritedPoint: page.inheritedPoint,
    disputeCandidates: disputeCandidates(page),
  };
}

/**
 * The numbers this page writes to, with the height each one governs.
 *
 * A page can carry a settled number and an unsettled one at the same time:
 * reconciliation fills the placements it is sure of and leaves the rest as
 * disputes, and a spread whose top number was read cleanly and whose bottom one
 * was not is exactly that page. The teacher's answer names the number at the
 * disputed height, so it joins the settled ones there instead of replacing
 * them: the blocks above the disputed height stay with the number that was
 * settled, and the ones below go to the answer. Taking the settled placements
 * alone threw the answer away and wrote the whole spread to the top number;
 * taking the answer alone would have thrown the settled half away instead.
 *
 * With more than one dispute only the answered one can be placed — the screen
 * asks a single question — and the rest of the page falls to the nearest number
 * above it, which is the book's own rule.
 */
function placementsFor(
  page: ReviewSourcePage,
  draft: PageDraft,
): readonly Placement[] {
  const settled = page.placements;
  const answer = draft.pointNumber;
  if (answer === null || settled.some((place) => place.number === answer)) {
    return settled;
  }
  const dispute =
    page.disputes.find((one) => one.candidates.includes(answer)) ??
    page.disputes[0] ??
    null;
  if (settled.length === 0) {
    return [{ number: answer, y: dispute?.y ?? 0 }];
  }
  if (dispute === null) {
    return settled;
  }
  return [...settled, { number: answer, y: dispute.y }].sort(
    (a, b) => a.y - b.y,
  );
}

/**
 * What the rail shows against a page.
 *
 * Order matters: a page that is a second scan, a kind the pipeline refuses, or
 * not a page of this book at all is none of the teacher's business, whatever
 * its numbers say. Only then does it matter whether it is written, blocked or
 * waiting.
 */
function stateOf(page: ReviewSourcePage, draft: PageDraft): PageState {
  if (page.duplicateOf !== null) {
    return "duplicate";
  }
  if (page.unsupported !== null) {
    return "unsupported";
  }
  if (page.refused) {
    return "refused";
  }
  if (draft.saved) {
    return "saved";
  }
  return asksForPoint(questionOf(page)) ? "needs-answer" : "waiting";
}

function storedBlocks(draft: PageDraft) {
  return draft.blocks.map((block) => ({
    kind: block.kind,
    content: block.content,
    needsReview: block.needsReview,
    // Stored so a restored spread still knows which of its two numbers each
    // block belongs to.
    top: block.top,
  }));
}

/**
 * The terms a set of vocabulary blocks introduces.
 *
 * Read straight off the block, which already holds them separated, because the
 * separation is geometric and was worked out where the positions still existed.
 * Splitting text on whitespace here is what turned "a day" into "day" and "the
 * fewest" into "the" and "fewest".
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

export function ReviewPanel({
  bookId,
  bookPosition,
  bookTitle,
  firstPoint,
  lastPoint,
  pages,
  failures = [],
  onPersist,
  onDiscard,
}: {
  bookId: string;
  bookPosition: number;
  bookTitle: string;
  firstPoint: number | null;
  lastPoint: number | null;
  pages: readonly ReviewSourcePage[];
  failures?: readonly PageFailure[];
  /** Keeps the batch on this computer after every change worth keeping. */
  onPersist: (pages: readonly StoredPage[]) => void;
  onDiscard: () => void;
}) {
  /*
   * Points this session has already emptied.
   *
   * A spread and the continuation after it write to the same point. If both
   * were shown as already filled, the second would clear the point a second
   * time and take the first one's work with it. Once a point has been replaced
   * here, later pages write beside what was just put there.
   *
   * A ref, and written the moment the point is cleared rather than through
   * state: two confirmations can overlap, and a second one that read this from
   * a closure or from state that had not been committed yet computed "replace
   * the whole point" a second time and deleted what the first had just written
   * — the very loss this exists to prevent. Nothing renders from it.
   */
  const clearedPoints = useRef<ReadonlySet<number>>(new Set());
  function markCleared(pointNumber: number) {
    clearedPoints.current = new Set([...clearedPoints.current, pointNumber]);
  }

  /*
   * The page being written right now.
   *
   * The ref is the guard, because two clicks are two events and state read in
   * the second may still be the state of the first; the value beside it is only
   * so the button can show it is busy.
   */
  const saving = useRef<ReadonlySet<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  /** Why the screen cannot say what is already written, when it cannot. */
  const [filledError, setFilledError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PageDraft>>(() =>
    Object.fromEntries(pages.map((page) => [page.id, initialDraft(page)])),
  );
  /** Points of this book the database holds, for the bar at the top. */
  const [filledInBook, setFilledInBook] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [focusedId, setFocusedId] = useState<string | null>(() =>
    initialFocus(
      pages.map((page) => ({
        id: page.id,
        state: stateOf(page, initialDraft(page)),
      })),
    ),
  );

  const railPages = useMemo<readonly RailPage[]>(
    () =>
      pages.map((page) => {
        const draft = drafts[page.id] ?? initialDraft(page);
        const state = stateOf(page, draft);
        const target = chosenPoint(questionOf(page), draft);
        return {
          id: page.id,
          state,
          summary: summaryFor({
            page,
            state,
            target,
            continuation: draft.continuation,
            flagged: draft.blocks.filter((block) => block.needsReview).length,
            changedSinceSaving: changedSinceSaving(draft),
          }),
        };
      }),
    [pages, drafts],
  );

  /*
   * The rail as it stands right now, for the handlers.
   *
   * Confirming is asynchronous, and the array a handler closed over at click
   * time is the one from before the write. Reading the current one here is what
   * keeps "where to go next" from being answered with a stale batch.
   */
  const railRef = useRef(railPages);
  useEffect(() => {
    railRef.current = railPages;
  }, [railPages]);

  // The page in focus disappears only when the batch itself is replaced, and
  // then the panel is remounted; this is the belt to that pair of braces. A
  // focus of null means the batch is finished and must be left alone.
  useEffect(() => {
    setFocusedId((current) =>
      current === null || pages.some((page) => page.id === current)
        ? current
        : resolveFocus(railRef.current, current),
    );
  }, [pages]);

  const bookPoints = useMemo(() => {
    if (firstPoint === null || lastPoint === null) {
      return [];
    }
    return Array.from(
      { length: lastPoint - firstPoint + 1 },
      (_, index) => firstPoint + index,
    );
  }, [firstPoint, lastPoint]);

  // What the database already holds. Asked once, after mount, so a reload shows
  // where the teacher stopped instead of offering to write it all again.
  useEffect(() => {
    let cancelled = false;
    const batchPoints = [...new Set(pages.flatMap(targetsOf))];
    const wanted = bookPoints.length > 0 ? bookPoints : batchPoints;
    if (wanted.length === 0) {
      return;
    }
    const cannotCheck = (message: string) => {
      if (!cancelled) {
        // Silence here is the dangerous answer: a point that could not be read
        // looks empty, and confirming an empty point never warns.
        setFilledError(message);
      }
    };
    void filledPoints(bookId, wanted)
      .then((filled) => {
        if (cancelled) {
          return;
        }
        if (filled.status === "error") {
          cannotCheck(filled.message);
          return;
        }
        setFilledError(null);
        const done = new Set(filled.numbers);
        setFilledInBook(done);
        if (done.size === 0) {
          return;
        }
        setDrafts((current) => {
          const next = { ...current };
          for (const page of pages) {
            const targets = targetsOf(page);
            const draft = next[page.id];
            if (
              draft !== undefined &&
              !draft.saved &&
              targets.length > 0 &&
              targets.every((number) => done.has(number))
            ) {
              next[page.id] = { ...draft, alreadyInDatabase: true };
            }
          }
          return next;
        });
      })
      .catch((error: unknown) =>
        cannotCheck(
          error instanceof Error ? error.message : "erro desconhecido",
        ),
      );
    return () => {
      cancelled = true;
    };
  }, [bookId, pages, bookPoints]);

  /*
   * The batch on this computer, kept in step with the screen.
   *
   * Every change worth keeping runs through the drafts, so watching them covers
   * the batch arriving, a page being confirmed and a word being retyped alike.
   * The short wait is only so that a sentence being typed is one write and not
   * forty.
   */
  const persistRef = useRef(onPersist);
  useEffect(() => {
    persistRef.current = onPersist;
  }, [onPersist]);

  useEffect(() => {
    const timer = setTimeout(() => {
      persistRef.current(
        pages.map((page) => {
          const draft = drafts[page.id];
          return draft === undefined
            ? toStored(page, [], page.savedPoints, page.changedSinceSaving)
            : toStored(
                page,
                storedBlocks(draft),
                draft.savedPoints,
                changedSinceSaving(draft),
              );
        }),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [pages, drafts]);

  /** Bookkeeping: what the screen records about a page, not what it says. */
  function update(id: string, change: Partial<PageDraft>) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...change },
    }));
  }

  /*
   * A change the teacher made, which always leaves the page unsaved.
   *
   * Confirming was one-way: the button went to "Gravado" and stayed there while
   * the fields underneath went on editing. Everything typed after a confirmation
   * updated the screen and this computer and could never reach the database
   * again. An edit is only finished when it has been written, so it puts the
   * page back to where it can be written.
   */
  function edit(id: string, change: Partial<PageDraft>) {
    setDrafts((current) => {
      const draft = current[id];
      if (draft === undefined) {
        return current;
      }
      return { ...current, [id]: { ...draft, ...change, saved: false } };
    });
  }

  /** The same, for the blocks, which is where most of the typing happens. */
  function editBlocks(
    id: string,
    change: (blocks: readonly BlockDraft[]) => BlockDraft[],
  ) {
    setDrafts((current) => {
      const draft = current[id];
      if (draft === undefined) {
        return current;
      }
      return {
        ...current,
        [id]: { ...draft, blocks: change(draft.blocks), saved: false },
      };
    });
  }

  function updateBlock(id: string, index: number, change: Partial<BlockDraft>) {
    editBlocks(id, (blocks) =>
      blocks.map((block, i) => (i === index ? { ...block, ...change } : block)),
    );
  }

  function removeBlock(id: string, index: number) {
    editBlocks(id, (blocks) => blocks.filter((_, i) => i !== index));
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
   * is a bug in the extraction and not a workflow. It is here to repair the odd
   * page, not to patch sixty by hand.
   */
  function addBlockAfter(id: string, index: number) {
    editBlocks(id, (blocks) => {
      const next = [...blocks];
      next.splice(index + 1, 0, {
        kind: "explanation",
        content: "",
        needsReview: false,
        crop: null,
        // It belongs where it was inserted, so a spread puts it under the same
        // number as the block it follows. Nothing before it means the top of
        // the page, which is the first number.
        top: blocks[index]?.top ?? 0,
      });
      return next;
    });
  }

  /** Moves on from a page, unless the teacher has already gone elsewhere. */
  function leave(id: string) {
    setFocusedId((current) =>
      current === id ? nextAfter(railRef.current, id) : current,
    );
  }

  /** Points that are now on this page's account, whether it finished or not. */
  function recordWritten(written: readonly number[]) {
    if (written.length === 0) {
      return;
    }
    setFilledInBook((current) => new Set([...current, ...written]));
  }

  /**
   * The page is written.
   *
   * Against the draft that was written, not against whatever is on the screen
   * now: the fields stay editable while the write is in flight, and calling a
   * page saved when it has been typed into since would bury that edit exactly
   * as confirming used to.
   */
  function finish(
    id: string,
    written: readonly number[],
    writtenFrom: PageDraft,
  ) {
    setDrafts((current) => {
      const draft = current[id];
      if (draft === undefined) {
        return current;
      }
      return {
        ...current,
        [id]: {
          ...draft,
          saved: draft === writtenFrom,
          savedPoints: written,
          // What the point holds is now what this page put there, so the
          // warning about replacing somebody else's work has nothing left to
          // warn about.
          alreadyInDatabase: false,
          error: null,
        },
      };
    });
    recordWritten(written);
    leave(id);
  }

  /*
   * Writes one page, once.
   *
   * The guard is a ref and not state because two clicks are two events: the
   * second one read a "saving" flag the first had not committed yet, and the
   * same point was confirmed twice at the same time.
   */
  async function save(page: ReviewSourcePage) {
    const id = page.id;
    const draft = drafts[id];
    if (draft === undefined || saving.current.has(id)) {
      return;
    }
    saving.current = new Set([...saving.current, id]);
    setSavingId(id);
    try {
      await write(page, draft);
    } finally {
      const rest = new Set(saving.current);
      rest.delete(id);
      saving.current = rest;
      setSavingId((current) => (current === id ? null : current));
    }
  }

  async function write(page: ReviewSourcePage, draft: PageDraft) {
    const id = page.id;
    const asConfirmed = (block: BlockDraft) => ({
      kind: block.kind,
      content: block.content,
      needsReview: block.needsReview,
    });

    // A continuation adds to the point the page before it opened. Everything on
    // it belongs there, and it appends rather than replaces so it does not wipe
    // what that page already wrote.
    if (draft.continuation) {
      const target = chosenPoint(questionOf(page), draft);
      if (target === null) {
        update(id, {
          error:
            "Escolha o número do ponto, ou diga a qual ponto esta continuação pertence.",
        });
        return;
      }
      const wholePoint =
        draft.alreadyInDatabase && !clearedPoints.current.has(target);
      const result = await confirmPoint({
        bookId,
        bookPosition,
        pointNumber: target,
        lessonNumber: page.lessonNumber,
        // The file name, not this page's identity: source_page is deliberately
        // the name of the upload, and the identity is unique to this batch.
        sourcePage: page.fileName,
        replaceWholePoint: wholePoint,
        blocks: draft.blocks.map(asConfirmed),
        vocabulary: termsOf(draft.blocks),
      });
      if (result.status === "error") {
        update(id, { error: result.message });
        return;
      }
      if (wholePoint) {
        markCleared(target);
      }
      finish(id, [target], draft);
      return;
    }

    // A spread carries two numbers and its content is split between them: a
    // block belongs to the last number printed above it. An answered dispute is
    // one of those numbers, placed at the height it was asked about.
    const placements = placementsFor(page, draft);

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
    // Every block knows where it sat, including one added by hand and one from
    // a restored batch, so a spread splits the same way in both.
    for (const block of draft.blocks) {
      const target =
        pointForBlock(placements, block.top) ?? placements[0].number;
      byPoint.get(target)?.push(block);
    }

    const written: number[] = [];
    for (const [pointNumber, blocks] of byPoint) {
      const wholePoint =
        draft.alreadyInDatabase && !clearedPoints.current.has(pointNumber);
      const result = await confirmPoint({
        bookId,
        bookPosition,
        pointNumber,
        lessonNumber: page.lessonNumber,
        // The file name, not this page's identity. See the continuation branch.
        sourcePage: page.fileName,
        replaceWholePoint: wholePoint,
        blocks: blocks.map(asConfirmed),
        vocabulary: termsOf(blocks),
      });
      if (result.status === "error") {
        // What was written stays written, and is recorded as written: a page
        // that half wrote itself and then showed nothing left the rail waiting
        // on points that were already in the database, and the counter under
        // the title short by every one of them.
        update(id, {
          savedPoints: written,
          error:
            written.length === 0
              ? result.message
              : `${result.message} Os pontos ${written.join(", ")} já foram gravados.`,
        });
        recordWritten(written);
        return;
      }
      if (wholePoint) {
        markCleared(pointNumber);
      }
      written.push(pointNumber);
    }

    finish(id, written, draft);
  }

  const focused = pages.find((page) => page.id === focusedId) ?? null;
  const draft = focused === null ? undefined : drafts[focused.id];
  const skipTo = focusedId === null ? null : nextAfter(railPages, focusedId);

  return (
    <section
      aria-label="Revisão da extração"
      className="border-rule bg-background flex flex-col rounded-sm border"
    >
      <div className="border-rule flex flex-wrap items-center justify-between gap-4 border-b px-5 py-3.5">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-faint font-mono text-[11px]">
            {String(bookPosition).padStart(2, "0")}
          </span>
          <h2 className="text-[17px] font-bold tracking-tight">{bookTitle}</h2>
          {firstPoint !== null && lastPoint !== null && (
            <span className="text-faint font-mono text-[11px]">
              pontos {firstPoint} a {lastPoint}
            </span>
          )}
        </div>
        {/* Hidden while the count is unknown: a bar reading zero is a claim. */}
        {bookPoints.length > 0 && filledError === null && (
          <div className="flex items-center gap-3.5">
            <span className="text-faint font-mono text-[11px]">
              {filledInBook.size} de {bookPoints.length} ·{" "}
              {Math.round((filledInBook.size / bookPoints.length) * 100)}%
            </span>
            <div
              role="progressbar"
              aria-label="Pontos preenchidos"
              aria-valuenow={filledInBook.size}
              aria-valuemin={0}
              aria-valuemax={bookPoints.length}
              className="bg-rule h-1 w-[180px] overflow-hidden rounded-sm"
            >
              <div
                className="bg-accent h-full"
                style={{
                  width: `${(filledInBook.size / bookPoints.length) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {filledError !== null && (
        <div className="border-rule border-b px-5 py-3">
          <p className="text-accent font-mono text-[10px] tracking-[0.14em] uppercase">
            Não deu para conferir o que já está gravado
          </p>
          <p role="alert" className="text-muted mt-1.5 text-sm leading-relaxed">
            O banco não respondeu quais pontos deste livro já têm conteúdo (
            {filledError}). Uma página que aparece aqui como não gravada pode já
            ter conteúdo no banco, e confirmar acrescenta ao lado do que estiver
            lá. Recarregue a página, ou entre de novo, antes de gravar.
          </p>
        </div>
      )}

      {failures.length > 0 && (
        <div className="border-rule border-b px-5 py-3">
          <p className="text-accent font-mono text-[10px] tracking-[0.14em] uppercase">
            Não foi possível ler
          </p>
          <ul className="text-muted mt-1.5 flex flex-col gap-1 text-sm">
            {failures.map((failure) => (
              <li key={failure.id}>
                <span className="font-mono text-xs">{failure.id}</span>
                <span className="text-faint"> — {failure.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col items-stretch md:flex-row">
        <PageRail
          pages={railPages}
          focusedId={focusedId}
          onFocus={setFocusedId}
          onDiscard={onDiscard}
        />
        <div className="flex min-w-0 flex-grow flex-col">
          {focused === null || draft === undefined ? (
            <FinishedReview onDiscard={onDiscard} />
          ) : (
            <PageWork
              key={focused.id}
              page={focused}
              draft={draft}
              saving={savingId === focused.id}
              canSkip={skipTo !== null}
              onSkip={() => leave(focused.id)}
              onSave={() => void save(focused)}
              onUpdate={(change) => edit(focused.id, change)}
              onUpdateBlock={(index, change) =>
                updateBlock(focused.id, index, change)
              }
              onAddBlockAfter={(index) => addBlockAfter(focused.id, index)}
              onRemoveBlock={(index) => removeBlock(focused.id, index)}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function FinishedReview({ onDiscard }: { onDiscard: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 px-8 py-10">
      <span className="text-faint font-mono text-[10px] tracking-[0.14em] uppercase">
        Envio revisado
      </span>
      <p className="max-w-[34rem] text-sm leading-relaxed">
        Não há mais nada esperando revisão neste envio. Clique em qualquer
        página da lista para revê-la, ou descarte o envio.
      </p>
      <button
        type="button"
        onClick={onDiscard}
        className="bg-accent text-accent-foreground mt-1 rounded-sm px-4 py-2 text-sm font-bold transition-opacity hover:opacity-90"
      >
        Descartar envio
      </button>
    </div>
  );
}

const HEADER_ACTION =
  "text-faint hover:text-foreground font-mono text-[11px] transition-colors";

function PageWork({
  page,
  draft,
  saving,
  canSkip,
  onSkip,
  onSave,
  onUpdate,
  onUpdateBlock,
  onAddBlockAfter,
  onRemoveBlock,
}: {
  page: ReviewSourcePage;
  draft: PageDraft;
  /** A confirmation for this page is in flight. */
  saving: boolean;
  canSkip: boolean;
  onSkip: () => void;
  onSave: () => void;
  onUpdate: (change: Partial<PageDraft>) => void;
  onUpdateBlock: (index: number, change: Partial<BlockDraft>) => void;
  onAddBlockAfter: (index: number) => void;
  onRemoveBlock: (index: number) => void;
}) {
  const question = questionOf(page);
  const target = chosenPoint(question, draft);
  // Derived from the page, never from the answer: the question has to stay put
  // while a number is being typed into it.
  const asking = asksForPoint(question) && !draft.saved;
  const ready = canConfirm(question, draft);
  const writable =
    page.duplicateOf === null && page.unsupported === null && !page.refused;

  return (
    <article className="flex min-w-0 flex-col">
      <header className="flex flex-wrap items-start justify-between gap-5 px-6 pt-5 pb-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-faint font-mono text-[11px]">{page.id}</span>
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h3
              className={`text-[22px] font-extrabold tracking-tight ${
                target === null && writable ? "text-accent" : ""
              }`}
            >
              {headingFor(page, target, draft.continuation)}
            </h3>
            {page.lessonNumber !== null && (
              <span className="text-muted text-sm">
                Lição {page.lessonNumber}
              </span>
            )}
          </div>
        </div>
        {writable && (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onSkip}
              disabled={!canSkip}
              title={
                canSkip ? undefined : "Não há outra página esperando revisão"
              }
              className="border-rule text-muted hover:border-foreground hover:text-foreground disabled:hover:border-rule disabled:hover:text-muted rounded-sm border px-3.5 py-2 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              Pular
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={draft.saved || saving || !ready}
              aria-busy={saving}
              title={
                ready ? undefined : "Diga primeiro qual é o ponto desta página"
              }
              className="bg-accent text-accent-foreground rounded-sm px-4.5 py-2 text-[13px] font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:opacity-50"
            >
              {/*
                A page that was written and then edited says so and offers to
                write the change: the wording that promises to empty the point
                is kept for the point that already holds somebody else's work.
              */}
              {saving
                ? "Gravando..."
                : draft.saved
                  ? "Gravado"
                  : draft.alreadyInDatabase
                    ? "Substituir o ponto inteiro"
                    : changedSinceSaving(draft)
                      ? "Gravar a alteração"
                      : "Confirmar e gravar"}
            </button>
          </div>
        )}
      </header>

      <div className="flex flex-col gap-3 px-6 pb-7">
        {!writable && <NotWritable page={page} />}

        {draft.alreadyInDatabase && !draft.saved && (
          <p
            className="border-accent text-muted rounded-sm border px-4 py-3 text-sm leading-relaxed"
            role="note"
          >
            <span className="text-accent font-mono text-[10px] tracking-[0.14em] uppercase">
              Já gravado{" "}
            </span>
            Este ponto já tem conteúdo. Confirmar aqui apaga tudo o que ele tem,
            inclusive o que outra página escreveu.
          </p>
        )}

        {changedSinceSaving(draft) && (
          <p
            className="border-rule text-muted rounded-sm border border-dashed px-4 py-3 text-sm leading-relaxed"
            role="note"
          >
            Esta página já foi gravada e mudou depois disso. O que está na tela
            ainda não está no banco: grave a alteração para que ela chegue lá.
          </p>
        )}

        {/*
          The heights survive a restore; the image does not. So the split of a
          spread comes back intact and only the crop is missing, which is worth
          saying exactly where a crop would have been useful.
        */}
        {!page.hasImage &&
          !draft.saved &&
          draft.blocks.some((block) => block.needsReview) && (
            <p className="border-rule text-muted rounded-sm border border-dashed px-4 py-3 text-sm leading-relaxed">
              A leitura foi retomada sem as imagens. A altura de cada bloco
              ficou salva, então uma página de dois pontos continua dividida
              como estava; o que não volta é o recorte ao lado de um bloco
              marcado. Para conferir contra o livro, suba a página de novo.
            </p>
          )}

        {asking && (
          <PointQuestion page={page} draft={draft} onUpdate={onUpdate} />
        )}

        {writable && (
          <ul className="flex flex-col gap-3">
            {draft.blocks.map((block, index) => (
              <li key={index}>
                <BlockCard
                  block={block}
                  hasImage={page.hasImage}
                  onChange={(change) => onUpdateBlock(index, change)}
                  onAdd={() => onAddBlockAfter(index)}
                  onRemove={() => onRemoveBlock(index)}
                />
              </li>
            ))}
          </ul>
        )}

        {writable && draft.blocks.length === 0 && (
          <p className="text-muted text-sm">Nada extraído desta página.</p>
        )}

        {draft.error !== null && (
          <p role="alert" className="text-accent text-sm">
            {draft.error}
          </p>
        )}
      </div>
    </article>
  );
}

/** Why a page is only shown, never written. */
function NotWritable({ page }: { page: ReviewSourcePage }) {
  return (
    <p className="border-rule text-muted rounded-sm border border-dashed px-4 py-3.5 text-sm leading-relaxed">
      {page.duplicateOf !== null &&
        `Esta página é a mesma que ${page.duplicateOf}, fotografada duas vezes. Nada dela será gravado.`}
      {page.unsupported !== null &&
        "Exercícios de revisão ainda não são suportados. Esta página não foi extraída e nada dela será gravado."}
      {page.duplicateOf === null &&
        page.unsupported === null &&
        page.refused &&
        "Sem número na margem, sem caixa sombreada, sem cabeçalho de lição e sem parágrafo de ditado: não é uma página deste livro. Nada dela será gravado."}
    </p>
  );
}

function PointQuestion({
  page,
  draft,
  onUpdate,
}: {
  page: ReviewSourcePage;
  draft: PageDraft;
  onUpdate: (change: Partial<PageDraft>) => void;
}) {
  // A page carries at most one number at a given height, so several questions
  // on one page read as several numbers to find.
  const candidates = disputeCandidates(page);

  return (
    <div className="border-accent flex flex-col gap-3 rounded-sm border p-4">
      <p className="text-accent font-mono text-[10px] tracking-[0.14em] uppercase">
        Qual é o ponto desta página?
      </p>
      <p className="text-muted text-sm leading-relaxed">
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
              onUpdate({
                pointNumber: candidate,
                continuation: false,
                typedPoint: "",
              })
            }
            className={
              draft.pointNumber === candidate && !draft.continuation
                ? "bg-accent text-accent-foreground rounded-sm px-3 py-1 font-mono text-sm"
                : "border-rule hover:border-foreground hover:bg-surface rounded-sm border px-3 py-1 font-mono text-sm transition-colors"
            }
          >
            {candidate}
          </button>
        ))}
        {/*
          Only where it can do something: there is a candidate to reject, or a
          page before this one to inherit from. With neither, pressing it would
          leave the page with no point at all, which is the one outcome nothing
          else on this screen allows.
        */}
        {(candidates.length > 0 || page.inheritedPoint !== null) && (
          <button
            type="button"
            onClick={() => onUpdate({ continuation: true, pointNumber: null })}
            className={
              draft.continuation
                ? "bg-foreground text-background rounded-sm px-3 py-1 text-sm"
                : "border-rule hover:border-foreground hover:bg-surface rounded-sm border px-3 py-1 text-sm transition-colors"
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
            onChange={(event) => onUpdate({ typedPoint: event.target.value })}
            className="border-rule bg-surface w-24 rounded-sm border px-2 py-1 font-mono text-sm"
          />
        )}
      </div>
    </div>
  );
}

function BlockCard({
  block,
  hasImage,
  onChange,
  onAdd,
  onRemove,
}: {
  block: BlockDraft;
  hasImage: boolean;
  onChange: (change: Partial<BlockDraft>) => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const flagged = block.needsReview;

  return (
    <div
      className={`overflow-hidden rounded-sm border ${
        flagged ? "border-accent" : "border-rule bg-surface"
      }`}
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 ${
          flagged
            ? "border-accent/40 bg-accent/10 border-b"
            : "border-rule border-b"
        }`}
      >
        <span
          className={`font-mono text-[10px] tracking-[0.14em] uppercase ${
            flagged ? "text-accent" : "text-faint"
          }`}
        >
          {flagged && block.kind === "grammar_table"
            ? "Tabela · achatou, confira"
            : flagged
              ? `${KIND_LABELS[block.kind]} · confira`
              : KIND_LABELS[block.kind]}
        </span>
        <div className="flex items-center gap-2.5">
          <select
            aria-label="Tipo do bloco"
            value={block.kind}
            onChange={(event) =>
              onChange({ kind: event.target.value as BlockKind })
            }
            className="border-rule bg-background rounded-sm border px-1.5 py-1 font-mono text-[11px]"
          >
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span aria-hidden className="bg-rule h-3 w-px" />
          <button type="button" onClick={onAdd} className={HEADER_ACTION}>
            + bloco
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-faint hover:text-accent font-mono text-[11px] transition-colors"
          >
            excluir
          </button>
        </div>
      </div>

      {flagged ? (
        <div className="flex flex-col items-stretch lg:flex-row">
          <div className="border-rule flex flex-col gap-2 border-b p-3.5 lg:w-[330px] lg:flex-shrink-0 lg:border-r lg:border-b-0">
            <span className="text-faint font-mono text-[10px] tracking-[0.14em] uppercase">
              Recorte original
            </span>
            {block.crop === null ? (
              <p className="text-faint text-xs leading-relaxed">
                {hasImage
                  ? "Este bloco foi acrescentado à mão, então não tem recorte."
                  : "O recorte só existe na sessão que leu a página: as imagens não ficam salvas neste computador. Para vê-lo, suba a página de novo."}
              </p>
            ) : (
              <CropCanvas
                page={block.crop.page}
                band={block.crop.band}
                label="Recorte da caixa original"
              />
            )}
            {block.kind === "grammar_table" && (
              <span className="text-faint text-xs leading-relaxed">
                Uma linha por linha da tabela, colunas separadas por{" "}
                <span className="font-mono">|</span>, e linha em branco entre
                blocos. Uma linha sem <span className="font-mono">|</span> é o
                título do bloco seguinte.
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-grow flex-col">
            <BlockBody block={block} onChange={onChange} rows={8} />
          </div>
        </div>
      ) : (
        <BlockBody block={block} onChange={onChange} rows={3} />
      )}
    </div>
  );
}

function BlockBody({
  block,
  onChange,
  rows,
}: {
  block: BlockDraft;
  onChange: (change: Partial<BlockDraft>) => void;
  rows: number;
}) {
  if (block.kind === "vocabulary") {
    return (
      <div className="flex flex-col gap-2 p-3.5">
        <TermChips
          terms={splitTerms(block.content)}
          onChange={(terms) => onChange({ content: joinTerms(terms) })}
        />
        <span className="text-faint text-xs leading-relaxed">
          Cada termo é uma coluna do livro. Clique em um para corrigi-lo.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <textarea
        aria-label="Conteúdo do bloco"
        value={block.content}
        placeholder={
          block.kind === "grammar_table" ? GRAMMAR_TABLE_PLACEHOLDER : undefined
        }
        rows={rows}
        onChange={(event) => onChange({ content: event.target.value })}
        className="bg-background w-full resize-y p-3.5 font-mono text-xs leading-[1.85] outline-none"
      />
      {block.kind === "grammar_table" && (
        <div className="border-rule bg-surface flex flex-col gap-1.5 border-t px-3.5 py-2.5">
          <span className="text-faint font-mono text-[10px] tracking-[0.14em] uppercase">
            Como a aluna vê
          </span>
          <GrammarTablePreview content={block.content} />
        </div>
      )}
    </div>
  );
}

/**
 * The terms of a vocabulary panel, one chip each.
 *
 * They are stored as one comma-joined column, which is what the rest of the
 * product reads, but a comma in a text field is invisible and a term may
 * contain a space. As chips the boundary is the thing you can see and drag a
 * cursor into, and a wrong one is one click to fix.
 */
function TermChips({
  terms,
  onChange,
}: {
  terms: readonly string[];
  onChange: (terms: readonly string[]) => void;
}) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [text, setText] = useState("");

  function commit() {
    if (editing === null) {
      return;
    }
    // The comma is the boundary between terms in the stored column, so one
    // typed inside a term would quietly split it in two.
    const cleaned = text.replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (editing === "new") {
      if (cleaned !== "") {
        onChange([...terms, cleaned]);
      }
    } else if (cleaned === "") {
      onChange(terms.filter((_, index) => index !== editing));
    } else {
      onChange(
        terms.map((term, index) => (index === editing ? cleaned : term)),
      );
    }
    setEditing(null);
    setText("");
  }

  function field() {
    return (
      <input
        aria-label="Termo"
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            setEditing(null);
            setText("");
          }
        }}
        style={{ width: `${Math.max(text.length + 2, 6)}ch` }}
        className="border-accent bg-background rounded-sm border px-2 py-1 font-mono text-xs"
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {terms.map((term, index) =>
        editing === index ? (
          <span key={index}>{field()}</span>
        ) : (
          <span
            key={index}
            className="border-rule bg-background flex items-center gap-1.5 rounded-sm border py-1 pr-1.5 pl-2.5"
          >
            <button
              type="button"
              onClick={() => {
                setEditing(index);
                setText(term);
              }}
              title="Corrigir este termo"
              className="font-mono text-xs"
            >
              {term}
            </button>
            <button
              type="button"
              onClick={() =>
                onChange(terms.filter((_, other) => other !== index))
              }
              aria-label={`Remover ${term}`}
              className="text-faint hover:text-accent font-mono text-xs transition-colors"
            >
              ×
            </button>
          </span>
        ),
      )}
      {editing === "new" ? (
        field()
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditing("new");
            setText("");
          }}
          className="border-rule text-faint hover:border-foreground hover:text-foreground rounded-sm border border-dashed px-2.5 py-1 font-mono text-xs transition-colors"
        >
          + termo
        </button>
      )}
    </div>
  );
}
