import { revalidatePath } from "next/cache";

import {
  readAttempts,
  requireTeacher,
  type AttemptOwner,
  type ImageAttempt,
} from "@/lib/content/queries";
import { createFreepikProvider } from "@/lib/images/freepik";
import {
  MAX_REFERENCE_BYTES,
  REFERENCE_TOO_BIG,
} from "@/lib/images/generation";
import { attemptPath, referencePath } from "@/lib/images/paths";
import {
  modelCredits,
  referenceDelivery,
  type ImageModelId,
} from "@/lib/images/provider";
import {
  afterWrite,
  readImageFile,
  uploadFilename,
  type ReadImage,
} from "@/lib/images/upload";

/**
 * The half of an image attempt that does not care whose it is: opening a
 * generation at the provider, storing what comes back, closing a row, sending
 * a finished file, discarding one, and keeping a structure reference.
 *
 * Moved out of actions.ts when a scene got attempts of its own (0030, #64),
 * so a word and a scene spend credits and write files down one path. What is
 * a word's or a scene's (which row holds the kind, the style, the reference,
 * the instruction) stays with the actions that call this.
 *
 * Not a "use server" file: nothing here is an action a browser can call. It
 * is only imported by actions.ts and scene-actions.ts, which check who is
 * asking before they hand it a client.
 */

/**
 * What an action answers with.
 *
 * `attempts` is the list of the word or scene as the action left it, and it
 * is there because the call returning is the only proof the panel has that
 * anything at all reached the browser. The re-render that `revalidatePath`
 * triggers travels in the same response, but nothing proves that half of it
 * landed: on 19/09/2026 it twice did not, after a generation that had taken 8s
 * and 21s.
 *
 * Only the actions that rewrite the list say so. Absent means "I changed
 * nothing there", and the panel keeps what it has. A poll that finds the
 * generation still running says nothing, which is also what makes it cheap.
 *
 * A failure can carry a list too: a generation the provider refused leaves a
 * 'failed' row, and the teacher should see the row as well as the reason.
 *
 * `reference` follows the same convention one step further: absent means the
 * action did not touch the structure reference, a string is the one it now
 * has, and null is "there is none any more". Three states, because two could
 * not tell "I changed nothing" apart from "I took it off".
 */
export type ActionResult =
  | {
      ok: true;
      attempts?: readonly ImageAttempt[];
      reference?: string | null;
      /** A scene's chosen pictures, as public URLs; three states as `reference`. */
      pictures?: readonly string[] | null;
    }
  | {
      ok: false;
      error: string;
      attempts?: readonly ImageAttempt[];
      /**
       * The technical reason, in whatever language it came in. The panel
       * sends it to the console; `error` is the Portuguese sentence the
       * teacher reads.
       */
      cause?: string;
    };

export type Supabase = Awaited<ReturnType<typeof requireTeacher>>["supabase"];

export const BUCKET = "vocabulary-images";
export const SCREEN = "/teacher/content/images";

