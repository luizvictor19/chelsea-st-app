"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  discardBatch,
  loadBatch,
  pendingCount,
  saveBatch,
  staleness,
  type StaleReason,
  type StoredBatch,
  type StoredPage,
} from "@/lib/content/batch-store";
import { extractPage, resolveBatch } from "@/lib/extraction/pipeline";
import {
  createTesseractReader,
  type ClosableOcrReader,
} from "@/lib/extraction/ocr-tesseract";

import { configureBook } from "../actions";
import { bitmapToCanvas, fileToBitmap } from "./browser-bitmap";
import { ReviewPanel } from "./review-panel";
import {
  fromResolved,
  fromStored,
  type ReviewSourcePage,
} from "./review-source";

/** A page that could not be read, kept so the batch can carry on without it. */
export type PageFailure = {
  readonly id: string;
  readonly reason: string;
};

/**
 * A batch under review, whether it was just read or restored.
 *
 * The range is carried with it rather than read from the book: it is the range
 * the batch was read against, and it is what a later restore compares itself
 * to before offering the batch back.
 */
type Batch = {
  readonly readAt: string;
  readonly firstPoint: number;
  readonly lastPoint: number;
  readonly pages: readonly ReviewSourcePage[];
  readonly failures: readonly PageFailure[];
};

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "reading"; readonly done: number; readonly total: number }
  | { readonly kind: "reviewing"; readonly batch: Batch }
  | { readonly kind: "failed"; readonly message: string };

/** A batch found on this computer, and why it may not be reopened. */
type Interrupted = {
  readonly batch: StoredBatch;
  readonly reason: StaleReason | null;
};

type Book = {
  readonly id: string;
  readonly position: number;
  readonly title: string;
  readonly firstPoint: number | null;
  readonly lastPoint: number | null;
};

/**
 * The range form, the dropzone and the review panel are one machine sharing one
 * state, but the screen puts them in three different places: the form and the
 * dropzone sit in the left column, the review takes the full width underneath,
 * and on a book with no range yet the form is the body of step one. So the
 * state lives here and the parts below read it, leaving the layout to the page.
 */
type Workbench = {
  readonly book: Book;
  readonly floor: string;
  readonly setFloor: (value: string) => void;
  readonly ceiling: string;
  readonly setCeiling: (value: string) => void;
  readonly saving: boolean;
  readonly rangeError: string | null;
  readonly saveRange: () => void;
  readonly phase: Phase;
  readonly readFiles: (files: readonly File[]) => void;
  readonly endReview: () => void;
  readonly interrupted: Interrupted | null;
  readonly resumeBatch: () => void;
  readonly persistBatch: (pages: readonly StoredPage[]) => void;
  /** How many files are waiting on an answer about the unfinished batch. */
  readonly pendingUpload: number | null;
  readonly confirmUpload: () => void;
  readonly cancelUpload: () => void;
};

/**
 * One identity per uploaded file.
 *
 * The file name was the identity, and two photographs dropped in together are
 * often called the same thing: they became one page, one draft, and editing
 * either edited both. The name is kept as the name, because it is what the
 * database records as the writer, and the second one to arrive is told apart
 * on screen by the count after it.
 */
function uniqueIds(files: readonly File[]): readonly string[] {
  const taken = new Set<string>();
  return files.map((file) => {
    let id = file.name;
    for (let n = 2; taken.has(id); n += 1) {
      id = `${file.name} (${n})`;
    }
    taken.add(id);
    return id;
  });
}

const WorkbenchContext = createContext<Workbench | null>(null);

function useWorkbench(): Workbench {
  const value = useContext(WorkbenchContext);
  if (value === null) {
    throw new Error("A workbench part was rendered outside <BookWorkbench>.");
  }
  return value;
}

