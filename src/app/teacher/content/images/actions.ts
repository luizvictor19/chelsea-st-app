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
import { buildPrompt } from "@/lib/images/style";
import { buildSubjectPrompt, parseSubject } from "@/lib/images/subject";
import {
  buildSuggestionPrompt,
  parseSuggestions,
  suggestionBatch,
} from "@/lib/images/suggest";
import { createDeepSeekProvider } from "@/lib/text/deepseek";
import type { Database } from "@/lib/supabase/types";

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
): Promise<SuggestResult> {
  try {
    const { supabase } = await requireTeacher();

    const { data: rows, error: readError } = await supabase
      .from("vocabulary_items")
      .select("id, term, points!inner(number, lesson_content_id)")
      .eq("points.lesson_content_id", lessonContentId);
    if (readError) return { ok: false, error: readError.message };

    /*
     * Sorted the way the screen sorts, with the shared comparator, and then
     * sliced. Two reasons it is not by id. Paging needs a total order or a
     * batch can skip one word and send another twice — but a uuid order would
     * also cut the lesson into stretches that match nothing the teacher can
     * see, and when a batch fails for good they need to be able to say which
     * words were left out. In this order, "the third batch" is a region of
     * the list in front of them.
     *
     * Re-read and re-sorted per batch rather than paged in the database, for
     * the reason listVocabularyImages already gives about nested ordering in
     * PostgREST, and because sixty rows cost nothing.
     */
    const all = (rows ?? [])
      .map((row) => ({
        id: row.id,
        term: row.term,
        pointNumber: row.points?.number ?? null,
      }))
      .sort((a, b) =>
        compareWords(
          { lessonNumber: null, pointNumber: a.pointNumber, term: a.term },
          { lessonNumber: null, pointNumber: b.pointNumber, term: b.term },
        ),
      );

    const total = all.length;
    const words = suggestionBatch(all, offset);
    // An empty lesson is not a failure, and it is not worth a request. Nor is
    // an offset past the end, which is how a caller asks "is there more".
    if (words.length === 0) {
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
    const { text } = await createDeepSeekProvider().complete({
      system,
      user,
      json: true,
    });

    const { suggestions, rejected } = parseSuggestions(
      text,
      words.map((word) => word.id),
    );

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
        })
        .eq("id", suggestion.id);
      if (error) return { ok: false, error: error.message };
    }

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
