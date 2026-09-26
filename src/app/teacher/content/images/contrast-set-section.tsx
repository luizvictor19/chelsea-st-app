"use client";

import { useMemo, useRef, useState } from "react";

import { dissolveContrastSet, saveContrastSet } from "./actions";
import {
  MIN_MEMBERS,
  candidates,
  isChanged,
  moveMember,
  setsByWord,
  type ContrastRow,
  type SetWord,
} from "./contrast-sets";
import {
  setDissolved,
  setSaved,
  wordFailed,
  tell,
  type NoticeText,
} from "./notice-texts";
import { settle } from "./panel-state";

/**
 * The open word's contrast set: its members in order, a picker to link more
 * words, and the save. Kept apart from WordPanel because nothing in it
 * touches the word's picture, and the set outlives any one of its members'
 * panels.
 *
 * The draft is local until saved, and says so while it differs: an edit that
 * vanished on a click to another word, without a word about it, would be the
 * teacher's work eaten in silence. Opening another word does drop it (the
 * section remounts per word), which is why the unsaved line is loud.
 *
 * A refused save leaves the draft where it is, and says why in the teacher
 * area's snackbar. That includes the database saying the set changed
 * elsewhere since this page loaded: the message asks for a reload, and until
 * then the draft stays on screen to be copied.
 */