export function BookWorkbench({
  bookId,
  bookPosition,
  bookTitle,
  firstPoint,
  lastPoint,
  children,
}: {
  bookId: string;
  bookPosition: number;
  bookTitle: string;
  firstPoint: number | null;
  lastPoint: number | null;
  children: ReactNode;
}) {
  const [floor, setFloor] = useState(
    firstPoint === null ? "" : String(firstPoint),
  );
  const [ceiling, setCeiling] = useState(
    lastPoint === null ? "" : String(lastPoint),
  );
  const [saving, setSaving] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [interrupted, setInterrupted] = useState<Interrupted | null>(null);
  /** Files dropped while an unfinished batch was still on the screen. */
  const [pendingUpload, setPendingUpload] = useState<readonly File[] | null>(
    null,
  );

  /*
   * An unfinished batch left on this computer.
   *
   * Looked up by book, which is the whole of the guarantee that one book never
   * shows another's pages: the store is keyed by book id and this is the only
   * place that asks it anything.
   */
  useEffect(() => {
    let cancelled = false;
    void loadBatch(bookId)
      .then((batch) => {
        if (cancelled || batch === null) {
          return;
        }
        setInterrupted({
          batch,
          reason: staleness(batch, firstPoint, lastPoint),
        });
      })
      .catch(() => {
        // A browser that will not open the database simply has nothing to
        // offer back. The review still works; it just is not kept.
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, firstPoint, lastPoint]);

  async function saveRange() {
    const from = Number(floor);
    const to = Number(ceiling);
    if (
      !Number.isInteger(from) ||
      from < 1 ||
      !Number.isInteger(to) ||
      to < 1
    ) {
      setRangeError("Os dois números são inteiros maiores que zero.");
      return;
    }
    if (to < from) {
      setRangeError("O último ponto não pode ser menor que o primeiro.");
      return;
    }
    setSaving(true);
    setRangeError(null);
    const result = await configureBook(bookId, bookPosition, from, to);
    setSaving(false);
    if (result.status === "error") {
      setRangeError(result.message);
    }
  }

  async function readFiles(files: readonly File[]) {
    if (firstPoint === null || lastPoint === null) {
      setPhase({
        kind: "failed",
        message:
          "Defina o primeiro e o último ponto do livro antes de subir páginas.",
      });
      return;
    }

    const list = [...files];
    if (list.length === 0) {
      return;
    }
    const ids = uniqueIds(list);
    const names = new Map(ids.map((id, index) => [id, list[index].name]));
    setPhase({ kind: "reading", done: 0, total: list.length });

    /*
     * Everything that can throw is in here.
     *
     * The reader was built outside and the batch was resolved outside, so a
     * worker that would not start, or a reconciliation that threw, rejected a
     * promise nobody was holding: the progress bar stayed where it was for
     * ever, with no error, no way back and nothing kept.
     */
    let reader: ClosableOcrReader | null = null;
    try {
      // The engine runs here, in the teacher's browser. The pages never leave
      // the machine and the raw text never reaches the database: only what
      // comes back from the review below is written.
      reader = createTesseractReader({
        encode: async (image) => bitmapToCanvas(image),
      });

      const extractions = [];
      const failures: PageFailure[] = [];
      for (const [index, file] of list.entries()) {
        const id = ids[index];
        // One bad page must not cost the other fifty-nine. It is named in the
        // review with its reason, and the batch carries on without it.
        try {
          const bitmap = await fileToBitmap(file);
          extractions.push(await extractPage(id, index, bitmap, reader));
        } catch (error) {
          failures.push({
            id,
            reason:
              error instanceof Error ? error.message : "erro desconhecido",
          });
        }
        setPhase({ kind: "reading", done: index + 1, total: list.length });
      }

      const pages = resolveBatch(extractions, {
        first: firstPoint,
        last: lastPoint,
      }).map((page) =>
        fromResolved(page, names.get(page.extraction.id) ?? page.extraction.id),
      );
      setInterrupted(null);
      setPhase({
        kind: "reviewing",
        batch: {
          readAt: new Date().toISOString(),
          firstPoint,
          lastPoint,
          pages,
          failures,
        },
      });
    } catch (error) {
      setPhase({
        kind: "failed",
        message: `Não foi possível ler este envio: ${
          error instanceof Error ? error.message : "erro desconhecido"
        }. Tente subir as páginas de novo.`,
      });
    } finally {
      try {
        await reader?.close();
      } catch {
        // A worker that will not shut down has nothing to tell the teacher,
        // and must not turn a finished reading into a failed one.
      }
    }
  }

  /*
   * Between the dropzone and the reading, when there is something to lose.
   *
   * A batch left unfinished on this computer is overwritten by the next upload,
   * and dropping files while its card was on the screen threw it away without
   * a word. The files wait here until the teacher says which of the two to
   * keep.
   */
  function beginRead(files: readonly File[]) {
    const list = [...files];
    if (list.length === 0) {
      return;
    }
    if (interrupted !== null) {
      setPendingUpload(list);
      return;
    }
    void readFiles(list);
  }

  function confirmUpload() {
    const waiting = pendingUpload;
    setPendingUpload(null);
    if (waiting === null) {
      return;
    }
    // The unfinished batch is let go only when the new reading has arrived, so
    // a reading that fails leaves it on the screen to be resumed.
    void readFiles(waiting);
  }

  /** Puts a batch found on this computer back on the screen. */
  function resumeBatch() {
    if (interrupted === null || interrupted.reason !== null) {
      return;
    }
    const stored = interrupted.batch;
    setInterrupted(null);
    setPhase({
      kind: "reviewing",
      batch: {
        readAt: stored.readAt,
        firstPoint: stored.firstPoint,
        lastPoint: stored.lastPoint,
        pages: stored.pages.map(fromStored),
        failures: [],
      },
    });
  }

  /** Throws the batch away, on the screen and on the computer alike. */
  function discard() {
    setInterrupted(null);
    setPendingUpload(null);
    setPhase({ kind: "idle" });
    void discardBatch(bookId).catch(() => {
      // Nothing to tell the teacher: the batch is already gone from the screen.
    });
  }

  function persistBatch(pages: readonly StoredPage[]) {
    if (phase.kind !== "reviewing") {
      return;
    }
    const batch = phase.batch;
    void saveBatch({
      bookId,
      bookPosition,
      firstPoint: batch.firstPoint,
      lastPoint: batch.lastPoint,
      readAt: batch.readAt,
      pages,
    }).catch(() => {
      // The review carries on unkept rather than stopping over storage.
    });
  }

  return (
    <WorkbenchContext.Provider
      value={{
        book: {
          id: bookId,
          position: bookPosition,
          title: bookTitle,
          firstPoint,
          lastPoint,
        },
        floor,
        setFloor,
        ceiling,
        setCeiling,
        saving,
        rangeError,
        saveRange: () => void saveRange(),
        phase,
        readFiles: beginRead,
        endReview: discard,
        interrupted,
        resumeBatch,
        persistBatch,
        pendingUpload: pendingUpload === null ? null : pendingUpload.length,
        confirmUpload,
        cancelUpload: () => setPendingUpload(null),
      }}
    >
      {children}
    </WorkbenchContext.Provider>
  );
}

const NUMBER_FIELD =
  "border-rule bg-background w-[5.75rem] rounded-sm border px-3 py-2 font-mono text-sm";

/**
 * The two numbers and Salvar, without a heading: the empty book puts this in
 * step one and the configured book in the "Faixa do livro" card, and each
 * writes its own words around it.
 */
export function RangeForm({ emphasis = false }: { emphasis?: boolean }) {
  const {
    floor,
    setFloor,
    ceiling,
    setCeiling,
    saving,
    rangeError,
    saveRange,
  } = useWorkbench();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-faint font-mono text-[0.625rem]">primeiro</span>
          <input
            aria-label="Primeiro ponto"
            inputMode="numeric"
            value={floor}
            onChange={(event) => setFloor(event.target.value)}
            className={NUMBER_FIELD}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-faint font-mono text-[0.625rem]">último</span>
          <input
            aria-label="Último ponto"
            inputMode="numeric"
            value={ceiling}
            onChange={(event) => setCeiling(event.target.value)}
            className={NUMBER_FIELD}
          />
        </label>
        <button
          type="button"
          onClick={saveRange}
          disabled={saving}
          className={
            emphasis
              ? "bg-accent text-accent-foreground rounded-sm px-4 py-2.5 text-sm font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              : "border-rule hover:border-foreground disabled:hover:border-rule rounded-sm border px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          }
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>
      {rangeError !== null && (
        <p role="alert" className="text-accent text-sm">
          {rangeError}
        </p>
      )}
    </div>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M20 16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3" />
    </svg>
  );
}

/** The dropzone, which is also the file picker, plus how the reading is going. */
export function UploadArea() {
  const { phase, readFiles, pendingUpload } = useWorkbench();
  const [dragging, setDragging] = useState(false);

  if (phase.kind === "reading") {
    return (
      <section
        aria-label="Subir páginas"
        className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-5"
      >
        <p className="text-muted text-sm">
          Lendo {phase.done} de {phase.total}. Em WASM isso leva alguns segundos
          por página.
        </p>
        <div
          role="progressbar"
          aria-valuenow={phase.done}
          aria-valuemin={0}
          aria-valuemax={phase.total}
          aria-label="Leitura das páginas"
          className="bg-rule h-1 w-full overflow-hidden rounded-sm"
        >
          <div
            className="bg-accent h-full"
            style={{ width: `${(phase.done / phase.total) * 100}%` }}
          />
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Subir páginas" className="flex flex-col gap-3">
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = [...event.dataTransfer.files];
          if (dropped.length > 0) {
            readFiles(dropped);
          }
        }}
        className={`focus-within:border-accent flex cursor-pointer flex-col items-center gap-2.5 rounded-sm border border-dashed px-5 py-7 text-center transition-colors ${
          dragging ? "border-accent bg-surface" : "border-rule"
        }`}
      >
        <UploadIcon className="text-faint" />
        <span className="font-semibold">Arraste as páginas aqui</span>
        <span className="text-faint max-w-[24rem] text-xs leading-relaxed">
          A ordem não importa para página numerada: os números da margem dão a
          ordem. Página sem número herda da anterior no envio, e o navegador
          ordena por nome.
        </span>
        <span className="text-accent mt-0.5 font-mono text-xs">
          escolher arquivos
        </span>
        <input
          type="file"
          accept="image/*"
          multiple
          aria-label="Páginas do livro"
          onChange={(event) => {
            const chosen = [...(event.target.files ?? [])];
            if (chosen.length > 0) {
              readFiles(chosen);
            }
          }}
          className="sr-only"
        />
      </label>

      {pendingUpload !== null && (
        <p role="status" className="text-accent text-sm">
          {pendingUpload}{" "}
          {pendingUpload === 1
            ? "página está esperando"
            : "páginas estão esperando"}
          : diga abaixo o que fazer com o envio interrompido.
        </p>
      )}

      {phase.kind === "failed" && (
        <p role="alert" className="text-accent text-sm">
          {phase.message}
        </p>
      )}
    </section>
  );
}

