"use server";

import { revalidatePath } from "next/cache";

import { requireTeacher } from "@/lib/content/queries";
import { isImageModelId, takesReference } from "@/lib/images/provider";
import { buildScenePrompt, type ImageStyle } from "@/lib/images/style";
import { readImageFile, refuseFile } from "@/lib/images/upload";

import {
  SCREEN,
  discardAttempt,
  errorMessage,
  failure,
  openGeneration,
  publicReferenceUrl,
  storeReference,
  storeUpload,
  type ActionResult,
} from "./attempt-store";
import { descriptionKey, isDescriptionTaken } from "./scenes";

/**
 * The Cenas section's actions (#64): a scene's own row, and its attempts
 * through the same store a word's go through (attempt-store.ts). Asking the
 * provider about a running one is pollAttempt's, in actions.ts, which serves
 * both owners.
 *
 * Every scene written here is common content (school_id null), as every word
 * is today (ADR 0004): the screen shows common content until a school writes
 * its own.
 */

/** The twin of actions.ts's SCENE_ATTEMPT, for a word's attempt sent here. */
const WORD_ATTEMPT = "Essa tentativa é de uma palavra, não de uma cena.";

export type CreateSceneResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: string;
      /** The scene that already has this description, to open instead. */
      existingId?: string;
      cause?: string;
    };

/**
 * Create a scene from its description. Nothing is generated: generating is
 * the panel's own button (#62).
 *
 * A description already taken, as scenes_description_key compares them, is
 * not written again. The answer names the scene that has it, so the screen
 * opens that one: the teacher wanted the scene, and it exists.
 */
export async function createScene(
  description: string,
): Promise<CreateSceneResult> {
  try {
    const text = description.trim();
    if (text === "") {
      return { ok: false, error: "Escreva o que a cena mostra." };
    }
    const { supabase } = await requireTeacher();

    const { data, error } = await supabase
      .from("scenes")
      .insert({ description: text })
      .select("id")
      .single();
    if (error === null) {
      revalidatePath(SCREEN);
      return { ok: true, id: data.id };
    }

    if (isDescriptionTaken(error)) {
      // Found by the same comparison the index makes, among the common
      // scenes, which is the scope this writes into.
      const { data: common } = await supabase
        .from("scenes")
        .select("id, description")
        .is("school_id", null);
      const key = descriptionKey(text);
      const existing = (common ?? []).find(
        (scene) => descriptionKey(scene.description) === key,
      );
      // Not found means the two comparisons parted on some rare white space;
      // the sentence then claims nothing it did not do.
      return existing === undefined
        ? {
            ok: false,
            error: "Já existe uma cena com essa descrição.",
            cause: error.message,
          }
        : {
            ok: false,
            error: "Já existe uma cena com essa descrição. Abri a que existe.",
            existingId: existing.id,
            cause: error.message,
          };
    }
    return {
      ok: false,
      error: "Não consegui criar a cena. Tente de novo.",
      cause: error.message,
    };
  } catch (cause) {
    return {
      ok: false,
      error: "Não consegui criar a cena. Tente de novo.",
      cause: errorMessage(cause),
    };
  }
}

/** The style the scene's next generation uses. Nothing generated moves. */
export async function setSceneStyle(
  sceneId: string,
  style: ImageStyle,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const { error } = await supabase
      .from("scenes")
      .update({ image_style: style })
      .eq("id", sceneId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(SCREEN);
    return { ok: true };
  } catch (cause) {
    return failure(cause);
  }
}

/** Attach a structure reference to a scene, as setReference does a word's. */
export async function setSceneReference(
  sceneId: string,
  file: File,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const stored = await storeReference(
      supabase,
      { kind: "scene", id: sceneId },
      file,
    );
    if (!stored.ok) return stored;

    // After the file is in the bucket, never before; see setReference.
    const { error } = await supabase
      .from("scenes")
      .update({ reference_path: stored.path })
      .eq("id", sceneId);
    if (error) return { ok: false, error: error.message };

    revalidatePath(SCREEN);
    return { ok: true, reference: publicReferenceUrl(supabase, stored.path) };
  } catch (cause) {
    return failure(cause);
  }
}