export function ContrastSetSection({
  word,
  words,
  rows,
}: {
  readonly word: SetWord;
  readonly words: readonly SetWord[];
  readonly rows: readonly ContrastRow[];
}) {
  const sets = useMemo(() => setsByWord(rows, words), [rows, words]);
  const byId = useMemo(
    () => new Map(words.map((other) => [other.id, other])),
    [words],
  );
  const set = sets.get(word.id) ?? null;
  const saved = set === null ? [word.id] : set.members.map((m) => m.id);

  const [draft, setDraft] = useState<readonly string[]>(saved);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const dissolve = useRef<HTMLDialogElement>(null);

  const changed = isChanged(draft, saved);
  const tooSmall = draft.length < MIN_MEMBERS;
  const offered = candidates(
    word,
    draft,
    words,
    sets,
    set?.id ?? null,
    search,
  ).slice(0, 12);

  /** The success is named before the call, from what is on screen then. */
  async function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    done: NoticeText,
  ) {
    if (busy) return;
    setBusy(true);
    const result = await settle(async () => {
      const answer = await action();
      return answer.ok
        ? { ok: true as const }
        : { ok: false as const, error: answer.error ?? "" };
    });
    setBusy(false);
    tell(result.ok ? done : wordFailed(word.term, result.error));
  }

  return (
    <section
      aria-label={`Conjunto de contraste de ${word.term}`}
      className="border-rule bg-surface mt-6 flex flex-col gap-4 rounded-sm border p-6"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-extrabold tracking-tight">
          Conjunto de contraste
        </h2>
        <p className="text-muted text-sm">
          Palavras que se entendem pela diferença entre elas, como large e
          small. Cada uma tem a sua imagem, de um assunto só, e a apresentação
          mostra o conjunto lado a lado.
        </p>
      </header>

      {set === null && draft.length === 1 ? (
        <p className="text-faint text-sm">
          Esta palavra não está em nenhum conjunto.
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {draft.map((id, index) => {
            const member = byId.get(id);
            const itself = id === word.id;
            return (
              <li
                key={id}
                className="border-rule flex items-center gap-2 rounded-sm border px-3 py-1.5"
              >
                <span className="text-faint w-5 font-mono text-xs">
                  {index + 1}
                </span>
                <span
                  className={
                    itself ? "mr-auto font-semibold" : "text-muted mr-auto"
                  }
                >
                  {member?.term ?? "?"}
                </span>
                <button
                  type="button"
                  aria-label={`Subir ${member?.term ?? ""}`}
                  disabled={busy || index === 0}
                  onClick={() => setDraft(moveMember(draft, index, -1))}
                  className="text-muted hover:text-foreground px-1 text-sm disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Descer ${member?.term ?? ""}`}
                  disabled={busy || index === draft.length - 1}
                  onClick={() => setDraft(moveMember(draft, index, 1))}
                  className="text-muted hover:text-foreground px-1 text-sm disabled:opacity-30"
                >
                  ↓
                </button>
                {/*
                  A new set is built around the open word, so that one word
                  stays. In a saved set any member can leave, this one too.
                */}
                {!(set === null && itself) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setDraft(draft.filter((other) => other !== id))
                    }
                    className="text-muted hover:text-foreground px-1 text-xs disabled:opacity-30"
                  >
                    tirar
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-col gap-2">
        <label
          htmlFor="contraste-busca"
          className="text-faint font-mono text-xs tracking-[0.16em] uppercase"
        >
          Ligar a outra palavra
        </label>
        <input
          id="contraste-busca"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar palavra"
          className="border-rule bg-background rounded-sm border px-3 py-1.5 text-sm"
        />
        {search.trim() === "" && (
          <p className="text-faint text-xs">
            Sem busca, aparecem as palavras do mesmo ponto.
          </p>
        )}
        {offered.length === 0 ? (
          <p className="text-faint text-xs">Nenhuma palavra para ligar.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {offered.map(({ word: other, takenBy }) => (
              <li key={other.id}>
                <button
                  type="button"
                  disabled={busy || takenBy !== null}
                  title={
                    takenBy === null
                      ? undefined
                      : `Em conjunto com ${takenBy.members.map((m) => m.term).join(", ")}`
                  }
                  onClick={() => {
                    setDraft([...draft, other.id]);
                    setSearch("");
                  }}
                  className="border-rule hover:bg-background rounded-sm border px-2 py-1 text-sm transition-colors disabled:opacity-40"
                >
                  + {other.term}
                  <span className="text-faint ml-1 font-mono text-xs">
                    {other.pointNumber ?? "·"}
                  </span>
                  {takenBy !== null && (
                    <span className="text-faint ml-1 text-xs">
                      (em conjunto com{" "}
                      {takenBy.members.map((m) => m.term).join(", ")})
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {changed && (
        <div className="flex flex-col gap-2">
          <p className="text-warning text-sm font-semibold">
            Alterações não salvas. Abrir outra palavra descarta estas.
          </p>
          {tooSmall && (
            <p className="text-muted text-sm">
              Um conjunto precisa de pelo menos duas palavras.
              {set !== null && " Para desfazer este, use Desfazer conjunto."}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || tooSmall}
              onClick={() =>
                void run(
                  () =>
                    saveContrastSet(
                      draft,
                      set === null ? null : { id: set.id, expected: saved },
                    ),
                  setSaved(draft.map((id) => byId.get(id)?.term ?? "?")),
                )
              }
              className="border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {set === null ? "Criar conjunto" : "Salvar conjunto"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDraft(saved)}
              className="border-rule hover:bg-background rounded-sm border px-3 py-1.5 text-sm transition-colors"
            >
              Voltar ao salvo
            </button>
          </div>
        </div>
      )}

      {set !== null && (
        <button
          type="button"
          disabled={busy}
          onClick={() => dissolve.current?.showModal()}
          className="text-muted hover:text-foreground self-start text-sm underline-offset-2 hover:underline disabled:opacity-50"
        >
          Desfazer conjunto
        </button>
      )}

      <dialog
        ref={dissolve}
        aria-labelledby="desfazer-conjunto-titulo"
        className="border-rule bg-surface text-foreground m-auto max-w-sm rounded-sm border p-6 backdrop:bg-black/40"
      >
        {set !== null && (
          <div className="flex flex-col gap-4">
            <h2
              id="desfazer-conjunto-titulo"
              className="text-base font-extrabold tracking-tight"
            >
              Desfazer este conjunto?
            </h2>
            <p className="text-muted text-sm">
              {set.members.map((m) => m.term).join(", ")} deixam de estar
              ligadas. As palavras e as imagens delas continuam como estão.
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
                onClick={() => {
                  const id = set.id;
                  const terms = set.members.map((m) => m.term);
                  dissolve.current?.close();
                  void run(() => dissolveContrastSet(id), setDissolved(terms));
                }}
                className="border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold"
              >
                Desfazer
              </button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}