/** Whatever was thrown, as a string the screen can show. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function failure(error: unknown): ActionResult {
  return { ok: false, error: errorMessage(error) };
}

/** The parent column an attempt row names its owner by (0030). */
function ownerColumn(
  owner: AttemptOwner,
): { vocabulary_item_id: string } | { scene_id: string } {
  return owner.kind === "word"
    ? { vocabulary_item_id: owner.id }
    : { scene_id: owner.id };
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

/** The public URL of a reference, which the bucket serves without signing. */
export function publicReferenceUrl(supabase: Supabase, path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * The reference as the provider wants it: raw base64, downloaded on the
 * server so the file never travels through the browser twice.
 */
async function readReference(
  supabase: Supabase,
  path: string,
): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw new Error(`Não deu para ler a referência: ${error.message}`);
  return Buffer.from(await data.arrayBuffer()).toString("base64");
}

/**
 * Mark an attempt as finished, whichever way it finished.
 *
 * completed_at is written here and nowhere else, so "when it stopped waiting"
 * has one meaning across every row: the moment it left 'pending', for an
 * image or for an error. That is the half of the measurement the old polling
 * loop never wrote down.
 */
async function finish(
  supabase: Supabase,
  attemptId: string,
  fields: {
    status: "generated" | "failed";
    error?: string;
    storage_path?: string;
    credits_spent?: number | null;
  },
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("image_attempts")
    .update({ ...fields, completed_at: new Date().toISOString() })
    .eq("id", attemptId);
  return { error: error?.message ?? null };
}

/** Close an attempt with a reason, and answer with the list it leaves behind. */
export async function recordFailure(
  supabase: Supabase,
  attemptId: string,
  owner: AttemptOwner,
  message: string,
): Promise<ActionResult> {
  const { error } = await finish(supabase, attemptId, {
    status: "failed",
    error: message,
  });
  revalidatePath(SCREEN);
  return {
    ok: false,
    error: error === null ? message : `${message} (${error})`,
    attempts: await readAttempts(supabase, owner),
  };
}

/**
 * Open a generation at the provider and come back.
 *
 * This used to be the whole generation: a POST, then a polling loop, then the
 * download and the upload, all inside one HTTP request held open for 8 to 21
 * seconds. Twice on 2026-09-19 that request was cut after the work was done
 * and paid for, and the teacher's screen never heard about a picture that was
 * sitting in the bucket.
 *
 * So the wait moved to the row. What is left here is one call to the
 * provider, which leaves a 'pending' attempt carrying the task handle. The
 * page asks about it from there, and because the waiting is in the database
 * rather than in a connection, it survives a reload, a change of word, and
 * anything on the path deciding a request has gone on long enough.
 *
 * The caller has already read the owner's row, built the prompt (which
 * refuses before anything is paid for) and decided whether the model can use
 * the owner's reference: `referencePath` is null when it cannot. The same for
 * `composedFrom`, a scene's chosen pictures (#120): null unless the model
 * composes, and never next to a reference (0033).
 */
export async function openGeneration(
  supabase: Supabase,
  owner: AttemptOwner,
  request: {
    readonly model: ImageModelId;
    readonly prompt: string;
    readonly subject: string;
    readonly referencePath: string | null;
    readonly composedFrom: readonly string[] | null;
  },
): Promise<ActionResult> {
  const { model, prompt, subject, referencePath, composedFrom } = request;
  const { data: attempt, error: insertError } = await supabase
    .from("image_attempts")
    .insert({
      ...ownerColumn(owner),
      provider: "freepik",
      model,
      prompt,
      // Stored next to the prompt it went into, because the prompt cannot
      // be taken apart again once the style constant has moved on.
      subject: subject.trim(),
      // What this attempt used, which is not the same column as what the
      // owner is set up with: that one can change afterwards, and this one
      // has to go on being true about a picture already in the bucket.
      reference_path: referencePath,
      // The same, for the pictures a scene is drawn from.
      composed_from: composedFrom === null ? null : [...composedFrom],
      status: "pending",
    })
    .select("id")
    .single();
  if (insertError) return { ok: false, error: insertError.message };

  /*
   * Read after the row exists, so a reference that cannot be read closes
   * the attempt with the reason on it rather than throwing into a caller
   * that has nowhere to put it.
   */
  let reference: string | null = null;
  if (referencePath !== null) {
    try {
      /*
       * Two forms, and the model says which. Mystic wants the bytes, so
       * the file is downloaded on the server and encoded; Kontext wants a
       * URL, and the bucket is public, so there is nothing to fetch and
       * nothing to encode — the address of the file we already stored is
       * the whole handover.
       */
      reference =
        referenceDelivery(model) === "url"
          ? publicReferenceUrl(supabase, referencePath)
          : await readReference(supabase, referencePath);
    } catch (cause) {
      return recordFailure(supabase, attempt.id, owner, errorMessage(cause));
    }
  }

  let requestId: string;
  try {
    ({ requestId } = await createFreepikProvider().generate({
      prompt,
      model,
      reference,
      // Public URLs, as Kontext's reference: nothing to download.
      pictures: (composedFrom ?? []).map((path) =>
        publicReferenceUrl(supabase, path),
      ),
    }));
  } catch (cause) {
    return recordFailure(supabase, attempt.id, owner, errorMessage(cause));
  }

  /*
   * The handle is what makes the row pollable by anyone later, so a row
   * that cannot store it is a row nobody can ever ask about. It is closed
   * here rather than left pending forever.
   *
   * The cost is written in the same breath, and it is OUR number, taken
   * from IMAGE_MODELS — the provider's response carries no credit figure at
   * all, which is why credits_spent was null on all fifty rows that existed
   * before this. Null still means "nobody knows", for a model whose price
   * has not been measured, and it is not zero.
   *
   * Here and not at the insert, because here is the first moment a charge
   * can exist: the provider has taken the task and given back a handle.
   *
   * And here is also exactly the right line, which is now measured rather
   * than assumed. On 2026-09-19 the backfill summed to 3130 against a
   * dashboard reading of 3130, to the credit, with every accepted task
   * charged — including one that ran past the 90 second window — and only
   * the request refused at the door costing nothing. So a handle is the
   * line between charged and not, and credits_spent is a statement of what
   * was spent rather than a ceiling on it.
   */
  const { error: handleError } = await supabase
    .from("image_attempts")
    .update({
      provider_request_id: requestId,
      credits_spent: modelCredits(model),
    })
    .eq("id", attempt.id);
  if (handleError) {
    return recordFailure(supabase, attempt.id, owner, handleError.message);
  }

  revalidatePath(SCREEN);
  return { ok: true, attempts: await readAttempts(supabase, owner) };
}

/**
 * Download on the server, then into the bucket. The URL never reaches the
 * browser.
 *
 * This is the one poll that is not short: a PNG from Mystic has to come down
 * and go back up before the row can be called finished. It is seconds rather
 * than the tens of seconds the old shape held open, and it happens once per
 * generation rather than on every question.
 */
export async function storeGenerated(
  supabase: Supabase,
  attemptId: string,
  owner: AttemptOwner,
  imageUrl: string,
  creditsSpent: number | undefined,
): Promise<ActionResult> {
  const response = await fetch(imageUrl, { cache: "no-store" });
  if (!response.ok) {
    return recordFailure(
      supabase,
      attemptId,
      owner,
      `Não deu para baixar a imagem: ${response.status}`,
    );
  }
  const contentType = response.headers.get("content-type");
  const bytes = await response.arrayBuffer();
  const path = attemptPath(owner, attemptId, extensionFor(contentType, "png"));

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: contentType ?? undefined });
  if (uploadError) {
    return recordFailure(supabase, attemptId, owner, uploadError.message);
  }

  const { error: doneError } = await finish(supabase, attemptId, {
    status: "generated",
    storage_path: path,
    /*
     * Only if the provider ever starts reporting one. Today it does not, and
     * the figure already on the row is ours, written when the task was
     * accepted; overwriting it with null here would erase the only record of
     * the charge. A provider figure, if one ever arrives, is the better
     * source and wins.
     */
    ...(creditsSpent === undefined ? {} : { credits_spent: creditsSpent }),
  });
  if (doneError !== null) return { ok: false, error: doneError };

  revalidatePath(SCREEN);
  return { ok: true, attempts: await readAttempts(supabase, owner) };
}

