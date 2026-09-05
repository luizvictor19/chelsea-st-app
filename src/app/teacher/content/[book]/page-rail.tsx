"use client";

import { useState } from "react";

import type { PageState, ReviewPage } from "@/lib/content/review-navigation";
import { batchProgress } from "@/lib/content/review-navigation";

/**
 * The whole upload down the left of the review.
 *
 * The review was one page tall enough to scroll through looking for where you
 * were. The rail is that memory made visible: what is written, what is blocked,
 * and where you are, with a click to any of them.
 */
export type RailPage = ReviewPage & {
  /** What the page turned out to be, in the teacher's words. */
  readonly summary: string;
  /**
   * The point this page writes to already holds content, from a round before
   * this one. Not a state of the review — the page is still waiting to be
   * confirmed — but the one fact that changes what confirming does, and it was
   * only ever said inside the page, after a click.
   */
  readonly alreadyInDatabase: boolean;
};

/**
 * The mark against a page: one ring, and the fill tells the story.
 *
 * Filled and ticked is written by this review. Filled and quiet is written
 * before it, by a round that is already in the database. Empty is untouched.
 * A ring drawn inside a ring told none of that apart and only made the mark
 * busy, so there is one ring now and it is large enough to read beside the
 * text it belongs to.
 */
function markFor(
  state: PageState,
  alreadyInDatabase: boolean,
): { readonly glyph: string; readonly tone: string } {
  switch (state) {
    case "saved":
      return {
        glyph: "✓",
        tone: "bg-foreground text-background border-foreground",
      };
    case "needs-answer":
      return { glyph: "!", tone: "text-accent border-accent" };
    case "duplicate":
      return { glyph: "=", tone: "text-faint border-rule" };
    case "unsupported":
      return { glyph: "—", tone: "text-faint border-rule" };
    case "refused":
      return { glyph: "×", tone: "text-faint border-rule" };
    default:
      return alreadyInDatabase
        ? { glyph: "", tone: "bg-rule border-rule" }
        : { glyph: "", tone: "border-rule" };
  }
}

export function PageRail({
  pages,
  focusedId,
  onFocus,
  onDiscard,
}: {
  pages: readonly RailPage[];
  focusedId: string | null;
  onFocus: (id: string) => void;
  onDiscard: () => void;
}) {
  const progress = batchProgress(pages);
  /*
   * Discarding asks first.
   *
   * It was one click, directly under the line promising the upload is kept on
   * this computer, and it emptied the screen and the browser's database at
   * once. Nothing undoes it: what has not been written is read again or not at
   * all.
   */
  const [confirming, setConfirming] = useState(false);
  const waiting = progress.total - progress.saved;

  return (
    <nav
      aria-label="Páginas deste envio"
      className="border-rule flex w-full flex-shrink-0 flex-col border-b md:w-[268px] md:border-r md:border-b-0"
    >
      <div className="flex flex-col gap-2 px-5 pt-4 pb-3">
        <span className="text-faint font-mono text-[0.625rem] tracking-[0.16em] uppercase">
          Este envio
        </span>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted text-sm">
            {pages.length}{" "}
            {pages.length === 1 ? "página lida" : "páginas lidas"}
          </span>
          <span className="text-faint font-mono text-[0.6875rem]">
            {progress.saved} gravadas
          </span>
        </div>
        <div className="bg-rule h-[3px] w-full overflow-hidden rounded-sm">
          <div
            className="bg-foreground h-full"
            style={{ width: `${progress.fraction * 100}%` }}
          />
        </div>
        {progress.needingAnswer > 0 && (
          <span className="text-accent text-xs">
            {progress.needingAnswer}{" "}
            {progress.needingAnswer === 1
              ? "página precisa do ponto"
              : "páginas precisam do ponto"}
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-[2px] px-3 pb-2">
        {pages.map((page) => {
          const focused = page.id === focusedId;
          const mark = markFor(page.state, page.alreadyInDatabase);
          return (
            <li key={page.id}>
              <button
                type="button"
                onClick={() => onFocus(page.id)}
                aria-current={focused ? "true" : undefined}
                className={`flex w-full items-center gap-[10px] rounded-sm px-2 py-[9px] text-left transition-colors ${
                  focused
                    ? "bg-surface shadow-[inset_2px_0_0_var(--accent)]"
                    : "hover:bg-surface"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-[1.375rem] w-[1.375rem] flex-shrink-0 items-center justify-center rounded-full border font-mono text-[0.6875rem] ${mark.tone}`}
                >
                  {mark.glyph}
                </span>
                <span className="flex min-w-0 flex-col gap-[1px]">
                  <span
                    className={`truncate font-mono text-[0.6875rem] ${
                      focused ? "text-foreground" : "text-muted"
                    }`}
                  >
                    {page.id.replace(/\.[a-z]+$/i, "")}
                  </span>
                  <span
                    className={`truncate text-[0.6875rem] ${
                      page.state === "needs-answer"
                        ? "text-accent"
                        : "text-faint"
                    }`}
                  >
                    {page.summary}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex-grow" />

      <div className="border-rule flex flex-col gap-2 border-t px-5 py-4">
        <span className="text-faint text-xs leading-relaxed">
          O envio fica salvo neste computador. Fechar a aba não perde a leitura.
        </span>
        {confirming ? (
          <div className="flex flex-col gap-2">
            <span className="text-muted text-xs leading-relaxed">
              Descartar apaga esta leitura deste computador
              {waiting > 0
                ? `, com ${waiting} ${waiting === 1 ? "página ainda por gravar" : "páginas ainda por gravar"}`
                : ""}
              . Não dá para desfazer: só subindo as páginas de novo.
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onDiscard}
                className="bg-accent text-accent-foreground rounded-sm px-3 py-1.5 text-xs font-bold transition-opacity hover:opacity-90"
              >
                Descartar mesmo assim
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="border-rule text-muted hover:border-foreground hover:text-foreground rounded-sm border px-3 py-1.5 text-xs transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-accent hover:text-foreground self-start text-sm font-semibold transition-colors"
          >
            Descartar envio
          </button>
        )}
      </div>
    </nav>
  );
}
