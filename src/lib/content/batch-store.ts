import type { BlockKind } from "@/lib/extraction/classify";
import type { PointStart } from "./unread-points";

/**
 * The reading of an upload, kept on the teacher's machine.
 *
 * A batch of sixty pages takes minutes to read and lives only in the tab that
 * read it, so closing it, reloading, or a crash used to throw the work away.
 * This keeps it in the browser's own database, which is coherent with the rest
 * of the design: the pages never leave the machine, and neither does this.
 *
 * Deliberately not the page images. They are the largest thing in the batch by
 * far and the review only needs them for the crop beside a flagged table, so a
 * restored batch shows the text without the crop rather than costing hundreds
 * of megabytes to store. The crop comes back by uploading the page again.
 */
export type StoredBlock = {
  readonly kind: BlockKind;
  readonly content: string;
  readonly needsReview: boolean;
  /**
   * Where the block sat on the page.
   *
   * Kept because a spread carries two numbers and a block belongs to the last
   * one printed above it. Without the height a restored spread could only put
   * everything on its first point, which is the misfiling this whole design
   * exists to prevent, and it would happen silently.
   */
  readonly top: number;
};

export type StoredPage = {
  /**
   * This page's identity inside the batch.
   *
   * Unique per uploaded file, which the file name is not: two photographs
   * dropped in together can be called the same thing, and keying anything on
   * the name makes them one page. The name is kept beside it, in fileName,
   * because that is what the database records as the writer.
   */
  readonly id: string;
  /** The name of the file this page was read from, as source_page wants it. */
  readonly fileName: string;
  readonly uploadIndex: number;
  readonly points: readonly number[];
  /** The numbers with the height each was printed at, to split a spread. */
  readonly placements: readonly {
    readonly number: number;
    readonly y: number;
  }[];
  readonly inheritedPoint: number | null;
  /**
   * What lies above the page, both halves of it.
   *
   * Stored for the same reason the heights are: what was printed above the
   * page's first number belongs to the last number of the page before, and a
   * restored batch has no other way to know which point that was. Both halves,
   * because storing only the merged one left a restored first page of a book
   * unable to tell "the point above is mine" from "the point above is the page
   * before's", which is the distinction the two fields exist for.
   */
  readonly precedingPoint: number | null;
  readonly openingPoint: number | null;
  readonly duplicateOf: string | null;
  readonly lessonNumber: number | null;
  /** Whether that lesson starts on this page, which the point above it is not in. */
  readonly opensLesson: boolean;
  readonly disputes: readonly {
    readonly y: number;
    readonly candidates: readonly number[];
  }[];
  readonly unsupported: "revision_exercise" | null;
  readonly refused: boolean;
  /**
   * Where the teacher said a point the margin reader missed begins.
   *
   * Stored because it is an answer and not a derivation: nothing on the page
   * can produce it again. Without it a reload puts the same question back on a
   * page that was already answered, and the blocks it placed go back to being
   * unfiled, which is the one state that blocks a page from being written at
   * all.
   */
  readonly pointStarts: readonly PointStart[];
  readonly blocks: readonly StoredBlock[];
  /** Points already written from this page, so a reload knows what is done. */
  readonly savedPoints: readonly number[];
  /**
   * The page was written and then edited, so the blocks above are ahead of the
   * database.
   *
   * Kept, because without it a restore reads "it has saved points" as "it is
   * finished" and the edit becomes unreachable a second time, which is the
   * whole reason the flag exists on the screen.
   */
  readonly changedSinceSaving: boolean;
};

export type StoredBatch = {
  /** Which book the batch belongs to. A batch is never shown under another. */
  readonly bookId: string;
  readonly bookPosition: number;
  /** The range in force when the batch was read, to notice a later change. */
  readonly firstPoint: number;
  readonly lastPoint: number;
  readonly readAt: string;
  readonly pages: readonly StoredPage[];
};