/**
 * Send a finished picture, made outside the platform, as an attempt.
 *
 * Not a reference: that one guides a generation and lives under its own
 * prefix. This is the picture itself, stored where a generated one is, and it
 * waits in the list to be approved like any other. Nothing here approves it.
 *
 * The file goes in first and the row after, as with a reference. The row is
 * written once, already 'generated' and with its path, so there is never an
 * upload row in 'pending': nothing polls an upload, and one left there by a
 * failed file would wait forever. The attempt id is made here so the path can
 * name it before the row exists.
 *
 * The caller has judged the file and the owner already, and read its bytes;
 * every sentence here is the teacher's, in Portuguese, and what Supabase said
 * goes in `cause`, for the console.
 */
export async function storeUpload(
  supabase: Supabase,
  owner: AttemptOwner,
  image: ReadImage,
  filename: string,
  subject: string | null,
): Promise<ActionResult> {
  const attemptId = crypto.randomUUID();
  const path = attemptPath(owner, attemptId, image.extension);

  // The bytes and not the File: see readImageFile.
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, image.body, { contentType: image.type });
  if (uploadError) {
    return {
      ok: false,
      error: "Não consegui guardar o arquivo. Nada foi gravado; tente de novo.",
      cause: uploadError.message,
    };
  }

  const { error: insertError } = await supabase.from("image_attempts").insert({
    id: attemptId,
    ...ownerColumn(owner),
    provider: "upload",
    status: "generated",
    storage_path: path,
    // Zero and not null: null means nobody knows what an attempt cost, and
    // an upload is known to have cost nothing. 0025 holds this with a check.
    credits_spent: 0,
    source_filename: uploadFilename(filename),
    // What the teacher says the picture was made from, when made on the
    // Freepik site. Optional, and null rather than blank when left empty.
    // 0025's upload shape leaves subject free.
    subject,
    // Stamped although an upload never waited: null on completed_at is what
    // "still running" looks like, and this row is not.
    completed_at: new Date().toISOString(),
  });
  if (insertError) {
    // A file no row names would sit in a public bucket with nothing to
    // find it by. Removing it is the best effort there is; if that fails
    // too, the error the teacher sees is still the one that matters.
    await supabase.storage.from(BUCKET).remove([path]);
    return {
      ok: false,
      error: "Não consegui registrar a tentativa. Tente de novo.",
      cause: insertError.message,
    };
  }

  revalidatePath(SCREEN);
  // The write has landed. A list that fails to come back now is not a
  // failed upload; see afterWrite.
  return await afterWrite(() => readAttempts(supabase, owner));
}

