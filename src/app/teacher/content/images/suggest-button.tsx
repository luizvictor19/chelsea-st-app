"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { suggestRepresentations } from "./actions";

/**
 * Asks the model to sort the whole lesson, decided words included. What comes
 * back is a suggestion on each word, never a decision, so this button changes
 * what the list proposes and never what it records.
 *
 * Re-running it is expected, not an accident: the suggestions on a decided
 * lesson are how a change to the prompt gets marked against answers that
 * already exist. It does overwrite, though, so a lesson that already has
 * suggestions asks first. A lesson with none goes straight through, because a
 * confirmation that never has anything to warn about is one people learn to
 * click past.
 *
 * The dialog is the native element: showModal gives Esc and the focus move
 * for free, and this repository has no dialog of its own to reuse.
 */
export function SuggestButton({
  lessonContentId,
  words,
  existingSuggestions,
  existingClasses,
}: {
  readonly lessonContentId: string;
  readonly words: number;
  readonly existingSuggestions: number;
  readonly existingClasses: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  async function run() {
    setBusy(true);
    setNote(null);
    const result = await suggestRepresentations(lessonContentId);
    setBusy(false);
    if (result.ok) {
      setNote(
        result.rejected === 0
          ? `${result.suggested} sugeridas`
          : `${result.suggested} sugeridas, ${result.rejected} recusadas`,
      );
      router.refresh();
    } else {
      setNote(result.error);
    }
  }

  function start() {
    if (existingSuggestions === 0 && existingClasses === 0) {
      void run();
      return;
    }
    dialog.current?.showModal();
  }

  return (
    // A div and not a span: <dialog> is flow content and has no business
    // inside phrasing content, however small the wrapper looks.
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={busy || words === 0}
        onClick={start}
        title={
          words === 0
            ? "Esta lição não tem palavras"
            : "Sugere de novo a lição inteira, inclusive as já decididas"
        }
        className="border-rule hover:bg-surface rounded-sm border px-2.5 py-1 text-xs font-semibold normal-case transition-colors disabled:opacity-40"
      >
        {busy ? "sugerindo" : "Sugerir tipos"}
      </button>
      {/* The lesson header carries the counts; this button is the control. */}
      {note !== null && (
        <span className="text-faint text-xs normal-case">{note}</span>
      )}

      <dialog
        ref={dialog}
        aria-labelledby={`substituir-${lessonContentId}`}
        className="border-rule bg-surface text-foreground m-auto max-w-sm rounded-sm border p-6 normal-case backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-4">
          <h2
            id={`substituir-${lessonContentId}`}
            className="text-base font-extrabold tracking-tight"
          >
            Substituir as sugestões desta lição?
          </h2>
          <p className="text-muted text-sm">
            Nesta lição, {existingSuggestions} já têm sugestão de tipo e{" "}
            {existingClasses} já têm classe. Sugerir de novo substitui as duas
            coisas. As decisões que você já tomou não são tocadas.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {/*
              Cancel closes and calls nothing: no action, no request, nothing
              spent. The form method keeps Esc and this button on the same
              path out.
            */}
            <form method="dialog">
              <button
                type="submit"
                className="border-rule hover:bg-background rounded-sm border px-3 py-1.5 text-sm transition-colors"
              >
                Cancelar
              </button>
            </form>
            <button
              type="button"
              onClick={() => {
                dialog.current?.close();
                void run();
              }}
              className="border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold"
            >
              Substituir
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