const DATABASE = "chelsea-st";
const STORE = "batches";
/*
 * Bumped when the stored shape changes in a way an older batch cannot satisfy.
 * Version 2 added the heights a spread needs to split its blocks; version 3
 * added the file name beside the page's own identity, because the identity
 * stopped being the file name, and the flag that says an edit has not been
 * written yet; version 4 added the point a page opens in and whether the page
 * starts its own lesson, without which a restored batch files everything
 * printed above a page's first number under that number instead of under the
 * page before, and reads a LESSON header as covering a point printed on the
 * other side of it; version 5 split that point into the two questions it was
 * answering at once, so a restored page knows whether anything precedes it at
 * all; version 6 added the teacher's answer to where a point the margin reader
 * missed begins, which nothing on the page can derive again and which a page
 * cannot be written without. A batch written by an older
 * version has none of them, so upgrading drops what is there rather than
 * restoring something that would file blocks under the wrong point, write them
 * under the wrong name, or call an unwritten edit finished.
 */
const VERSION = 6;

/*
 * Shown when another tab is holding the database at its old version.
 *
 * User-facing: the caller puts it on the screen, and the teacher is the only
 * person who can do anything about it.
 */
const BLOCKED_MESSAGE =
  "Outra aba deste site está usando a versão anterior do banco do navegador. Feche as outras abas deste site e tente de novo.";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Keyed by book: one interrupted batch per book, and opening a book can
      // only ever find its own. Recreated on upgrade because a batch from an
      // older shape cannot be trusted to restore correctly.
      if (db.objectStoreNames.contains(STORE)) {
        db.deleteObjectStore(STORE);
      }
      db.createObjectStore(STORE, { keyPath: "bookId" });
    };
    // An open that needs an upgrade waits for every other connection to close,
    // and a second tab left on the old version never does. Without this the
    // promise simply never settles, and the review kept stacking another
    // dangling request every time it saved.
    request.onblocked = () => reject(new Error(BLOCKED_MESSAGE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Runs one request and settles when its transaction does.
 *
 * On the transaction, not on the request: a put can succeed and the commit
 * still fail, with quota exceeded on a batch of sixty pages as the real case,
 * and resolving on the request would report that as stored when nothing was. The
 * request's own result is held until the commit confirms it.
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      // Wrapped rather than held bare, so "no result yet" is a state of its own
      // and not confused with a request that legitimately returned undefined.
      let outcome: { readonly result: T } | null = null;
      request.onsuccess = () => {
        outcome = { result: request.result };
      };
      request.onerror = () => reject(request.error);
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error("O navegador não conseguiu gravar o envio."),
        );
      transaction.oncomplete = () => {
        if (outcome === null) {
          reject(new Error("A transação terminou sem resultado."));
          return;
        }
        resolve(outcome.result);
      };
    });
  } finally {
    db.close();
  }
}

export async function saveBatch(batch: StoredBatch): Promise<void> {
  await withStore("readwrite", (store) => store.put(batch));
}

/** The batch stored for this book, or null. Never another book's. */
export async function loadBatch(bookId: string): Promise<StoredBatch | null> {
  const found = await withStore<StoredBatch | undefined>("readonly", (store) =>
    store.get(bookId),
  );
  if (found === undefined || found.bookId !== bookId) {
    return null;
  }
  return found;
}

export async function discardBatch(bookId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(bookId));
}

export type StaleReason = "range-changed" | "all-saved";

/**
 * Why a stored batch should not simply be reopened.
 *
 * A batch read against one range may hold numbers that are now outside the
 * book, so it is not trustworthy after the range moves. And a batch whose every
 * page is written has nothing left to do, so offering to resume it would invite
 * writing it all a second time.
 */
export function staleness(
  batch: StoredBatch,
  currentFirst: number | null,
  currentLast: number | null,
): StaleReason | null {
  if (batch.firstPoint !== currentFirst || batch.lastPoint !== currentLast) {
    return "range-changed";
  }
  return batch.pages.some(isPending) ? null : "all-saved";
}

/**
 * A page with work left on it.
 *
 * Never written, or written and edited since: an edit that has not reached the
 * database is as unfinished as a page that was never confirmed at all.
 */
function isPending(page: StoredPage): boolean {
  return (
    page.duplicateOf === null &&
    page.unsupported === null &&
    !page.refused &&
    (page.savedPoints.length === 0 || page.changedSinceSaving)
  );
}

/** How many pages of the batch are still waiting, for the resume card. */
export function pendingCount(batch: StoredBatch): number {
  return batch.pages.filter(isPending).length;
}
