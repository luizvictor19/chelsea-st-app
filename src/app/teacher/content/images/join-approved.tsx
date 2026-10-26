"use client";

import { useEffect, useRef, useState } from "react";

import { MONTAGE_MAX, MONTAGE_MIN } from "@/lib/images/montage";

import { MontageFailed, drawMontage } from "./draw-montage";

/** An approved picture of a word or of another scene, as the page has it. */
export type ApprovedPicture = {
  /** "word:{id}" or "scene:{id}", unique across both. */
  readonly key: string;
  readonly label: string;
  readonly url: string;
};

/** More than a screenful of thumbnails is a search that has not started. */
const SHOWN = 48;

type Preview = { readonly url: string; readonly file: File };

/**
 * Juntar imagens aprovadas (#120): pick two to four approved pictures, see
 * them joined, and either send the montage as the scene's own picture or
 * choose the pictures themselves for the scene to be generated from.
 *
 * Generated from, the pictures go apart and not as the montage: on
 * 2026-10-26 Seedream 4.5 Edit handed the montage put the pen beside the
 * book on its white, and handed the two apart put it on the book.
 *
 * The montage is drawn again on every change of the selection, so what the
 * preview shows is the file that is sent, byte for byte. Nothing is sent by
 * picking: each use is its own button, and the panel's.
 */
export function JoinApproved({
  pictures,
  working,
  busyKey,
  onSideBySide,
  onCompose,
}: {
  readonly pictures: readonly ApprovedPicture[];
  readonly working: boolean;
  readonly busyKey: string | null;
  readonly onSideBySide: (file: File) => void;
  readonly onCompose: (pictures: readonly ApprovedPicture[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<readonly ApprovedPicture[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Only the newest draw may land: picking fast starts several.
  const latest = useRef(0);
  const shownUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (shownUrl.current !== null) URL.revokeObjectURL(shownUrl.current);
    },
    [],
  );

  function show(next: Preview | null) {
    if (shownUrl.current !== null) URL.revokeObjectURL(shownUrl.current);
    shownUrl.current = next?.url ?? null;
    setPreview(next);
  }

  async function choose(next: readonly ApprovedPicture[]) {
    setChosen(next);
    setProblem(null);
    const draw = ++latest.current;
    if (next.length < MONTAGE_MIN) {
      show(null);
      setDrawing(false);
      return;
    }
    setDrawing(true);
    try {
      const file = await drawMontage(next);
      if (draw !== latest.current) return;
      show({ url: URL.createObjectURL(file), file });
    } catch (cause) {
      if (draw !== latest.current) return;
      show(null);
      if (!(cause instanceof MontageFailed)) console.error(cause);
      setProblem(
        cause instanceof MontageFailed
          ? cause.message
          : "Não consegui juntar as imagens.",
      );
    } finally {
      if (draw === latest.current) setDrawing(false);
    }
  }

  function toggle(picture: ApprovedPicture) {
    const at = chosen.findIndex((item) => item.key === picture.key);
    if (at >= 0) {
      void choose(chosen.filter((item) => item.key !== picture.key));
    } else if (chosen.length < MONTAGE_MAX) {
      void choose([...chosen, picture]);
    }
  }

  const needle = query.trim().toLowerCase();
  const matches = pictures.filter((picture) =>
    picture.label.toLowerCase().includes(needle),
  );
  const ready = preview !== null && !drawing;

  return (
    <details className="flex flex-col gap-2 pt-2">
      <summary className="text-faint cursor-pointer font-mono text-xs tracking-[0.16em] uppercase">
        Juntar imagens aprovadas
      </summary>
      <div className="flex flex-col gap-3 pt-2">
        <p className="text-faint text-xs">
          Escolha de {MONTAGE_MIN} a {MONTAGE_MAX} imagens aprovadas, de
          palavras ou de outras cenas, na ordem em que entram, da esquerda para
          a direita.
        </p>
        <input
          aria-label="Buscar imagem aprovada"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="buscar: pen, book…"
          className="border-rule bg-background w-full rounded-sm border px-3 py-2 text-sm"
        />
        {matches.length === 0 ? (
          <p className="text-muted text-sm">
            Nenhuma imagem aprovada com isso.
          </p>
        ) : (
          <ul className="grid grid-cols-4 gap-2">
            {matches.slice(0, SHOWN).map((picture) => {
              const order = chosen.findIndex(
                (item) => item.key === picture.key,
              );
              const full = order < 0 && chosen.length >= MONTAGE_MAX;
              return (
                <li key={picture.key}>
                  <button
                    type="button"
                    aria-pressed={order >= 0}
                    disabled={full}
                    title={
                      full ? `No máximo ${MONTAGE_MAX} imagens` : picture.label
                    }
                    onClick={() => toggle(picture)}
                    className={
                      order >= 0
                        ? "border-foreground relative flex w-full flex-col items-center gap-1 rounded-sm border-2 p-1"
                        : "border-rule hover:bg-background relative flex w-full flex-col items-center gap-1 rounded-sm border p-1 transition-colors disabled:opacity-40"
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a public bucket URL, shown as stored */}
                    <img
                      src={picture.url}
                      alt=""
                      loading="lazy"
                      className="aspect-square w-full rounded-sm object-cover"
                    />
                    <span className="w-full truncate text-xs">
                      {picture.label}
                    </span>
                    {order >= 0 && (
                      <span className="bg-foreground text-background absolute top-1 left-1 rounded-sm px-1.5 font-mono text-xs">
                        {order + 1}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {matches.length > SHOWN && (
          <p className="text-faint text-xs">
            Mostrando {SHOWN} de {matches.length}. Busque para achar as outras.
          </p>
        )}

        {chosen.length > 0 && chosen.length < MONTAGE_MIN && (
          <p className="text-faint text-xs">Escolha mais uma.</p>
        )}
        {drawing && <p className="text-faint text-xs">juntando</p>}
        {problem !== null && <p className="text-sm">{problem}</p>}
        {preview !== null && (
          <div className="flex flex-col gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, the file that is sent */}
            <img
              src={preview.url}
              alt={`Montagem de ${chosen.map((item) => item.label).join(", ")}`}
              className="border-rule w-full max-w-80 rounded-sm border"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={working || !ready}
                onClick={() => onSideBySide(preview.file)}
                className="border-rule hover:bg-background rounded-sm border px-4 py-2 text-sm transition-colors disabled:opacity-50"
              >
                {busyKey === "lado-a-lado" ? "enviando" : "Enviar lado a lado"}
              </button>
              <button
                type="button"
                disabled={working || !ready}
                onClick={() => onCompose(chosen)}
                className="border-rule hover:bg-background rounded-sm border px-4 py-2 text-sm transition-colors disabled:opacity-50"
              >
                {busyKey === "compor" ? "copiando" : "Usar como referência"}
              </button>
            </div>
            <p className="text-faint text-xs">
              Lado a lado: a montagem é a imagem da cena, sem gerar e sem
              crédito; entra nas tentativas e espera a sua aprovação. Como
              referência: as imagens vão separadas para o Gerar acima, que
              desenha a cena com elas.
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
