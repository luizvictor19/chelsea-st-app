"use server";

import { revalidatePath } from "next/cache";

import {
  readWordAttempts,
  requireTeacher,
  type ImageAttempt,
} from "@/lib/content/queries";
import { compareWords } from "@/lib/content/word-order";
import { createFreepikProvider } from "@/lib/images/freepik";
import {
  GENERATION_WINDOW_MS,
  MAX_REFERENCE_BYTES,
  REFERENCE_TOO_BIG,
  hasExpired,
} from "@/lib/images/generation";
import {
  isImageModelId,
  modelCredits,
  referenceDelivery,
  takesReference,
} from "@/lib/images/provider";
import {
  buildContrastPrompt,
  contrastCandidates,
  inBookOrder,
  parseContrastSuggestions,
} from "@/lib/images/contrast-suggest";
import { buildPrompt } from "@/lib/images/style";
import {
  SNIFF_BYTES,
  refuseUpload,
  sniffImageType,
  uploadExtension,
} from "@/lib/images/upload";
import { withHeartbeat, type Heartbeat } from "@/lib/heartbeat";
import { buildSubjectPrompt, parseSubject } from "@/lib/images/subject";
import {
  buildSuggestionPrompt,
  parseSuggestions,
  suggestionBatch,
} from "@/lib/images/suggest";
import { createDeepSeekProvider } from "@/lib/text/deepseek";
import type { Database } from "@/lib/supabase/types";

import { contrastError } from "./contrast-sets";

type Representation = Database["public"]["Enums"]["representation_kind"];

/**
 * What an action answers with.
 *
 * `attempts` is the list of the word as the action left it, and it is there
 * because the call returning is the only proof the panel has that anything at
 * all reached the browser. The re-render that `revalidatePath` triggers
 * travels in the same response, but nothing proves that half of it landed: on
 * 19/09/2026 it twice did not, after a generation that had taken 8s and 21s.
 *
 * Only the actions that rewrite the list say so. Absent means "I changed
 * nothing there", and the panel keeps what it has. A poll that finds the
 * generation still running says nothing, which is also what makes it cheap.
 *
 * A failure can carry a list too: a generation the provider refused leaves a
 * 'failed' row, and the teacher should see the row as well as the reason.
 *
 * `reference` follows the same convention one step further: absent means the
 * action did not touch the word's structure reference, a string is the one it
 * now has, and null is "there is none any more". Three states, because two
 * could not tell "I changed nothing" apart from "I took it off".
 */
export type ActionResult =
  | {
      ok: true;
      attempts?: readonly ImageAttempt[];
      reference?: string | null;
    }
  | { ok: false; error: string; attempts?: readonly ImageAttempt[] };

const BUCKET = "vocabulary-images";
const SCREEN = "/teacher/content/images";

/**
 * Where a structure reference lives, apart from the finished pictures.
 *
 * Migration 0014 holds this from three sides with checks, because a path in
 * the wrong prefix would still read back, still resolve to a public URL and
 * still look right: the only one to notice would be whoever comes to clean
 * the bucket up, and everything under this prefix is meant to be a
 * discardable input.
 */
const REFERENCE_PREFIX = "references";

