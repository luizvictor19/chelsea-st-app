import type { ImageAttempt } from "../../../../lib/content/queries.ts";
import {
  uploadGenerated,
  type UploadBucket,
} from "../../../../lib/images/generated-upload.ts";
import { attemptPath, type PathOwner } from "../../../../lib/images/paths.ts";

import type { ActionResult } from "./attempt-store.ts";

/**
 * Closing a generation's attempt: the one write that takes a row out of
 * 'pending', for an image or for an error (#151).
 *
 * Only a row still 'pending' is closed. A question to the provider can come
 * back late: from a second tab, or from a poll that was downloading while the
 * first one stored the picture and the teacher acted on it. Closed without
 * that filter, the late answer took an approved attempt back to 'generated',
 * turned a generated one into 'failed' when its download failed, wrote
 * completed_at again an instant later (the half of #91's measurement that
 * says how long a generation took), and put back the file of an attempt the
 * teacher had discarded. The filter is in the update itself, so two polls at
 * the same instant cannot both pass a check made before it.
 *
 * Kept out of attempt-store.ts so node can run it against a table held in
 * memory: that file imports next/cache and "@/", which node --test does not
 * resolve. attempt-store.ts hands in the Supabase calls.
 */

/** What a close writes, besides the time. */
export type CloseFields = {
  status: "generated" | "failed";
  error?: string;
  storage_path?: string;
  credits_spent?: number | null;
};

/**
 * An update on image_attempts, and the part of the query builder a close uses
 * after it. attempt-store.ts hands in the Supabase one; the tests hand in a
 * table held in memory.
 */
export type AttemptUpdate = (
  values: CloseFields & { completed_at: string },
) => AttemptFilter;

type AttemptFilter = {
  eq(column: "id" | "status", value: string): AttemptFilter;
  select(columns: "id"): PromiseLike<{
    data: readonly { id: string }[] | null;
    error: { message: string } | null;
  }>;
};

/** The two columns that say whether a row is still open, and whose file. */
export type AttemptRow = {
  readonly status: string;
  readonly storage_path: string | null;
};

/** Everything a close needs, bound to one owner by attempt-store.ts. */
export type AttemptStore = {
  update: AttemptUpdate;
  /** The row now; `row` is null when there is none. */
  read(attemptId: string): Promise<{
    row: AttemptRow | null;
    error: string | null;
  }>;
  bucket: UploadBucket & {
    remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
  };
  /** The owner's attempts, as the panel lists them. */
  list(): Promise<readonly ImageAttempt[]>;
  revalidate(): void;
};

/**
 * Mark a pending attempt as finished, whichever way it finished, and say
 * whether it was still pending.
 *
 * completed_at is written here and nowhere else, so "when it stopped waiting"
 * has one meaning across every row: the moment it left 'pending', for an
 * image or for an error. A row that had already left is not touched, so that
 * moment is written once.
 */
export async function closePending(
  update: AttemptUpdate,
  attemptId: string,
  fields: CloseFields,
): Promise<{ closed: boolean; error: string | null }> {
  const { data, error } = await update({
    ...fields,
    completed_at: new Date().toISOString(),
  })
    .eq("id", attemptId)
    .eq("status", "pending")
    .select("id");
  if (error) return { closed: false, error: error.message };
  return { closed: (data ?? []).length > 0, error: null };
}

/**
 * Close a pending attempt with a reason, and answer with the list it leaves
 * behind.
 *
 * A row that was no longer pending was closed by someone else first: the
 * failure belonged to a question that came back late, not to the attempt, so
 * the screen gets the list as it is and no error.
 */
export async function failPending(
  store: AttemptStore,
  attemptId: string,
  message: string,
): Promise<ActionResult> {
  const { closed, error } = await closePending(store.update, attemptId, {
    status: "failed",
    error: message,
  });
  store.revalidate();
  if (error === null && !closed) {
    return { ok: true, attempts: await store.list() };
  }
  return {
    ok: false,
    error: error === null ? message : `${message} (${error})`,
    attempts: await store.list(),
  };
}

/**
 * The file extension to store an image under. Taken from the content type
 * rather than from the URL, because a generated image arrives from a signed
 * URL whose path says nothing about the format.
 */
function extensionFor(contentType: string | null, fallback: string): string {
  const known: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
  };
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return known[type] ?? fallback;
}

/**
 * Download the generated picture, put it in the bucket and close the row.
 *
 * The row is read first: one that already left 'pending' (stored by another
 * tab, then perhaps approved or discarded) is answered with the list, and
 * nothing is downloaded or uploaded.
 *
 * It can still leave 'pending' while this one downloads. Then the close finds
 * nothing to close, and the file just uploaded is removed unless it is the
 * one the row names: the same path is the same attempt's picture, which
 * another tab stored and may have had approved. A different path, or none,
 * means the teacher discarded it, and putting the file back would undo the
 * discard without a word.
 *
 * `creditsSpent` only if the provider ever reports one. Today it does not,
 * and the figure already on the row is ours, written when the task was
 * accepted; overwriting it with null would erase the only record of the
 * charge. A provider figure, if one ever arrives, is the better source.
 */
export async function storeGeneratedImage(
  store: AttemptStore,
  attemptId: string,
  owner: PathOwner,
  download: () => Promise<Response>,
  creditsSpent?: number,
): Promise<ActionResult> {
  const before = await store.read(attemptId);
  if (before.error !== null) return { ok: false, error: before.error };
  if (before.row?.status !== "pending") {
    return { ok: true, attempts: await store.list() };
  }

  const response = await download();
  if (!response.ok) {
    return failPending(
      store,
      attemptId,
      `Não deu para baixar a imagem: ${response.status}`,
    );
  }
  const contentType = response.headers.get("content-type");
  const bytes = await response.arrayBuffer();
  const path = attemptPath(owner, attemptId, extensionFor(contentType, "png"));

  /*
   * Over a file already there, if there is one: the same path is the same
   * attempt and the same image, stored by an earlier poll whose row write
   * failed, or by a poll from another tab. See uploadGenerated.
   */
  const { error: uploadError } = await uploadGenerated(
    store.bucket,
    path,
    bytes,
    contentType,
  );
  if (uploadError) {
    return failPending(store, attemptId, uploadError.message);
  }

  const { closed, error: doneError } = await closePending(
    store.update,
    attemptId,
    {
      status: "generated",
      storage_path: path,
      ...(creditsSpent === undefined ? {} : { credits_spent: creditsSpent }),
    },
  );
  if (doneError !== null) return { ok: false, error: doneError };

  if (!closed) {
    // Removed only when the row was read and does not name this path: a
    // read that failed says nothing, and the file may be the row's own.
    const after = await store.read(attemptId);
    if (after.error === null && after.row?.storage_path !== path) {
      await store.bucket.remove([path]);
    }
  }

  store.revalidate();
  return { ok: true, attempts: await store.list() };
}
