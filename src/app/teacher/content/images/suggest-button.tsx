"use client";

import { useRef, useState } from "react";

import { suggestRepresentations } from "./actions";
import { settle } from "./panel-state";
import { suggestNote } from "./suggest-note";

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
  suggested,
}: {
  readonly lessonContentId: string;
  readonly words: number;
  readonly suggested: number;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  /*
   * The lesson, ten words at a time, one request after the last.
   *
   * It used to be one call for the whole lesson. Sixty words took 43 seconds,
   * came back 200, and reached a browser that had already given up — and on
   * Vercel it would not have come back at all, because a function has a
   * duration limit that a call that long does not fit inside. Neither of
   * those is ergonomics.
   *
   * Sequential and not parallel: six calls at once would be six writes racing
   * over the same lesson, and the progress count would jump about rather than
   * climb. Each batch is idempotent in the columns it writes, which is what
   * makes the retry below safe.
   */
  async function run() {
    setBusy(true);
    setNote(null);

    let covered = 0;
    let suggested = 0;
    let rejected = 0;
    let total = 0;

    for (;;) {
      const at = covered;
      let result = await settle(() =>
        suggestRepresentations(lessonContentId, at),
      );

      /*
       * A call that did not come back is not an answer about the batch: the
       * ten words may well have been written. Asked once more rather than
       * abandoned, because repeating them costs one request and changes
       * nothing else. Once, not until it works: a network that is down would
       * otherwise spin here forever.
       */
      if (!result.ok && "cause" in result) {
        console.error(result.cause);
        result = await settle(() =>
          suggestRepresentations(lessonContentId, at),
        );
      }

      if (!result.ok) {
        if ("cause" in result) console.error(result.cause);
        setBusy(false);
        setNote(
          suggestNote({
            kind: "stalled",
            suggested,
            rejected,
            covered,
            total,
            error: result.error,
          }),
        );
        return;
      }

      suggested += result.suggested;
      rejected += result.rejected;
      total = result.total;
      covered += result.words;
      setNote(suggestNote({ kind: "running", covered, total }));

      // done is the end of the lesson; the zero is insurance, so that a batch
      // which somehow covers nothing cannot turn this into a loop that keeps
      // asking for ever.
      if (result.done || result.words === 0) break;
    }

    setBusy(false);
    setNote(suggestNote({ kind: "done", suggested, rejected }));
  }

  function start() {
    if (suggested === 0) {
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
            {suggested === 1
              ? "1 palavra desta lição já tem sugestão."
              : `${suggested} palavras desta lição já têm sugestão.`}{" "}
            Sugerir de novo substitui o tipo e a classe. As decisões que você já
            tomou não são tocadas.
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
