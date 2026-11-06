"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { createUnsavedRegistry, type UnsavedRegistry } from "./unsaved";

type LeaveGuard = {
  readonly registry: UnsavedRegistry;
  /** Opens the screen's confirmation for a move to `href`. */
  readonly confirmLeave: (href: string) => void;
};

const LeaveGuardContext = createContext<LeaveGuard | null>(null);

/**
 * The questions screen's guard against leaving with something unsaved
 * (#184): every form marks itself in one registry, and a LeaveLink asks
 * before a move that would drop any of them, in one dialog for the screen.
 *
 * The registry is created once and only read when a link is tapped, so a
 * keystroke that turns a form dirty marks it without rendering the screen.
 */
export function LeaveGuardProvider({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const [registry] = useState(createUnsavedRegistry);
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  // Where Sair e descartar goes: set as the dialog opens, read on the tap.
  const target = useRef<string | null>(null);
  const titleId = useId();

  const confirmLeave = useCallback((href: string) => {
    target.current = href;
    dialog.current?.showModal();
  }, []);
  const guard = useMemo(
    () => ({ registry, confirmLeave }),
    [registry, confirmLeave],
  );

  return (
    <LeaveGuardContext.Provider value={guard}>
      {children}
      {/*
        The native dialog, as Apagar's: Esc and the focus move come with
        showModal, and Esc is Ficar. Ficar takes the focus, so a stray Enter
        keeps the draft.
      */}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => {
          target.current = null;
        }}
        className="border-rule bg-surface text-foreground m-auto max-w-sm rounded-sm border p-6 backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-4">
          <h2 id={titleId} className="text-base font-extrabold tracking-tight">
            Sair sem salvar?
          </h2>
          <p className="text-muted text-sm">
            Há pergunta não salva nesta tela. Abrir a cena em Imagens descarta o
            que não foi salvo.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <form method="dialog">
              <button
                type="submit"
                autoFocus
                className="border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold"
              >
                Ficar
              </button>
            </form>
            <button
              type="button"
              onClick={() => {
                const href = target.current;
                dialog.current?.close();
                if (href !== null) router.push(href);
              }}
              className="border-rule hover:bg-background rounded-sm border px-3 py-1.5 text-sm transition-colors"
            >
              Sair e descartar
            </button>
          </div>
        </div>
      </dialog>
    </LeaveGuardContext.Provider>
  );
}

/**
 * Marks the form under `key` as holding something unsaved, for the screen's
 * links (LeaveLink), and asks before the tab is closed or reloaded meanwhile.
 *
 * Both in one effect, so a form that warns on closing the tab can never
 * leave by a link without asking. The cleanup marks it clean, which covers a
 * save that empties it, a discard, and the form closing while dirty.
 */
export function useUnsavedWarning(key: string, dirty: boolean) {
  const registry = useContext(LeaveGuardContext)?.registry;
  useEffect(() => {
    if (!dirty) return;
    registry?.mark(key, true);
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      registry?.mark(key, false);
      window.removeEventListener("beforeunload", warn);
    };
  }, [registry, key, dirty]);
}

/**
 * A link that leaves the questions screen in the same tab, asking first when
 * any form on the screen holds something unsaved.
 *
 * onNavigate runs only for a move inside the app: a Ctrl or Cmd click opens
 * another tab as usual, where nothing here is lost. Not prefetched: the
 * images screen reads the whole vocabulary, and a lesson may show many of
 * these links.
 */
export function LeaveLink({
  href,
  className,
  "aria-label": ariaLabel,
  children,
}: {
  readonly href: string;
  readonly className?: string;
  readonly "aria-label"?: string;
  readonly children: React.ReactNode;
}) {
  const guard = useContext(LeaveGuardContext);
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={ariaLabel}
      className={className}
      onNavigate={(event) => {
        if (guard === null || !guard.registry.any()) return;
        event.preventDefault();
        guard.confirmLeave(href);
      }}
    >
      {children}
    </Link>
  );
}
