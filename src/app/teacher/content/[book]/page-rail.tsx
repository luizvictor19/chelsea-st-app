"use client";

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
};

const MARK: Record<
  PageState,
  { readonly glyph: string; readonly tone: string }
> = {
  "needs-answer": { glyph: "!", tone: "text-accent border-accent" },
  waiting: { glyph: "○", tone: "text-muted border-rule" },
  saved: { glyph: "✓", tone: "text-faint border-rule" },
  duplicate: { glyph: "=", tone: "text-faint border-rule" },
  unsupported: { glyph: "—", tone: "text-faint border-rule" },
  refused: { glyph: "×", tone: "text-faint border-rule" },
};

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

  return (
    <nav
      aria-label="Páginas deste envio"
      className="border-rule flex w-full flex-shrink-0 flex-col border-b md:w-[268px] md:border-r md:border-b-0"
    >
      <div className="flex flex-col gap-2 px-5 pt-4 pb-3">
        <span className="text-faint font-mono text-[10px] tracking-[0.16em] uppercase">
          Este envio
        </span>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted text-sm">
            {pages.length}{" "}
            {pages.length === 1 ? "página lida" : "páginas lidas"}
          </span>
          <span className="text-faint font-mono text-[11px]">
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
          const mark = MARK[page.state];
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
                  className={`flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border font-mono text-[10px] ${mark.tone}`}
                >
                  {mark.glyph}
                </span>
                <span className="flex min-w-0 flex-col gap-[1px]">
                  <span
                    className={`truncate font-mono text-[11px] ${
                      focused ? "text-foreground" : "text-muted"
                    }`}
                  >
                    {page.id.replace(/\.[a-z]+$/i, "")}
                  </span>
                  <span
                    className={`truncate text-[11px] ${
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
        <button
          type="button"
          onClick={onDiscard}
          className="text-accent hover:text-foreground self-start text-sm font-semibold transition-colors"
        >
          Descartar envio
        </button>
      </div>
    </nav>
  );
}