/** The column only, never the file; see clearReference. */
export async function clearSceneReference(
  sceneId: string,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const { error } = await supabase
      .from("scenes")
      .update({ reference_path: null })
      .eq("id", sceneId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(SCREEN);
    return { ok: true, reference: null };
  } catch (cause) {
    return failure(cause);
  }
}

/**
 * Open a generation of a scene at the provider; see openGeneration.
 *
 * The instruction is written on the attempt only. A scene has no column for
 * one: its description is what it is, and the panel opens the field on the
 * newest attempt's instruction, or on the description.
 */
export async function startSceneGeneration(
  sceneId: string,
  subject: string,
  model: string,
): Promise<ActionResult> {
  try {
    if (!isImageModelId(model)) {
      return { ok: false, error: `Modelo desconhecido: ${model}` };
    }
    const { supabase } = await requireTeacher();

    // The style and the reference from the row: the screen could be a
    // refresh behind the teacher's last decision.
    const { data: scene, error: sceneError } = await supabase
      .from("scenes")
      .select("image_style, reference_path")
      .eq("id", sceneId)
      .single();
    if (sceneError) return { ok: false, error: sceneError.message };

    // Before anything is inserted or paid for: an empty subject throws here.
    const prompt = buildScenePrompt(subject, scene.image_style);

    // Only this attempt's reference if the model can take one; see
    // startGeneration.
    const referencePath = takesReference(model) ? scene.reference_path : null;

    return await openGeneration(
      supabase,
      { kind: "scene", id: sceneId },
      { model, prompt, subject, referencePath },
    );
  } catch (cause) {
    return failure(cause);
  }
}

/**
 * Send a finished picture as an attempt of the scene; see storeUpload. The
 * instruction given with it goes on the attempt, null when left empty.
 */
export async function uploadSceneImage(
  sceneId: string,
  file: File,
  subject: string,
): Promise<ActionResult> {
  try {
    // The panel asked this already; asked again where it cannot be worked
    // around. A scene has no kind to decide first, so the file is all.
    const refusal = refuseFile({ size: file.size, type: file.type });
    if (refusal !== null) return { ok: false, error: refusal };

    const { supabase } = await requireTeacher();
    const image = await readImageFile(file);
    if (image === null) {
      return {
        ok: false,
        error: "Não consegui ler esse arquivo como PNG, JPEG ou WebP.",
      };
    }

    const used = subject.trim();
    return await storeUpload(
      supabase,
      { kind: "scene", id: sceneId },
      image,
      file.name,
      used === "" ? null : used,
    );
  } catch (cause) {
    return {
      ok: false,
      error: "Não consegui enviar a imagem. Tente de novo.",
      cause: errorMessage(cause),
    };
  }
}

/**
 * Approve a scene's attempt. approve_image_attempt does for a scene what it
 * does for a word (0030): the scene's approved one goes back to 'generated'
 * and the scene's picture moves, in one transaction.
 */
export async function approveSceneAttempt(
  attemptId: string,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const { data: attempt, error: readError } = await supabase
      .from("image_attempts")
      .select("scene_id")
      .eq("id", attemptId)
      .single();
    if (readError) return { ok: false, error: readError.message };
    if (attempt.scene_id === null) return { ok: false, error: WORD_ATTEMPT };

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

/** Discard a scene's generated attempt; see discardAttempt. */
export async function rejectSceneAttempt(
  attemptId: string,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const { data: attempt, error: readError } = await supabase
      .from("image_attempts")
      .select("scene_id, status, storage_path")
      .eq("id", attemptId)
      .single();
    if (readError) return { ok: false, error: readError.message };
    if (attempt.scene_id === null) return { ok: false, error: WORD_ATTEMPT };

    return await discardAttempt(
      supabase,
      attemptId,
      { kind: "scene", id: attempt.scene_id },
      attempt,
    );
  } catch (cause) {
    return failure(cause);
  }
}
