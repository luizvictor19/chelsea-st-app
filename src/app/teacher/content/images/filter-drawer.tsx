"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import {
  FILTER_GROUPS,
  activeChips,
  activeCount,
  filterHref,
  toggled,
  type Selection,
} from "./filters";

/** Long enough that typing a word is one navigation, short enough to feel live. */
const DEBOUNCE_MS = 250;

export function FilterDrawer({
  selection,
  term,
  selectedId,
  shown,
  total,
}: {
  readonly selection: Selection;
  readonly term: string;
  readonly selectedId: string | null;
  readonly shown: number;
  readonly total: number;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();

  const [draft, setDraft] = useState(term);
  const [lastTerm, setLastTerm] = useState(term);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The last value this component put in the URL, so its own navigation
  // landing back as a prop is not mistaken for someone else changing it.
  // State and not a ref, because it is read while rendering.
  const [sentTerm, setSentTerm] = useState(term);

  /*
   * Adjusting state while rendering, which is the documented way to follow a
   * prop, and not an effect. The guard is what makes it safe: our own search
   * lands here a moment later and must not overwrite whatever has been typed
   * since, while a back button, which never passed through `sent`, must.
   */
  if (term !== lastTerm) {
    setLastTerm(term);
    if (term !== sentTerm) setDraft(term);
  }

  function navigate(url: string) {
    startTransition(() => router.replace(url, { scroll: false }));
  }

  function search(next: string) {
    setDraft(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSentTerm(next.trim());
      navigate(filterHref(selection, selectedId, next));
    }, DEBOUNCE_MS);
  }

  function clearAll() {
    if (timer.current !== null) clearTimeout(timer.current);
    setDraft("");
    setSentTerm("");
    navigate("/teacher/content/images");
  }

  const chips = activeChips(selection);
  const count = activeCount(selection, draft);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="border-rule hover:bg-surface flex items-center gap-2 rounded-sm border px-3 py-1.5 text-sm font-semibold transition-colors"
      >
        Filtros
        {count > 0 && (
          <span className="bg-accent text-accent-foreground rounded-full px-1.5 text-xs font-bold">
            {count}
          </span>
        )}
      </button>

      {/*
        The filters that are on stay visible with the drawer shut. A filter
        you cannot see is a filter you forget, and then half an hour goes into
        hunting for a word the list is quietly hiding. With none on, nothing
        renders and the row costs no height.
      */}
      {chips.map((chip) => (
        <Link
          key={`${chip.key}-${chip.value}`}
          href={filterHref(
            toggled(selection, chip.key, chip.value),
            selectedId,
            draft,
          )}
          title={`Remover o filtro ${chip.label}`}
          className="border-rule text-muted hover:text-foreground flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors"
        >
          {chip.label}
          <span aria-hidden="true">×</span>
        </Link>
      ))}
      {draft.trim() !== "" && (
        <button
          type="button"
          onClick={() => search("")}
          title="Remover a busca"
          className="border-rule text-muted hover:text-foreground flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors"
        >
          {draft.trim()}
          <span aria-hidden="true">×</span>
        </button>
      )}
      {pending && <span className="text-faint text-xs">filtrando</span>}

      {/*
        A drawer down the left edge. The native dialog again, the third on
        this screen: Esc and the focus move come with showModal, and a click
        that lands on the dialog element itself never reached the contents, so
        it is a click outside.
      */}
      <dialog
        ref={dialog}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
        className="bg-surface border-rule m-0 mr-auto h-dvh max-h-none w-[22rem] max-w-[90vw] border-r p-0 backdrop:bg-black/40"
      >
        <div className="flex h-full flex-col">
          <div className="border-rule flex items-center justify-between gap-3 border-b px-4 py-3">
            <h2 className="text-sm font-extrabold tracking-tight">Filtros</h2>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              aria-label="Fechar"
              className="text-faint hover:text-foreground rounded-sm px-2 py-1 text-sm transition-colors"
            >
              ×
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
            <input
              type="search"
              value={draft}
              onChange={(event) => search(event.target.value)}
              placeholder="Buscar termo"
              aria-label="Buscar termo"
              className="border-rule bg-background w-full rounded-sm border px-3 py-1.5 text-sm"
            />

            {/*
              With the vertical space of a drawer, all three axes are plain
              lists of pills. Classe no longer has to fold away.
            */}
            {FILTER_GROUPS.map((group) => (
              <div key={group.key} className="flex flex-col gap-2">
                <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
                  {group.label}
                </span>
                <div className="flex flex-wrap gap-2">
                  {group.options.map((option) => {
                    const on = selection[group.key].includes(option.value);
                    return (
                      <Link
                        key={option.value}
                        href={filterHref(
                          toggled(selection, group.key, option.value),
                          selectedId,
                          draft,
                        )}
                        scroll={false}
                        aria-pressed={on}
                        className={
                          on
                            ? "border-accent bg-accent text-accent-foreground rounded-sm border px-2.5 py-1 text-xs font-semibold"
                            : "border-rule hover:bg-background rounded-sm border px-2.5 py-1 text-xs transition-colors"
                        }
                      >
                        {option.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="border-rule flex items-center justify-between gap-3 border-t px-4 py-3">
            <span className="text-muted text-xs">
              {shown} de {total}
            </span>
            {count > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-faint hover:text-foreground text-xs underline underline-offset-2 transition-colors"
              >
                Limpar
              </button>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}
