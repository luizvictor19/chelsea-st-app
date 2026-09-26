"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Representation } from "@/lib/content/queries";

import { applyToWords, saveContrastSet, suggestSubject } from "./actions";
import {
  SUBJECT_CONCURRENCY,
  inPool,
  losingPicture,
  setBlocker,
  subjectPlan,
  type BulkChange,
  type BulkWord,
} from "./bulk";
import {
  IMAGE_STYLE_LABELS,
  bulkError,
  bulkNotice,
  setFailed,
  setSaved,
  subjectsNotice,
  tell,
} from "./notice-texts";
import { reclassifyWarningMany, settle } from "./panel-state";
import { REPRESENTATIONS, labelFor } from "./representation";
import { WORD_CLASS_LABELS } from "./word-class";

type Selection = {
  readonly selected: ReadonlySet<string>;
  /** True while an action runs: the selection is what it acts on. */
  readonly locked: boolean;
  toggle(id: string): void;
  setMany(ids: readonly string[], on: boolean): void;
};

const SelectionContext = createContext<Selection | null>(null);

function useSelection(): Selection {
  const selection = useContext(SelectionContext);
  if (selection === null) {
    throw new Error("A selection control outside BulkSelection");
  }
  return selection;
}

/**
 * The selection on the images list and the bar that acts on it.
 *
 * `words` is every word the list shows, in book order, as the page last
 * rendered them. The selection is read through it, so a word that leaves the
 * list after a reload leaves the selection with it. `filterKey` changes with
 * the filter and the search; a change clears the selection, so no action can
 * land on a word that is no longer on the screen.
 *
 * Only the list is locked while an action runs. The rows stay links, so the
 * teacher can go on opening words in the panel meanwhile.
 */
