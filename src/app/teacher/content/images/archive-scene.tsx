"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { useRunningGeneration } from "./generation-tracking";
import { sceneArchived, tell, wordFailed } from "./notice-texts";
import { archiveScene } from "./scene-actions";

/**
 * Excluir a scene (#121), as a bin on its row or a button on its panel: the
 * same confirmation and the same action either way.
 *
 * A destructive control, so never unlabelled: the bin says what it does to a
 * screen reader and on hover, and nothing happens before the dialog's own
 * Excluir. Not while a generation of the scene runs, which would finish on a
 * scene nobody can open, nor for one a question shows, which the server
 * refuses anyway.
 */
export function ArchiveScene({
  scene,
  closeHref,
  variant,
  disabled = false,
}: {
  readonly scene: {
    readonly id: string;
    readonly description: string;
    readonly questionPoints: readonly number[];
  };
  /** Where to go once it is gone, when it is the scene open; else null. */
  readonly closeHref: string | null;
  readonly variant: "icon" | "button";
  /** The panel's own reason to wait, such as another action running. */
  readonly disabled?: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const running = useRunningGeneration(scene.id) !== null;
  const shown = scene.questionPoints.length > 0;
  const label = scene.description;
  const reason = shown
    ? "Uma pergunta mostra esta cena: troque a imagem dela antes de excluir."
    : running
      ? "Espere a geração terminar para excluir."
      : null;

  async function archive() {
    dialog.current?.close();
    setBusy(true);
    let result: Awaited<ReturnType<typeof archiveScene>>;
    try {
      result = await archiveScene(scene.id);
    } catch {
      result = {
        ok: false,
        error: "A resposta não chegou. Recarregue a página.",
      };
    }
    setBusy(false);
    if (result.ok) {
      tell(sceneArchived(label));
      if (closeHref !== null) router.replace(closeHref);
    } else {
      tell(wordFailed(label, result.error));
      if ("cause" in result && result.cause !== undefined) {
        console.error(result.cause);
      }
    }
  }

  const off = disabled || busy || reason !== null;

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          disabled={off}
          aria-label={`Excluir a cena ${label}`}
          title={reason ?? "Excluir a cena"}
          onClick={() => dialog.current?.showModal()}
          className="text-faint hover:text-accent shrink-0 rounded-sm p-1.5 transition-colors disabled:opacity-40"
        >
          {busy ? (
            <span className="block size-3.5 text-center text-[0.6875rem] leading-3.5">
              ·
            </span>
          ) : (
            <svg
              viewBox="0 0 16 16"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L12 4M6.5 7v4M9.5 7v4" />
            </svg>
          )}
        </button>
      ) : (
        <button
          type="button"
          disabled={off}
          title={reason ?? undefined}
          onClick={() => dialog.current?.showModal()}
          className="border-rule hover:bg-background shrink-0 rounded-sm border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
        >
          {busy ? "excluindo" : "Excluir"}
        </button>
      )}

      {/* Esc or Cancelar closes it; only Excluir acts. */}
      <dialog
        ref={dialog}
        aria-labelledby={`excluir-${variant}-${scene.id}`}
        className="border-rule bg-surface text-foreground m-auto max-w-sm rounded-sm border p-6 backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-4">
          <h2
            id={`excluir-${variant}-${scene.id}`}
            className="text-base font-extrabold tracking-tight wrap-anywhere"
          >
            Excluir a cena “{label}”?
          </h2>
          <p className="text-muted text-sm">
            Ela sai da lista e do Juntar imagens aprovadas. As tentativas e o
            gasto delas continuam registrados.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
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
              onClick={() => void archive()}
              className="border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold"
            >
              Excluir
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