/** Whatever was thrown, as a string the screen can show. */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function failure(error: unknown): ActionResult {
  return { ok: false, error: errorMessage(error) };
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

export async function setRepresentation(
  wordId: string,
  kind: Representation,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const { error } = await supabase.rpc("clear_word_representation", {
      p_word: wordId,
      p_kind: kind,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath(SCREEN);
    return { ok: true };
  } catch (cause) {
    return failure(cause);
  }
}

export async function approveAttempt(attemptId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const { error } = await supabase.rpc("approve_image_attempt", {
      p_attempt: attemptId,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath(SCREEN);
    return { ok: true };
  } catch (cause) {
    return failure(cause);
  }
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
 * moves the word's pointer with it; discarding it here would leave
 * vocabulary_items naming a rejected attempt, and now also a file that no
 * longer exists. A failed one is terminal already, and reclassifying it as
 * rejected is what made the two the API refused indistinguishable from
 * eleven pictures the teacher simply disliked.
 */
export async function rejectAttempt(attemptId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();

    const { data: attempt, error: readError } = await supabase
      .from("image_attempts")
      .select("vocabulary_item_id, status, storage_path")
      .eq("id", attemptId)
      .single();
    if (readError) return { ok: false, error: readError.message };

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
    return {
      ok: true,
      attempts: await readWordAttempts(supabase, attempt.vocabulary_item_id),
    };
  } catch (cause) {
    return failure(cause);
  }
}

/**
 * Attach a structure reference to a word, or replace the one it has.
 *
 * The file is kept and the column points at it, so the teacher uploads once
 * and generates several times, changing the instruction between tries,
 * without the reference going anywhere on a reload or on a trip to another
 * word.
 *
 * The old file is not deleted when a new one replaces it. Attempts made under
 * it still name it in their own reference_path, and that is the whole reason
 * the attempt has a column of its own: deleting the file would leave those
 * rows pointing at nothing and the record would stop being able to say what
 * produced a picture. Cleaning the bucket is a job that has to read both
 * columns, and it is not this one.
 */
export async function setReference(
  wordId: string,
  file: File,
): Promise<ActionResult> {
  try {
    if (file.size === 0) return { ok: false, error: "O arquivo está vazio." };
    // The browser has already shrunk it. This is the net under that, and it
    // has to be ours: Next refuses a bigger body with a 413 that reaches the
    // panel as a lost connection.
    if (file.size > MAX_REFERENCE_BYTES) {
      return { ok: false, error: REFERENCE_TOO_BIG };
    }
    const { supabase } = await requireTeacher();

    const extension = extensionFor(
      file.type,
      file.name.split(".").pop() ?? "jpg",
    );
    const path = `${REFERENCE_PREFIX}/${wordId}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) return { ok: false, error: uploadError.message };

    // After the file is in the bucket, never before: a column pointing at a
    // file that is not there yet is a generation that fails for a reason the
    // teacher cannot see.
    const { error } = await supabase
      .from("vocabulary_items")
      .update({ reference_path: path })
      .eq("id", wordId);
    if (error) return { ok: false, error: error.message };

    revalidatePath(SCREEN);
    return { ok: true, reference: publicReferenceUrl(supabase, path) };
  } catch (cause) {
    return failure(cause);
  }
}

/**
 * Send a finished picture, made outside the platform, as an attempt of the
 * word.
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
 */
export async function uploadFinishedImage(
  wordId: string,
  file: File,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();

    // The kind from the row, as startGeneration reads it: the screen could be
    // a refresh behind the teacher's last decision.
    const { data: word, error: wordError } = await supabase
      .from("vocabulary_items")
      .select("representation")
      .eq("id", wordId)
      .single();
    if (wordError) return { ok: false, error: wordError.message };

    // The panel asked this already. Asked again here because the panel is not
    // the only way to reach an action.
    const refusal = refuseUpload({
      size: file.size,
      type: file.type,
      kind: word.representation,
    });
    if (refusal !== null) return { ok: false, error: refusal };

    // The bytes, not the name, say what the file is. It is stored under the
    // type they give, which is what the student's browser will decode.
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    const type = sniffImageType(head);
    if (type === null) {
      return {
        ok: false,
        error: "Não consegui ler esse arquivo como PNG, JPEG ou WebP.",
      };
    }

    const attemptId = crypto.randomUUID();
    const path = `${wordId}/${attemptId}.${uploadExtension(type)}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: type });
    if (uploadError) return { ok: false, error: uploadError.message };

    const { error: insertError } = await supabase
      .from("image_attempts")
      .insert({
        id: attemptId,
        vocabulary_item_id: wordId,
        provider: "upload",
        status: "generated",
        storage_path: path,
        // Zero and not null: null means nobody knows what an attempt cost, and
        // an upload is known to have cost nothing. 0025 holds this with a check.
        credits_spent: 0,
        source_filename: file.name === "" ? null : file.name,
        // Stamped although an upload never waited: null on completed_at is what
        // "still running" looks like, and this row is not.
        completed_at: new Date().toISOString(),
      });
    if (insertError) {
      // A file no row names would sit in a public bucket with nothing to
      // find it by. Removing it is the best effort there is; if that fails
      // too, the error the teacher sees is still the one that matters.
      await supabase.storage.from(BUCKET).remove([path]);
      return { ok: false, error: insertError.message };
    }

    revalidatePath(SCREEN);
    return { ok: true, attempts: await readWordAttempts(supabase, wordId) };
  } catch (cause) {
    return failure(cause);
  }
}

/**
 * Take the reference off a word.
 *
 * The column only, never the file. Every attempt generated from it still
 * names it, and those rows have to go on meaning something.
 */
export async function clearReference(wordId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const { error } = await supabase
      .from("vocabulary_items")
      .update({ reference_path: null })
      .eq("id", wordId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(SCREEN);
    return { ok: true, reference: null };
  } catch (cause) {
    return failure(cause);
  }
}

/** The public URL of a reference, which the bucket serves without signing. */
function publicReferenceUrl(
  supabase: Awaited<ReturnType<typeof requireTeacher>>["supabase"],
  path: string,
): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * The reference as the provider wants it: raw base64, downloaded on the
 * server so the file never travels through the browser twice.
 */
async function readReference(
  supabase: Awaited<ReturnType<typeof requireTeacher>>["supabase"],
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
  supabase: Awaited<ReturnType<typeof requireTeacher>>["supabase"],
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
async function recordFailure(
  supabase: Awaited<ReturnType<typeof requireTeacher>>["supabase"],
  attemptId: string,
  wordId: string,
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
    attempts: await readWordAttempts(supabase, wordId),
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
 * panel asks about it from there, and because the waiting is in the database
 * rather than in a connection, it survives a reload, a change of word, and
 * anything on the path deciding a request has gone on long enough.
 */
export async function startGeneration(
  wordId: string,
  subject: string,
  model: string,
): Promise<ActionResult> {
  try {
    if (!isImageModelId(model)) {
      return { ok: false, error: `Modelo desconhecido: ${model}` };
    }
    const { supabase } = await requireTeacher();

    /*
     * What the picture has to show depends on the kind, so the kind has to be
     * decided before anything is generated. Reading it here rather than
     * taking it from the caller keeps the decision the database holds as the
     * one that is used: the screen could be a refresh behind.
     */
    const { data: word, error: wordError } = await supabase
      .from("vocabulary_items")
      .select("representation, reference_path, image_style")
      .eq("id", wordId)
      .single();
    if (wordError) return { ok: false, error: wordError.message };
    if (word.representation === null) {
      return {
        ok: false,
        error: "Escolha o tipo da palavra antes de gerar a imagem.",
      };
    }

    /*
     * The style comes from the row for the same reason the kind does: it is a
     * decision the teacher saved, and the screen could be a refresh behind.
     * The column is not null with a default of 'flat', so there is no absent
     * case to invent a style for.
     */
    // Before anything is inserted or paid for: an empty subject and a kind
    // that has no picture both throw here.
    const prompt = buildPrompt(subject, word.representation, word.image_style);

    /*
     * The word's reference is only this attempt's reference if the model can
     * take one. A word keeps its reference while the teacher generates on a
     * model that ignores it, and the row then records that it used none,
     * because it used none. Writing the path anyway would make the record say
     * a picture came from a file the model never saw.
     */
    const referencePath = takesReference(model) ? word.reference_path : null;

    const { data: attempt, error: insertError } = await supabase
      .from("image_attempts")
      .insert({
        vocabulary_item_id: wordId,
        provider: "freepik",
        model,
        prompt,
        // Stored next to the prompt it went into, because the prompt cannot
        // be taken apart again once the style constant has moved on.
        subject: subject.trim(),
        // What this attempt used, which is not the same column as what the
        // word is set up with: that one can change afterwards, and this one
        // has to go on being true about a picture already in the bucket.
        reference_path: referencePath,
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
        return recordFailure(supabase, attempt.id, wordId, errorMessage(cause));
      }
    }

    let requestId: string;
    try {
      ({ requestId } = await createFreepikProvider().generate({
        prompt,
        model,
        reference,
      }));
    } catch (cause) {
      return recordFailure(supabase, attempt.id, wordId, errorMessage(cause));
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
      return recordFailure(supabase, attempt.id, wordId, handleError.message);
    }

    revalidatePath(SCREEN);
    return { ok: true, attempts: await readWordAttempts(supabase, wordId) };
  } catch (cause) {
    return failure(cause);
  }
}

/**
 * Ask the provider once about one attempt, and write down what it said.
 *
 * One question, never a loop: this is the call the panel repeats every couple
 * of seconds, and the whole point of the shape is that no single call is long
 * enough for anything on the path to object to it.
 *
 * A generation still running answers with nothing at all — no list, no
 * revalidatePath. The screen already knows the row is running and counts the
 * seconds off created_at by itself, so the common answer costs one provider
 * GET and no page render.
 */
export async function pollAttempt(attemptId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();

    const { data: attempt, error: readError } = await supabase
      .from("image_attempts")
      .select(
        "vocabulary_item_id, provider, status, provider_request_id, created_at",
      )
      .eq("id", attemptId)
      .single();
    if (readError) return { ok: false, error: readError.message };

    const wordId = attempt.vocabulary_item_id;

    /*
     * Already finished, by an earlier poll or in another tab. Answering with
     * the list rather than with an error is the right thing: the caller asked
     * how it went, and it went.
     */
    if (attempt.provider !== "freepik" || attempt.status !== "pending") {
      return { ok: true, attempts: await readWordAttempts(supabase, wordId) };
    }

    if (attempt.provider_request_id === null) {
      return recordFailure(
        supabase,
        attemptId,
        wordId,
        "A geração não chegou a ser aberta no fornecedor.",
      );
    }

    let poll;
    try {
      poll = await createFreepikProvider().poll(attempt.provider_request_id);
    } catch (cause) {
      return recordFailure(supabase, attemptId, wordId, errorMessage(cause));
    }

    if (poll.status === "failed") {
      return recordFailure(
        supabase,
        attemptId,
        wordId,
        poll.error ?? "A geração falhou sem dizer por quê.",
      );
    }

    if (poll.status === "pending") {
      if (hasExpired(attempt.created_at, Date.now())) {
        return recordFailure(
          supabase,
          attemptId,
          wordId,
          `A geração passou de ${GENERATION_WINDOW_MS / 1000} segundos sem responder.`,
        );
      }
      // Nothing changed, so nothing is said and nothing is re-rendered.
      return { ok: true };
    }

    if (poll.imageUrl === undefined) {
      return recordFailure(
        supabase,
        attemptId,
        wordId,
        "A geração terminou sem imagem.",
      );
    }

    /*
     * Stored even if the window has passed. The window bounds how long we
     * wait for an answer, not how long an answer stays worth having: the
     * image was paid for, and throwing it away because a clock ran out would
     * be the one mistake here that costs money.
     */
    return storeGenerated(
      supabase,
      attemptId,
      wordId,
      poll.imageUrl,
      poll.creditsSpent,
    );
  } catch (cause) {
    return failure(cause);
  }
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
async function storeGenerated(
  supabase: Awaited<ReturnType<typeof requireTeacher>>["supabase"],
  attemptId: string,
  wordId: string,
  imageUrl: string,
  creditsSpent: number | undefined,
): Promise<ActionResult> {
  const response = await fetch(imageUrl, { cache: "no-store" });
  if (!response.ok) {
    return recordFailure(
      supabase,
      attemptId,
      wordId,
      `Não deu para baixar a imagem: ${response.status}`,
    );
  }
  const contentType = response.headers.get("content-type");
  const bytes = await response.arrayBuffer();
  const path = `${wordId}/${attemptId}.${extensionFor(contentType, "png")}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: contentType ?? undefined });
  if (uploadError) {
    return recordFailure(supabase, attemptId, wordId, uploadError.message);
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
  return { ok: true, attempts: await readWordAttempts(supabase, wordId) };
}

/**
 * A lesson's words, in the order the screen shows them.
 *
 * One function and two callers, which is the point of it rather than tidiness.
 * The suggestion pass slices this list into batches, and the witness below has
 * to slice it exactly the same way to be able to say whether a batch was
 * written: two sorts written separately would agree until the day they did
 * not, and the day they did not the witness would answer about the wrong ten
 * words.
 *
 * Sorted the way the screen sorts, with the shared comparator, and then
 * sliced. Two reasons it is not by id. Paging needs a total order or a batch
 * can skip one word and send another twice — but a uuid order would also cut
 * the lesson into stretches that match nothing the teacher can see, and when a
 * batch fails for good they need to be able to say which words were left out.
 * In this order, "the third batch" is a region of the list in front of them.
 *
 * Re-read and re-sorted per call rather than paged in the database, for the
 * reason listVocabularyImages already gives about nested ordering in
 * PostgREST, and because sixty rows cost nothing.
 */
async function lessonWords(
  supabase: Awaited<ReturnType<typeof requireTeacher>>["supabase"],
  lessonContentId: string,
): Promise<
  | {
      ok: true;
      words: readonly {
        id: string;
        term: string;
        suggestionRunId: string | null;
      }[];
    }
  | { ok: false; error: string }
> {
  const { data: rows, error } = await supabase
    .from("vocabulary_items")
    .select(
      "id, term, suggestion_run_id, points!inner(number, lesson_content_id)",
    )
    .eq("points.lesson_content_id", lessonContentId);
  if (error) return { ok: false, error: error.message };

  const words = (rows ?? [])
    .map((row) => ({
      id: row.id,
      term: row.term,
      suggestionRunId: row.suggestion_run_id,
      pointNumber: row.points?.number ?? null,
    }))
    .sort((a, b) =>
      compareWords(
        { lessonNumber: null, pointNumber: a.pointNumber, term: a.term },
        { lessonNumber: null, pointNumber: b.pointNumber, term: b.term },
      ),
    );
  return { ok: true, words };
}

export type SuggestResult =
  | {
      ok: true;
      /** Written in this batch. */
      suggested: number;
      /** Answers this batch dropped as unreadable. */
      rejected: number;
      /** Words this batch covered, whether or not the model answered them. */
      words: number;
      /** The whole lesson, so the caller knows how far it has to go. */
      total: number;
      /** Whether this batch reached the end of the lesson. */
      done: boolean;
    }
  | { ok: false; error: string };

/**
 * Ask the model what kind of picture one BATCH of a lesson's words needs.
 *
 * Every word of the lesson still goes, including the ones already decided: a
 * decided lesson is the answer key, so sending all of it turns each decided
 * lesson into a regression set for the prompt, and asking only about
 * undecided words meant a lesson produced a measurement once and never again.
 * What changed on 2026-09-19 is that it no longer goes in one call.
 *
 * WHY IT IS CUT UP. Sixty words in one request took 43 seconds, came back
 * 200, and reached a browser that had already given up — the teacher saw the
 * message written for a lost connection over a suggestion that was safely in
 * the database. That is the development half of it. The production half is
 * worse and quieter: a Vercel function has a duration limit, and a call that
 * long is cut by the runtime rather than by anybody's patience.
 *
 * Batching does not make the request short; nothing here can. The time is the
 * model's variance and not the word count, and a single-word request has been
 * seen at 27 seconds. What it makes small is the unit of work: losing one
 * costs ten words and a repeat, where losing the old one cost the lesson.
 *
 * Writes suggested_representation and word_class, and never representation.
 * The class has one column because it is a fact rather than a judgement; the
 * separation of the other two is the whole point of having two columns: a
 * suggestion the teacher never looked at must not be able to pass itself off
 * as a decision, and the distance between the two columns is how the model
 * gets marked. Overwriting an older suggestion is the point of re-running it;
 * overwriting a decision would not be a re-run, it would be the model grading
 * itself.
 */
export async function suggestRepresentations(
  lessonContentId: string,
  offset = 0,
  runId: string | null = null,
): Promise<SuggestResult> {
  const started = performance.now();
  const marks = {
    authMs: 0,
    readMs: 0,
    modelMs: 0,
    writeMs: 0,
    words: 0,
    writes: 0,
    rejected: 0,
    total: 0,
    model: null as string | null,
    /*
     * Where the batch stopped, and it is set last on purpose: every early
     * return sets its own, and anything that escapes them all was thrown.
     */
    outcome: "threw",
  };

  try {
    const beforeAuth = performance.now();
    const { supabase } = await requireTeacher();
    marks.authMs = Math.round(performance.now() - beforeAuth);

    const beforeRead = performance.now();
    const lesson = await lessonWords(supabase, lessonContentId);
    if (!lesson.ok) {
      marks.readMs = Math.round(performance.now() - beforeRead);
      marks.outcome = "read_failed";
      return { ok: false, error: lesson.error };
    }
    const all = lesson.words;
    marks.readMs = Math.round(performance.now() - beforeRead);

    const total = all.length;
    const words = suggestionBatch(all, offset);
    marks.total = total;
    marks.words = words.length;
    // An empty lesson is not a failure, and it is not worth a request. Nor is
    // an offset past the end, which is how a caller asks "is there more".
    if (words.length === 0) {
      marks.outcome = "empty";
      return {
        ok: true,
        suggested: 0,
        rejected: 0,
        words: 0,
        total,
        done: true,
      };
    }

    const { system, user } = buildSuggestionPrompt(words);
    const beforeModel = performance.now();
    const { text, model } = await createDeepSeekProvider().complete({
      system,
      user,
      json: true,
    });
    marks.modelMs = Math.round(performance.now() - beforeModel);
    marks.model = model;

    const { suggestions, rejected } = parseSuggestions(
      text,
      words.map((word) => word.id),
    );
    marks.rejected = rejected;

    /*
     * One round trip per word, and the loop is timed as a whole because that
     * is the shape of the question: ten sequential updates either are or are
     * not a meaningful part of the wall clock, and writeMs divided by writes
     * answers it without a timer inside the loop.
     */
    const beforeWrite = performance.now();
    for (const suggestion of suggestions) {
      const { error } = await supabase
        .from("vocabulary_items")
        .update({
          suggested_representation: suggestion.kind,
          // The class goes in the one column it has. A null here is the model
          // failing to name a class this run, not a decision to clear one, so
          // an earlier class is left alone.
          ...(suggestion.wordClass === null
            ? {}
            : { word_class: suggestion.wordClass }),
          /*
           * Stamped in the same update as the suggestion, so that a word
           * carrying this run's id and a word this run wrote are the same
           * word. Written even when the run id is null, which is a caller
           * that predates the witness rather than a word to leave marked
           * with somebody else's run.
           */
          suggestion_run_id: runId,
        })
        .eq("id", suggestion.id);
      if (error) {
        marks.writeMs = Math.round(performance.now() - beforeWrite);
        marks.outcome = "write_failed";
        return { ok: false, error: error.message };
      }
      marks.writes += 1;
    }
    marks.writeMs = Math.round(performance.now() - beforeWrite);
    marks.outcome = "ok";

    /*
     * Every batch and not only the last. A run that stops halfway — because a
     * batch failed twice — would otherwise never revalidate, and the
     * "N/M com sugestão" count beside the lesson would go on showing the
     * number from before the run: a count that is wrong precisely when
     * something went wrong. Six re-renders of this page over a minute is the
     * cheaper half of that trade, and it makes the count climb as it goes.
     */
    revalidatePath(SCREEN);
    return {
      ok: true,
      suggested: suggestions.length,
      rejected,
      words: words.length,
      total,
      done: offset + words.length >= total,
    };
  } catch (cause) {
    return { ok: false, error: errorMessage(cause) };
  } finally {
    /*
     * One line per batch, whatever happened to it, and in a finally so that
     * no return path can leave without one. The batch that matters most is
     * the one that took 28 seconds and reached a browser that had already
     * given up: the server answered 200, so from the outside it is a success
     * with no duration attached to anything.
     *
     * JSON on one line rather than console.time, because console.time writes
     * a sentence to a terminal that does not exist in production. This
     * survives into the Vercel function log, where it can be grepped by the
     * event name and summed.
     *
     * The phases, and not just the total. Twenty-eight seconds is a different
     * problem depending on whether it was the model, the ten sequential
     * updates or the auth round trip, and the residual — totalMs minus the
     * four — is the runtime's own, which is worth seeing rather than
     * assuming.
     */
    console.log(
      JSON.stringify({
        event: "suggest_batch",
        lessonContentId,
        offset,
        ...marks,
        totalMs: Math.round(performance.now() - started),
      }),
    );
  }
}

export type RunCountResult =
  | {
      ok: true;
      /** Words of this exact batch already carrying this run's id. */
      stampedInBatch: number;
      /** Words the batch covers, so the caller can tell part from whole. */
      batchWords: number;
      total: number;
    }
  | { ok: false; error: string };

/**
 * Whether a batch was written, asked of the batch itself.
 *
 * The witness. One caller: the button, after a batch whose answer never came
 * back, deciding whether to move on or ask the model again. The action writes
 * its rows before it returns, so a lost answer says nothing about the words —
 * and until suggestion_run_id there was no way to find out, because a word
 * skipped in a lesson that already had suggestions looks exactly like a word
 * written, the old value sitting in the column either way.
 *
 * It answers about the batch and not about a running total, which is the
 * difference between a question with one answer and a question whose answer
 * depends on the asker's bookkeeping being right. A client counting writes as
 * it goes drifts from the database the moment a batch runs twice: the two
 * attempts can write different ids, the database keeps the union, and the
 * client's sum is short. Then the next lost batch reads as progress and ten
 * words are skipped in silence.
 *
 * It slices the lesson with the same function the write path uses, over the
 * same list from the same reader, so the ten words it counts are the ten words
 * that were sent.
 *
 * Reads and nothing else: no write, no revalidate. It runs at the worst
 * possible moment, right after a request has died, on a fresh request of its
 * own.
 */
export async function countSuggestionRun(
  lessonContentId: string,
  runId: string,
  offset: number,
): Promise<RunCountResult> {
  try {
    const { supabase } = await requireTeacher();
    const lesson = await lessonWords(supabase, lessonContentId);
    if (!lesson.ok) return { ok: false, error: lesson.error };

    const batch = suggestionBatch(lesson.words, offset);
    return {
      ok: true,
      stampedInBatch: batch.filter((word) => word.suggestionRunId === runId)
        .length,
      batchWords: batch.length,
      total: lesson.words.length,
    };
  } catch (cause) {
    return { ok: false, error: errorMessage(cause) };
  }
}

export type SubjectResult =
  { ok: true; subject: string } | { ok: false; error: string };

/**
 * Propose the subject line for one word.
 *
 * Writes nothing, anywhere. What comes back fills the field and the teacher
 * edits it before generating: the subject is the half of the prompt that is
 * theirs, so a model may draft it and never commit it. That is also why this
 * returns the phrase rather than saving it and letting the screen reread it.
 */
export async function suggestSubject(wordId: string): Promise<SubjectResult> {
  try {
    const { supabase } = await requireTeacher();

    const { data: word, error: readError } = await supabase
      .from("vocabulary_items")
      .select("term, representation, image_style")
      .eq("id", wordId)
      .single();
    if (readError) return { ok: false, error: readError.message };

    if (word.representation === null) {
      return {
        ok: false,
        error: "Escolha o tipo da palavra antes de pedir uma instrução.",
      };
    }

    /*
     * The style goes with it, because two of the three rules the proposal
     * carries are the same whatever the picture is made of and one is not:
     * what makes a thing recognisable is its outline in a flat vector and its
     * material, its scale and its context in a photograph. See RECOGNITION.
     */
    // Throws for a kind that has no picture, which the screen already hides
    // the button for; this is the same refusal one layer down.
    const { system, user } = buildSubjectPrompt(
      word.term,
      word.representation,
      word.image_style,
    );

    const { text } = await createDeepSeekProvider().complete({
      system,
      user,
      json: true,
    });

    const subject = parseSubject(text);
    if (subject === null) {
      return {
        ok: false,
        error: "O modelo não devolveu uma instrução legível.",
      };
    }
    return { ok: true, subject };
  } catch (cause) {
    return { ok: false, error: errorMessage(cause) };
  }
}

/** The teacher correcting the class the model gave. One column, so one write. */
export async function setWordClass(
  wordId: string,
  wordClass: Database["public"]["Enums"]["word_class"] | null,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const { error } = await supabase
      .from("vocabulary_items")
      .update({ word_class: wordClass })
      .eq("id", wordId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(SCREEN);
    return { ok: true };
  } catch (cause) {
    return failure(cause);
  }
}

/**
 * The teacher choosing which set of style constants this word is drawn in.
 *
 * One column, so one write, like the class above. It changes nothing that
 * already exists: the pictures in the bucket were generated under the style
 * the prompt of their attempt records, and that row goes on being true about
 * them. What this decides is the next generation.
 */
export async function setImageStyle(
  wordId: string,
  style: Database["public"]["Enums"]["image_style"],
): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const { error } = await supabase
      .from("vocabulary_items")
      .update({ image_style: style })
      .eq("id", wordId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(SCREEN);
    return { ok: true };
  } catch (cause) {
    return failure(cause);
  }
}

/**
 * Saves a contrast set whole: its members, in order of presentation. A null
 * set id creates one. One call, because save_contrast_set replaces the
 * members and renumbers them in a single transaction, and the database
 * refuses fewer than two or a word already in another set on its own.
 *
 * `expected` is the membership the screen loaded. The database saves an
 * existing set only while it still has exactly those members, so a draft
 * made from an old view cannot undo a save made elsewhere in between.
 */
export async function saveContrastSet(
  items: readonly string[],
  set: { readonly id: string; readonly expected: readonly string[] } | null,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const { error } = await supabase.rpc("save_contrast_set", {
      p_items: [...items],
      ...(set === null
        ? {}
        : { p_set_id: set.id, p_expected: [...set.expected] }),
    });
    if (error) {
      return { ok: false, error: contrastError(error.message, error.code) };
    }
    revalidatePath(SCREEN);
    return { ok: true };
  } catch (cause) {
    return failure(cause);
  }
}

/** Dissolves a contrast set. The words and their pictures stay as they are. */
export async function dissolveContrastSet(
  setId: string,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const { error } = await supabase.rpc("dissolve_contrast_set", {
      p_set_id: setId,
    });
    if (error) {
      return { ok: false, error: contrastError(error.message, error.code) };
    }
    revalidatePath(SCREEN);
    return { ok: true };
  } catch (cause) {
    return failure(cause);
  }
}

/** A proposed contrast set, as the screen shows it. Stored nowhere. */
export type ContrastProposal = {
  /** In book order, not the model's: see inBookOrder. */
  readonly members: readonly {
    readonly id: string;
    readonly term: string;
    readonly point: number | null;
  }[];
  readonly reason: string;
};

export type ContrastSuggestResult =
  | {
      ok: true;
      /** Words sent to the model: with a picture and in no set. */
      sent: number;
      proposals: readonly ContrastProposal[];
      /** Members the parser dropped, for the console and the note. */
      dropped: number;
    }
  | { ok: false; error: string };

/**
 * Asks the model which of a lesson's words form contrast sets.
 *
 * Writes nothing. A proposal becomes a set only when the teacher accepts it,
 * through saveContrastSet, which is what keeps sets declared by her and never
 * by the model. That is also what makes a lost answer safe to ask again.
 *
 * One call for the whole lesson, the way it was measured on 2026-09-22
 * (scripts/measure-contrast-suggestions.ts): 30.8s median and 58.0s worst on
 * lesson 1. Only the lesson's words with a picture that are in no set yet are
 * sent, read here and not taken from the caller, so a set saved in another
 * tab since the page loaded is not proposed again. Fewer than two is not a
 * failure and not worth a request.
 */
async function proposeContrastSets(
  lessonContentId: string,
): Promise<ContrastSuggestResult> {
  const started = performance.now();
  const marks = {
    sent: 0,
    proposals: 0,
    dropped: 0,
    unreadable: false,
    modelMs: 0,
    outcome: "threw",
  };
  try {
    const { supabase } = await requireTeacher();
    const { data: rows, error } = await supabase
      .from("vocabulary_items")
      .select(
        "id, term, representation, word_class, points!inner(number, lesson_content_id, lessons_content(number))",
      )
      .eq("points.lesson_content_id", lessonContentId);
    if (error) {
      marks.outcome = "read_failed";
      return { ok: false, error: error.message };
    }

    const words = (rows ?? []).map((row) => ({
      id: row.id,
      term: row.term,
      point: row.points?.number ?? null,
      kind: row.representation,
      wordClass: row.word_class,
    }));
    /*
     * Membership read from contrast_set_items itself, the way the page reads
     * it, and not embedded in the word: an embed that came back as a list
     * where an object was expected would be non-null for every word, mark
     * the whole lesson as taken and answer "nothing to suggest" in silence.
     */
    const taken = await supabase
      .from("contrast_set_items")
      .select("vocabulary_item_id")
      .in(
        "vocabulary_item_id",
        words.map((word) => word.id),
      );
    if (taken.error) {
      marks.outcome = "read_failed";
      return { ok: false, error: taken.error.message };
    }
    const inASet = new Set(taken.data.map((row) => row.vocabulary_item_id));
    const sent = contrastCandidates(words, inASet);
    marks.sent = sent.length;
    if (sent.length < 2) {
      marks.outcome = "nothing_to_send";
      return { ok: true, sent: sent.length, proposals: [], dropped: 0 };
    }

    // Read with the words rather than asked for again: every row of the
    // lesson carries the same number.
    const lessonNumber = rows?.[0]?.points?.lessons_content?.number ?? null;
    if (lessonNumber === null) {
      marks.outcome = "read_failed";
      return { ok: false, error: "A lição não foi encontrada." };
    }

    const { system, user } = buildContrastPrompt(
      { lesson: lessonNumber, point: null, words: sent },
      "lesson",
    );
    const beforeModel = performance.now();
    const { text } = await createDeepSeekProvider().complete({
      system,
      user,
      json: true,
    });
    marks.modelMs = Math.round(performance.now() - beforeModel);

    const parsed = parseContrastSuggestions(text, sent);
    marks.unreadable = parsed.unreadable;
    marks.dropped = parsed.unknown + parsed.repeated;
    if (parsed.unreadable) {
      marks.outcome = "unreadable";
      return {
        ok: false,
        error: "O modelo não devolveu uma resposta legível. Tente de novo.",
      };
    }

    const byId = new Map(sent.map((word) => [word.id, word]));
    const proposals = parsed.sets.map((set) => ({
      members: inBookOrder(set.members, sent).map((id) => {
        const word = byId.get(id);
        // Every kept member is a sent id; the fallback is for the type only.
        return {
          id,
          term: word?.term ?? id,
          point: word?.point ?? null,
        };
      }),
      reason: set.reason,
    }));
    marks.proposals = proposals.length;
    marks.outcome = "ok";
    return {
      ok: true,
      sent: sent.length,
      proposals,
      dropped: marks.dropped,
    };
  } catch (cause) {
    return { ok: false, error: errorMessage(cause) };
  } finally {
    // One line per call, as suggest_batch does, for the function log.
    console.log(
      JSON.stringify({
        event: "suggest_contrast",
        lessonContentId,
        ...marks,
        totalMs: Math.round(performance.now() - started),
      }),
    );
  }
}

/*
 * A beat every 5s. The drops measured on 2026-09-23 came as early as 8237ms
 * (see src/lib/heartbeat.ts), and 10s between beats was enough in that test
 * only because no drop landed inside a gap; 5s leaves no gap that long.
 */
const CONTRAST_BEAT_MS = 5000;

/**
 * The same proposal, streamed with a heartbeat so the connection is never
 * quiet for more than CONTRAST_BEAT_MS while the model thinks: 30.8s median
 * and 58.0s worst for a lesson, where a silent connection was dropped at a
 * random moment in 5 of 9 tries. The work and its suggest_contrast log line
 * are proposeContrastSets, untouched; this only carries its answer.
 *
 * The screen reads it with readHeartbeat, and keeps askTwiceIfLost around
 * it: whoever drops quiet connections is not known, so a drop is still
 * possible, and asking again stays safe because nothing is written.
 */
export async function suggestContrastSets(
  lessonContentId: string,
): Promise<AsyncGenerator<Heartbeat<ContrastSuggestResult>>> {
  return withHeartbeat(proposeContrastSets(lessonContentId), CONTRAST_BEAT_MS);
}
