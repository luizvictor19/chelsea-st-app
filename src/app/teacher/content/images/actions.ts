"use server";

import { revalidatePath } from "next/cache";

import {
  readWordAttempts,
  requireTeacher,
  type ImageAttempt,
} from "@/lib/content/queries";
import { createFreepikProvider } from "@/lib/images/freepik";
import { GENERATION_WINDOW_MS, hasExpired } from "@/lib/images/generation";
import { isImageModelId } from "@/lib/images/provider";
import { buildPrompt } from "@/lib/images/style";
import { buildSubjectPrompt, parseSubject } from "@/lib/images/subject";
import { buildSuggestionPrompt, parseSuggestions } from "@/lib/images/suggest";
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
 */
export type ActionResult =
  | { ok: true; attempts?: readonly ImageAttempt[] }
  | { ok: false; error: string; attempts?: readonly ImageAttempt[] };

const BUCKET = "vocabulary-images";
const SCREEN = "/teacher/content/images";

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

export async function rejectAttempt(attemptId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const { error } = await supabase
      .from("image_attempts")
      .update({ status: "rejected", decided_at: new Date().toISOString() })
      .eq("id", attemptId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(SCREEN);
    return { ok: true };
  } catch (cause) {
    return failure(cause);
  }
}

export async function uploadImage(
  wordId: string,
  file: File,
): Promise<ActionResult> {
  try {
    if (file.size === 0) return { ok: false, error: "O arquivo está vazio." };
    const { supabase } = await requireTeacher();

    // Inserted before the upload because the path is built from the attempt
    // id, and left pending until the file is actually in the bucket: a
    // 'generated' row with no storage_path is one the approve function
    // refuses, so it must never exist even briefly.
    const { data: attempt, error: insertError } = await supabase
      .from("image_attempts")
      .insert({
        vocabulary_item_id: wordId,
        provider: "upload",
        status: "pending",
      })
      .select("id")
      .single();
    if (insertError) return { ok: false, error: insertError.message };

    const extension = extensionFor(
      file.type,
      file.name.split(".").pop() ?? "png",
    );
    const path = `${wordId}/${attempt.id}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) {
      return recordFailure(supabase, attempt.id, wordId, uploadError.message);
    }

    // An upload leaves 'pending' too, so it stamps completed_at like any
    // other attempt: the column means the same thing on every row or it means
    // nothing.
    const { error: doneError } = await finish(supabase, attempt.id, {
      status: "generated",
      storage_path: path,
    });
    if (doneError !== null) return { ok: false, error: doneError };

    revalidatePath(SCREEN);
    return { ok: true, attempts: await readWordAttempts(supabase, wordId) };
  } catch (cause) {
    return failure(cause);
  }
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
      .select("representation")
      .eq("id", wordId)
      .single();
    if (wordError) return { ok: false, error: wordError.message };
    if (word.representation === null) {
      return {
        ok: false,
        error: "Escolha o tipo da palavra antes de gerar a imagem.",
      };
    }

    // Before anything is inserted or paid for: an empty subject and a kind
    // that has no picture both throw here.
    const prompt = buildPrompt(subject, word.representation);

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
        status: "pending",
      })
      .select("id")
      .single();
    if (insertError) return { ok: false, error: insertError.message };

    let requestId: string;
    try {
      ({ requestId } = await createFreepikProvider().generate({
        prompt,
        model,
      }));
    } catch (cause) {
      return recordFailure(supabase, attempt.id, wordId, errorMessage(cause));
    }

    /*
     * The handle is what makes the row pollable by anyone later, so a row
     * that cannot store it is a row nobody can ever ask about. It is closed
     * here rather than left pending forever.
     */
    const { error: handleError } = await supabase
      .from("image_attempts")
      .update({ provider_request_id: requestId })
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
    // Null unless the provider reported one, which today it does not.
    credits_spent: creditsSpent ?? null,
  });
  if (doneError !== null) return { ok: false, error: doneError };

  revalidatePath(SCREEN);
  return { ok: true, attempts: await readWordAttempts(supabase, wordId) };
}

export type SuggestResult =
  | { ok: true; suggested: number; rejected: number }
  | { ok: false; error: string };

/**
 * Ask the model what kind of picture every word in one lesson needs.
 *
 * Every word, including the ones already decided. A decided lesson is the
 * answer key, so sending all of it turns each decided lesson into a
 * regression set for the prompt: change the wording and the suggestions move
 * against answers that already exist. Asking only about undecided words meant
 * a lesson produced a measurement once and never again, and the lessons worth
 * measuring against are exactly the ones already worked through.
 *
 * Writes suggested_representation and word_class, and never representation.
 * The class has one column because it is a fact rather than a judgement; the
 * separation of the other two is
 * the whole point of having two columns: a suggestion the teacher never looked
 * at must not be able to pass itself off as a decision, and the distance
 * between the two columns is how the model gets marked. Overwriting an older
 * suggestion is the point of re-running it; overwriting a decision would not
 * be a re-run, it would be the model grading itself.
 */
export async function suggestRepresentations(
  lessonContentId: string,
): Promise<SuggestResult> {
  try {
    const { supabase } = await requireTeacher();

    const { data: rows, error: readError } = await supabase
      .from("vocabulary_items")
      .select("id, term, points!inner(lesson_content_id)")
      .eq("points.lesson_content_id", lessonContentId);
    if (readError) return { ok: false, error: readError.message };

    const words = (rows ?? []).map((row) => ({ id: row.id, term: row.term }));
    // An empty lesson is not a failure, and it is not worth a request.
    if (words.length === 0) return { ok: true, suggested: 0, rejected: 0 };

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

    revalidatePath(SCREEN);
    return { ok: true, suggested: suggestions.length, rejected };
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
      .select("term, representation")
      .eq("id", wordId)
      .single();
    if (readError) return { ok: false, error: readError.message };

    if (word.representation === null) {
      return {
        ok: false,
        error: "Escolha o tipo da palavra antes de pedir uma instrução.",
      };
    }

    // Throws for a kind that has no picture, which the screen already hides
    // the button for; this is the same refusal one layer down.
    const { system, user } = buildSubjectPrompt(word.term, word.representation);

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