/**
 * Discard a generated attempt: the file goes, the row stays.
 *
 * The row is accounting — what it cost, which model, which prompt, which
 * reference — and deleting it would make the sum of credits_spent read low,
 * silently and always. The file is what takes up space, and the bin is the
 * teacher saying to get rid of that.
 *
 * Only a generated attempt. The screen offers the bin nowhere else, and this
 * says the same thing where it cannot be worked around. An approved one is
 * replaced by approving another, which demotes it inside one transaction and
 * moves the owner's pointer with it; discarding it here would leave the word
 * or scene naming a rejected attempt, and now also a file that no longer
 * exists. A failed one is terminal already, and reclassifying it as rejected
 * is what made the two the API refused indistinguishable from eleven pictures
 * the teacher simply disliked.
 *
 * The caller has read the row and checked it is this owner's.
 */
export async function discardAttempt(
  supabase: Supabase,
  attemptId: string,
  owner: AttemptOwner,
  attempt: { readonly status: string; readonly storage_path: string | null },
): Promise<ActionResult> {
  if (attempt.status !== "generated") {
    return {
      ok: false,
      error: "Só uma tentativa pronta pode ser descartada.",
    };
  }

  /*
   * The row is marked before the file is removed, never the other way
   * round. A rejected row whose file is still there is an orphan for a
   * cleanup to find later; a generated row whose file is already gone is a
   * broken picture on the screen, now.
   */
  const { error } = await supabase
    .from("image_attempts")
    .update({ status: "rejected", decided_at: new Date().toISOString() })
    .eq("id", attemptId);
  if (error) return { ok: false, error: error.message };

  if (attempt.storage_path !== null) {
    const { error: removeError } = await supabase.storage
      .from(BUCKET)
      .remove([attempt.storage_path]);
    /*
     * Cleared only when the file really went. A path kept next to a deleted
     * file would paint a thumbnail with nothing behind it; a path cleared
     * next to a file that survived would lose the only thing that could
     * find it again. The failure is not raised to the teacher: the attempt
     * is discarded either way, and a file left behind is a cleanup's
     * problem rather than theirs.
     */
    if (removeError === null) {
      await supabase
        .from("image_attempts")
        .update({ storage_path: null })
        .eq("id", attemptId);
    }
  }

  revalidatePath(SCREEN);
  return { ok: true, attempts: await readAttempts(supabase, owner) };
}

/**
 * Copy approved pictures under the owner's references, in order, and answer
 * with the new paths for the caller to write on its row (#120).
 *
 * Copied, not pointed at: an approved picture can be replaced, and an attempt
 * has to go on saying what it was drawn from; see storeReference for why a
 * reference is never deleted. The copy stays inside the bucket, so no byte
 * goes through the server. A copy that fails removes the ones made before it,
 * so nothing is left that no row names.
 */
export async function storePictures(
  supabase: Supabase,
  owner: AttemptOwner,
  sources: readonly string[],
): Promise<{ ok: true; paths: string[] } | { ok: false; error: string }> {
  const paths: string[] = [];
  for (const source of sources) {
    const extension = /\.([a-z0-9]+)$/iu.exec(source)?.[1] ?? "jpg";
    const path = referencePath(owner, crypto.randomUUID(), extension);
    const { error } = await supabase.storage.from(BUCKET).copy(source, path);
    if (error) {
      if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
      return { ok: false, error: error.message };
    }
    paths.push(path);
  }
  return { ok: true, paths };
}

/**
 * Put a structure reference in the bucket and answer with its path, for the
 * caller to write on its own row.
 *
 * The old file is not deleted when a new one replaces it. Attempts made under
 * it still name it in their own reference_path, and that is the whole reason
 * the attempt has a column of its own: deleting the file would leave those
 * rows pointing at nothing and the record would stop being able to say what
 * produced a picture. Cleaning the bucket is a job that has to read both
 * columns, and it is not this one.
 */
export async function storeReference(
  supabase: Supabase,
  owner: AttemptOwner,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (file.size === 0) return { ok: false, error: "O arquivo está vazio." };
  // The browser has already shrunk it. This is the net under that, and it
  // has to be ours: Next refuses a bigger body with a 413 that reaches the
  // panel as a lost connection.
  if (file.size > MAX_REFERENCE_BYTES) {
    return { ok: false, error: REFERENCE_TOO_BIG };
  }

  // The type and the extension from the bytes, and the bytes as the body:
  // given the File, storage-js drops contentType and the bucket would serve
  // whatever the browser declared. See readImageFile.
  const image = await readImageFile(file);
  if (image === null) {
    return {
      ok: false,
      error: "Não consegui ler esse arquivo como PNG, JPEG ou WebP.",
    };
  }
  const path = referencePath(owner, crypto.randomUUID(), image.extension);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, image.body, { contentType: image.type });
  if (uploadError) return { ok: false, error: uploadError.message };
  return { ok: true, path };
}