export function BulkSelection({
  words,
  filterKey,
  children,
}: {
  readonly words: readonly BulkWord[];
  readonly filterKey: string;
  readonly children: ReactNode;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [running, setRunning] = useState<string | null>(null);
  const [selectedFor, setSelectedFor] = useState(filterKey);
  // Adjusted while rendering, not in an effect: a filter change must never
  // paint one frame with the old selection over the new list.
  if (selectedFor !== filterKey) {
    setSelectedFor(filterKey);
    setSelected(new Set());
  }

  const locked = running !== null;
  const selection: Selection = {
    selected,
    locked,
    toggle(id) {
      if (locked) return;
      setSelected((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    },
    setMany(ids, on) {
      if (locked) return;
      setSelected((current) => {
        const next = new Set(current);
        for (const id of ids) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
  };

  return (
    <SelectionContext.Provider value={selection}>
      <BulkBar
        chosen={words.filter((word) => selected.has(word.id))}
        running={running}
        setRunning={setRunning}
        clear={() => setSelected(new Set())}
      />
      {children}
    </SelectionContext.Provider>
  );
}

/** The box on a row. Outside the row's link, so it never opens the word. */
export function SelectBox({
  id,
  term,
}: {
  readonly id: string;
  readonly term: string;
}) {
  const { selected, locked, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      aria-label={`Selecionar ${term}`}
      checked={selected.has(id)}
      disabled={locked}
      onChange={() => toggle(id)}
      className="accent-foreground size-4 shrink-0 disabled:opacity-50"
    />
  );
}

/** The box on a lesson's header: every word of it the list shows. */
export function LessonSelectBox({
  ids,
  label,
}: {
  readonly ids: readonly string[];
  readonly label: string;
}) {
  const { selected, locked, setMany } = useSelection();
  const box = useRef<HTMLInputElement>(null);
  const count = ids.filter((id) => selected.has(id)).length;
  const all = ids.length > 0 && count === ids.length;
  const some = count > 0 && !all;
  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = some;
  }, [some]);
  return (
    <input
      ref={box}
      type="checkbox"
      aria-label={`Selecionar as palavras de ${label}`}
      checked={all}
      disabled={locked}
      onChange={() => setMany(ids, !all)}
      className="accent-foreground size-4 shrink-0 disabled:opacity-50"
    />
  );
}

const BAR_BUTTON =
  "border-rule hover:bg-background rounded-sm border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-40";
const BAR_SELECT =
  "border-rule bg-background rounded-sm border px-2 py-1 text-xs disabled:opacity-40";

function BulkBar({
  chosen,
  running,
  setRunning,
  clear,
}: {
  readonly chosen: readonly BulkWord[];
  readonly running: string | null;
  readonly setRunning: (label: string | null) => void;
  readonly clear: () => void;
}) {
  const confirm = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<{
    readonly change: BulkChange;
    readonly losing: ReturnType<typeof losingPicture>;
  } | null>(null);

  if (chosen.length === 0 && running === null) return null;

  const busy = running !== null;
  const blocker = setBlocker(chosen);
  const termOf = new Map(chosen.map((word) => [word.id, word.term]));

  /** One action at a time, and the selection is cleared when it ends. */
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setRunning(label);
    try {
      await action();
    } finally {
      setRunning(null);
      clear();
    }
  }

  function apply(change: BulkChange, words: readonly BulkWord[]) {
    void run(`Gravando ${words.length} palavras…`, async () => {
      const result = await settle(() =>
        applyToWords(
          words.map((word) => word.id),
          change,
        ),
      );
      if (!result.ok) {
        tell(bulkError(words.length, result.error));
        return;
      }
      tell(bulkNotice(change, result.outcomes, (id) => termOf.get(id) ?? id));
    });
  }

  /*
   * One confirmation for the whole selection, and only when some word would
   * lose an approved picture: the same question the panel asks for one word,
   * with the same effect behind it.
   */
  function ask(change: BulkChange) {
    const words = chosen;
    const losing = losingPicture(change, words);
    if (losing.length === 0) {
      apply(change, words);
      return;
    }
    setPending({ change, losing });
    confirm.current?.showModal();
  }

  function createSet() {
    const words = chosen;
    const terms = words.map((word) => word.term);
    void run(`Gravando ${words.length} palavras…`, async () => {
      // In book order: the list's order, which is the order chosen is in.
      const result = await settle(() =>
        saveContrastSet(
          words.map((word) => word.id),
          null,
        ),
      );
      tell(result.ok ? setSaved(terms) : setFailed(terms, result.error));
    });
  }

  function generateSubjects() {
    const words = chosen;
    const plans = words.map((word) => ({ word, plan: subjectPlan(word) }));
    const asks = plans.filter((p) => p.plan === "ask").map((p) => p.word);
    const had = plans.filter((p) => p.plan === "has-one").length;
    const noPicture = plans.filter((p) => p.plan === "no-picture").length;
    const total = asks.length;
    void run(`instrução ${Math.min(1, total)} de ${total}`, async () => {
      const answers = await inPool(
        asks,
        SUBJECT_CONCURRENCY,
        (word) => settle(() => suggestSubject(word.id, null)),
        (finished) =>
          setRunning(`instrução ${Math.min(finished + 1, total)} de ${total}`),
      );
      let generated = 0;
      let arrived = 0;
      const failed: { term: string; error: string }[] = [];
      answers.forEach((answer, index) => {
        const term = asks[index]?.term ?? "";
        if (!answer.ok) failed.push({ term, error: answer.error });
        // Not stored: an instruction reached the word meanwhile, and the
        // compare-and-set kept it. The word had one after all.
        else if (answer.stored) generated++;
        else arrived++;
      });
      tell(
        subjectsNotice({ generated, had: had + arrived, noPicture, failed }),
      );
    });
  }

  return (
    <>
      {/*
        Sticky at the top of the list. Below lg the page scrolls, so it sits
        under the teacher nav (h-14 and a 1px border); from lg the list scrolls
        inside its own column, whose top is 0.
      */}
      <div
        role="region"
        aria-label="Ações nas palavras selecionadas"
        className="bg-surface border-rule sticky top-[calc(3.5rem+1px)] z-10 flex flex-wrap items-center gap-2 rounded-sm border px-3 py-2 lg:top-0"
      >
        <span className="mr-2 text-sm font-semibold">
          {chosen.length === 1
            ? "1 selecionada"
            : `${chosen.length} selecionadas`}
        </span>
        {running !== null ? (
          <span role="status" className="text-muted text-xs">
            {running}
          </span>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => ask({ kind: "accept" })}
          className={BAR_BUTTON}
        >
          Aceitar sugestão
        </button>
        <select
          aria-label="Definir tipo"
          value=""
          disabled={busy}
          onChange={(event) =>
            ask({
              kind: "representation",
              value: event.target.value as Representation,
            })
          }
          className={BAR_SELECT}
        >
          <option value="">Definir tipo</option>
          {REPRESENTATIONS.map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Classe gramatical"
          value=""
          disabled={busy}
          onChange={(event) =>
            ask({
              kind: "wordClass",
              value: event.target
                .value as (typeof WORD_CLASS_LABELS)[number]["value"],
            })
          }
          className={BAR_SELECT}
        >
          <option value="">Classe</option>
          {WORD_CLASS_LABELS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Estilo da imagem"
          value=""
          disabled={busy}
          onChange={(event) =>
            ask({
              kind: "style",
              value: event.target.value as keyof typeof IMAGE_STYLE_LABELS,
            })
          }
          className={BAR_SELECT}
        >
          <option value="">Estilo</option>
          {Object.entries(IMAGE_STYLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || blocker !== null}
          title={
            blocker ?? "Liga as selecionadas num conjunto, na ordem do livro"
          }
          onClick={createSet}
          className={BAR_BUTTON}
        >
          Criar conjunto
        </button>
        <button
          type="button"
          disabled={busy}
          title="Pede a instrução ao modelo para as que ainda não têm. As que têm não são tocadas."
          onClick={generateSubjects}
          className={BAR_BUTTON}
        >
          Gerar instrução
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={clear}
          className="text-muted hover:text-foreground ml-auto px-1 text-xs disabled:opacity-40"
        >
          Limpar seleção
        </button>
      </div>

      <dialog
        ref={confirm}
        aria-labelledby="reclassificar-varias-titulo"
        onClose={() => setPending(null)}
        className="border-rule bg-surface text-foreground m-auto max-w-sm rounded-sm border p-6 backdrop:bg-black/40"
      >
        {pending !== null && (
          <div className="flex flex-col gap-4">
            <h2
              id="reclassificar-varias-titulo"
              className="text-base font-extrabold tracking-tight"
            >
              Tirar a imagem destas palavras?
            </h2>
            <ul className="text-sm">
              {pending.losing.map(({ word, kind }) => (
                <li key={word.id}>
                  <span className="font-semibold">{word.term}</span>
                  <span className="text-faint">
                    {" "}
                    · {labelFor(kind).toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted text-sm">
              {reclassifyWarningMany(
                pending.losing.map(({ kind }) => labelFor(kind)),
              )}
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
                  // Bound before the close, because closing clears it.
                  const change = pending.change;
                  confirm.current?.close();
                  apply(change, chosen);
                }}
                className="border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold"
              >
                Trocar o tipo
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