/** The review, which takes the whole width once a batch has been read. */
export function ReviewRegion() {
  const { book, phase, endReview, persistBatch } = useWorkbench();
  if (phase.kind !== "reviewing") {
    return null;
  }
  return (
    // Keyed by the batch, so a second upload starts with its own drafts and its
    // own focus instead of inheriting the first one's.
    <ReviewPanel
      key={phase.batch.readAt}
      bookId={book.id}
      bookPosition={book.position}
      bookTitle={book.title}
      firstPoint={phase.batch.firstPoint}
      lastPoint={phase.batch.lastPoint}
      pages={phase.batch.pages}
      failures={phase.batch.failures}
      onPersist={persistBatch}
      onDiscard={endReview}
    />
  );
}

/** "04/09 às 23h12", which is how the teacher would say when it was read. */
function whenRead(iso: string): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
  const time = at.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} às ${time.replace(":", "h")}`;
}

const STALE_REASON: Record<StaleReason, string> = {
  "range-changed":
    "A faixa do livro mudou depois desta leitura, então os números dela não valem mais.",
  "all-saved": "Tudo o que este envio tinha para gravar já foi gravado.",
};

/**
 * The batch that was left half-reviewed, offered back.
 *
 * Reading sixty pages takes minutes, and until the batch was kept, closing the
 * tab threw all of it away. What is offered back is the reading, not the pages:
 * the images are deliberately not stored, so a resumed table comes without the
 * crop beside it.
 */
export function InterruptedBatch() {
  const {
    interrupted,
    phase,
    resumeBatch,
    endReview,
    pendingUpload,
    confirmUpload,
    cancelUpload,
  } = useWorkbench();
  if (
    interrupted === null ||
    phase.kind === "reading" ||
    phase.kind === "reviewing"
  ) {
    return null;
  }

  const { batch, reason } = interrupted;
  const pending = pendingCount(batch);

  // Files were dropped on top of this batch. One of the two is about to be
  // lost, and which one is not the screen's decision to make quietly.
  if (pendingUpload !== null) {
    return (
      <section
        aria-label="Envio interrompido"
        className="border-accent flex flex-col gap-2 rounded-sm border px-4.5 py-4"
      >
        <span className="text-accent font-mono text-[0.625rem] tracking-[0.14em] uppercase">
          Substituir o envio interrompido?
        </span>
        <p className="text-muted text-sm leading-relaxed">
          Há {batch.pages.length}{" "}
          {batch.pages.length === 1 ? "página lida" : "páginas lidas"} em{" "}
          {whenRead(batch.readAt)}, {pending} ainda por gravar. Ler{" "}
          {pendingUpload}{" "}
          {pendingUpload === 1 ? "página nova" : "páginas novas"} apaga esse
          envio deste computador. O que já foi gravado no banco continua lá.
        </p>
        <div className="mt-0.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={confirmUpload}
            className="bg-accent text-accent-foreground rounded-sm px-3.5 py-2 text-xs font-bold transition-opacity hover:opacity-90"
          >
            Substituir e ler as novas
          </button>
          <button
            type="button"
            onClick={cancelUpload}
            className="border-rule text-muted hover:border-foreground hover:text-foreground rounded-sm border px-3.5 py-2 text-xs transition-colors"
          >
            Manter o envio interrompido
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Envio interrompido"
      className="border-accent flex flex-col gap-2 rounded-sm border px-4.5 py-4"
    >
      <span className="text-accent font-mono text-[0.625rem] tracking-[0.14em] uppercase">
        Envio interrompido
      </span>
      <p className="text-muted text-sm leading-relaxed">
        {batch.pages.length}{" "}
        {batch.pages.length === 1 ? "página lida" : "páginas lidas"} em{" "}
        {whenRead(batch.readAt)}
        {reason === null
          ? `, ${pending} ainda por gravar. A leitura ficou salva neste computador, mas as imagens não: uma tabela volta sem o recorte ao lado.`
          : `. ${STALE_REASON[reason]}`}
      </p>
      <div className="mt-0.5 flex flex-wrap gap-2">
        {reason === null && (
          <button
            type="button"
            onClick={resumeBatch}
            className="bg-accent text-accent-foreground rounded-sm px-3.5 py-2 text-xs font-bold transition-opacity hover:opacity-90"
          >
            Retomar revisão
          </button>
        )}
        <button
          type="button"
          onClick={endReview}
          className="border-rule text-muted hover:border-foreground hover:text-foreground rounded-sm border px-3.5 py-2 text-xs transition-colors"
        >
          Descartar
        </button>
      </div>
    </section>
  );
}
