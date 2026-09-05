import type { BlockKind } from "@/lib/extraction/classify";

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
};

export type StoredPage = {
  readonly id: string;
  readonly uploadIndex: number;
  readonly points: readonly number[];
  readonly inheritedPoint: number | null;
  readonly duplicateOf: string | null;
  readonly lessonNumber: number | null;
  readonly disputes: readonly {
    readonly y: number;
    readonly candidates: readonly number[];
  }[];
  readonly unsupported: "revision_exercise" | null;
  readonly refused: boolean;
  readonly blocks: readonly StoredBlock[];
  /** Points already written from this page, so a reload knows what is done. */
  readonly savedPoints: readonly number[];
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
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Keyed by book: one interrupted batch per book, and opening a book
        // can only ever find its own.
        db.createObjectStore(STORE, { keyPath: "bookId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
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
  const pending = batch.pages.filter(
    (page) =>
      page.duplicateOf === null &&
      page.unsupported === null &&
      !page.refused &&
      page.savedPoints.length === 0,
  );
  return pending.length === 0 ? "all-saved" : null;
}

/** How many pages of the batch are still waiting, for the resume card. */
export function pendingCount(batch: StoredBatch): number {
  return batch.pages.filter(
    (page) =>
      page.duplicateOf === null &&
      page.unsupported === null &&
      !page.refused &&
      page.savedPoints.length === 0,
  ).length;
}
