"use server";

import { revalidatePath } from "next/cache";

import { requireTeacher } from "@/lib/content/queries";
import { createFreepikProvider } from "@/lib/images/freepik";
import { type ImageModelId, isImageModelId } from "@/lib/images/provider";
import { buildPrompt } from "@/lib/images/style";
import { buildSuggestionPrompt, parseSuggestions } from "@/lib/images/suggest";
import { createDeepSeekProvider } from "@/lib/text/deepseek";
import type { Database } from "@/lib/supabase/types";

type Representation = Database["public"]["Enums"]["representation_kind"];

export type ActionResult = { ok: true } | { ok: false; error: string };

const BUCKET = "vocabulary-images";
const SCREEN = "/teacher/content/images";

/** How long a generation is waited for, and how often it is asked about. */
const POLL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

/** Whatever was thrown, as a string the screen can show. */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function failure(error: unknown): ActionResult {
  return { ok: false, error: errorMessage(error) };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      await supabase
        .from("image_attempts")
        .update({ status: "failed", error: uploadError.message })
        .eq("id", attempt.id);
      return { ok: false, error: uploadError.message };
    }

    const { error: doneError } = await supabase
      .from("image_attempts")
      .update({ status: "generated", storage_path: path })
      .eq("id", attempt.id);
    if (doneError) return { ok: false, error: doneError.message };

    revalidatePath(SCREEN);
    return { ok: true };
  } catch (cause) {
    return failure(cause);
  }
}

export async function generateImage(
  wordId: string,
  subject: string,
  model: string,
): Promise<ActionResult> {
  try {
    if (!isImageModelId(model)) {
      return { ok: false, error: `Modelo desconhecido: ${model}` };
    }
    const { supabase } = await requireTeacher();

    // Before anything is inserted or paid for: an empty subject throws here.
    const prompt = buildPrompt(subject);

    const { data: attempt, error: insertError } = await supabase
      .from("image_attempts")
      .insert({
        vocabulary_item_id: wordId,
        provider: "freepik",
        model,
        prompt,
        status: "pending",
      })
      .select("id")
      .single();
    if (insertError) return { ok: false, error: insertError.message };

    const result = await runGeneration(supabase, attempt.id, prompt, model);
    revalidatePath(SCREEN);
    return result;
  } catch (cause) {
    return failure(cause);
  }
}

/**
 * The part that talks to the provider, split out so that every way it can end
 * writes the attempt row before returning. An attempt left at 'pending'
 * because something threw is an attempt the teacher cannot see the reason for.
 */
async function runGeneration(
  supabase: Awaited<ReturnType<typeof requireTeacher>>["supabase"],
  attemptId: string,
  prompt: string,
  model: ImageModelId,
): Promise<ActionResult> {
  const provider = createFreepikProvider();

  const recordFailure = async (message: string): Promise<ActionResult> => {
    const { error } = await supabase
      .from("image_attempts")
      .update({ status: "failed", error: message })
      .eq("id", attemptId);
    return {
      ok: false,
      error: error ? `${message} (${error.message})` : message,
    };
  };

  let requestId: string;
  try {
    ({ requestId } = await provider.generate({ prompt, model }));
  } catch (cause) {
    return recordFailure(
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  const { error: handleError } = await supabase
    .from("image_attempts")
    .update({ provider_request_id: requestId })
    .eq("id", attemptId);
  if (handleError) return { ok: false, error: handleError.message };

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    let poll;
    try {
      poll = await provider.poll(requestId);
    } catch (cause) {
      return recordFailure(
        cause instanceof Error ? cause.message : String(cause),
      );
    }

    if (poll.status === "failed") {
      return recordFailure(poll.error ?? "A geração falhou sem dizer por quê.");
    }

    if (poll.status === "done") {
      if (poll.imageUrl === undefined) {
        return recordFailure("A geração terminou sem imagem.");
      }
      return storeGenerated(
        supabase,
        attemptId,
        poll.imageUrl,
        poll.creditsSpent,
        recordFailure,
      );
    }

    if (Date.now() >= deadline) {
      return recordFailure(
        `A geração passou de ${POLL_TIMEOUT_MS / 1000} segundos sem responder.`,
      );
    }
    await wait(POLL_INTERVAL_MS);
  }
}

/** Download on the server, then into the bucket. The URL never reaches the browser. */
async function storeGenerated(
  supabase: Awaited<ReturnType<typeof requireTeacher>>["supabase"],
  attemptId: string,
  imageUrl: string,
  creditsSpent: number | undefined,
  recordFailure: (message: string) => Promise<ActionResult>,
): Promise<ActionResult> {
  const { data: attempt, error: readError } = await supabase
    .from("image_attempts")
    .select("vocabulary_item_id")
    .eq("id", attemptId)
    .single();
  if (readError) return { ok: false, error: readError.message };

  const response = await fetch(imageUrl, { cache: "no-store" });
  if (!response.ok) {
    return recordFailure(`Não deu para baixar a imagem: ${response.status}`);
  }
  const contentType = response.headers.get("content-type");
  const bytes = await response.arrayBuffer();
  const path = `${attempt.vocabulary_item_id}/${attemptId}.${extensionFor(contentType, "png")}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: contentType ?? undefined });
  if (uploadError) return recordFailure(uploadError.message);

  const { error: doneError } = await supabase
    .from("image_attempts")
    .update({
      status: "generated",
      storage_path: path,
      // Null unless the provider reported one, which today it does not.
      credits_spent: creditsSpent ?? null,
    })
    .eq("id", attemptId);
  if (doneError) return { ok: false, error: doneError.message };

  return { ok: true };
}

export type SuggestResult =
  | { ok: true; suggested: number; rejected: number }
  | { ok: false; error: string };

/**
 * Ask the model what kind of picture each undecided word in one lesson needs.
 *
 * Writes suggested_representation and never representation. That separation is
 * the whole point of having two columns: a suggestion the teacher never looked
 * at must not be able to pass itself off as a decision, and the distance
 * between the two columns is how the model gets marked.
 */
export async function suggestRepresentations(
  lessonContentId: string,
): Promise<SuggestResult> {
  try {
    const { supabase } = await requireTeacher();

    const { data: rows, error: readError } = await supabase
      .from("vocabulary_items")
      .select("id, term, points!inner(lesson_content_id)")
      .eq("points.lesson_content_id", lessonContentId)
      .is("representation", null);
    if (readError) return { ok: false, error: readError.message };

    const words = (rows ?? []).map((row) => ({ id: row.id, term: row.term }));
    // Nothing to ask about is not a failure, and it is not worth a request.
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
        .update({ suggested_representation: suggestion.kind })
        .eq("id", suggestion.id);
      if (error) return { ok: false, error: error.message };
    }

    revalidatePath(SCREEN);
    return { ok: true, suggested: suggestions.length, rejected };
  } catch (cause) {
    return { ok: false, error: errorMessage(cause) };
  }
}
