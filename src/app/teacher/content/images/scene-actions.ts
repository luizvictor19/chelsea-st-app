"use server";

import { revalidatePath } from "next/cache";

import { requireTeacher } from "@/lib/content/queries";
import { parsePictureKeys } from "@/lib/images/pictures";
import {
  composesPictures,
  isImageModelId,
  takesReference,
} from "@/lib/images/provider";
import { buildScenePrompt, type ImageStyle } from "@/lib/images/style";
import { readImageFile, refuseFile } from "@/lib/images/upload";

import {
  BUCKET,
  SCREEN,
  discardAttempt,
  errorMessage,
  failure,
  openGeneration,
  publicReferenceUrl,
  storePictures,
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
        .is("school_id", null)
        // The index holds only the scenes in use (0034).
        .is("archived_at", null);
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

/**
 * Excluir a scene (#121): archive it. It leaves every list; its attempts and
 * what they cost stay, which deleting the row would take with it (0034).
 *
 * A scene a question shows is refused here with the question named, before
 * the trigger refuses it with an id the teacher cannot use.
 */
export async function archiveScene(sceneId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const { data: shown, error: shownError } = await supabase
      .from("questions")
      .select("prompt, points(number)")
      .eq("scene_id", sceneId)
      .limit(1);
    if (shownError) return { ok: false, error: shownError.message };
    const question = shown[0];
    if (question !== undefined) {
      const point =
        question.points === null ? "" : ` do ponto ${question.points.number}`;
      return {
        ok: false,
        error: `A pergunta "${question.prompt}"${point} mostra esta cena. Troque a imagem dela antes de excluir.`,
      };
    }

    const { data, error } = await supabase
      .from("scenes")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", sceneId)
      .is("archived_at", null)
      .select("id");
    if (error) {
      return {
        ok: false,
        error: "Não consegui excluir a cena. Tente de novo.",
        cause: error.message,
      };
    }
    if (data.length === 0) {
      return { ok: false, error: "Essa cena já foi excluída." };
    }
    revalidatePath(SCREEN);
    return { ok: true };
  } catch (cause) {
    return failure(cause);
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

    // After the file is in the bucket, never before; see setReference. The
    // chosen pictures go in the same write: a scene has one or the other
    // (scenes_one_kind_of_reference, 0033).
    const { error } = await supabase
      .from("scenes")
      .update({ reference_path: stored.path, composed_from: null })
      .eq("id", sceneId);
    if (error) return { ok: false, error: error.message };

    revalidatePath(SCREEN);
    return {
      ok: true,
      reference: publicReferenceUrl(supabase, stored.path),
      pictures: null,
    };
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
 * Choose the approved pictures a scene is drawn from (#120), by the keys the
 * screen lists them under, in order.
 *
 * Each path is read from its row here, never taken from the browser, and has
 * to be an approved picture now: a list the screen drew a refresh ago can
 * name one that was replaced. The files are copied under the scene's
 * references (storePictures) before the row names them, and the single
 * reference goes in the same write: a scene has one or the other (0033).
 */
export async function setScenePictures(
  sceneId: string,
  keys: readonly string[],
): Promise<ActionResult> {
  try {
    const parsed = parsePictureKeys(keys, sceneId);
    if (!parsed.ok) return parsed;
    const { supabase } = await requireTeacher();

    const wordIds = parsed.sources
      .filter((source) => source.kind === "word")
      .map((source) => source.id);
    const sceneIds = parsed.sources
      .filter((source) => source.kind === "scene")
      .map((source) => source.id);
    const [words, scenes] = await Promise.all([
      supabase
        .from("vocabulary_items")
        .select("id, image_path")
        .in("id", wordIds),
      supabase.from("scenes").select("id, image_path").in("id", sceneIds),
    ]);
    if (words.error) return { ok: false, error: words.error.message };
    if (scenes.error) return { ok: false, error: scenes.error.message };
    const found = new Map(
      [...words.data, ...scenes.data].map((row) => [row.id, row.image_path]),
    );
    const sources: string[] = [];
    for (const source of parsed.sources) {
      const path = found.get(source.id);
      if (path === undefined || path === null) {
        return {
          ok: false,
          error:
            "Uma das imagens escolhidas não está mais aprovada. Recarregue a página e escolha de novo.",
        };
      }
      sources.push(path);
    }

    const owner = { kind: "scene", id: sceneId } as const;
    const stored = await storePictures(supabase, owner, sources);
    if (!stored.ok) {
      return {
        ok: false,
        error:
          "Não consegui copiar as imagens. Nada foi gravado; tente de novo.",
        cause: stored.error,
      };
    }

    // Selected back, because a scene gone or out of reach updates no row
    // and says nothing: the panel would show pictures the row does not have.
    const { data: written, error } = await supabase
      .from("scenes")
      .update({ composed_from: stored.paths, reference_path: null })
      .eq("id", sceneId)
      .select("id");
    if (error || written.length === 0) {
      // Copies no row names; the best effort there is, as in storeUpload.
      await supabase.storage.from(BUCKET).remove(stored.paths);
      return {
        ok: false,
        error: error?.message ?? "Essa cena não existe mais.",
      };
    }

    revalidatePath(SCREEN);
    return {
      ok: true,
      pictures: stored.paths.map((path) => publicReferenceUrl(supabase, path)),
      reference: null,
    };
  } catch (cause) {
    return failure(cause);
  }
}

/** The column only, never the files; see clearReference. */
export async function clearScenePictures(
  sceneId: string,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireTeacher();
    const { error } = await supabase
      .from("scenes")
      .update({ composed_from: null })
      .eq("id", sceneId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(SCREEN);
    return { ok: true, pictures: null };
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
      .select("image_style, reference_path, composed_from")
      .eq("id", sceneId)
      .single();
    if (sceneError) return { ok: false, error: sceneError.message };

    // A model that composes has nothing to draw without the pictures, and
    // the provider would refuse an empty list after the row is written.
    // Both ways round: one that does not compose would ignore the pictures
    // and still be paid for. The panel offers neither; a stale tab could.
    const composes = composesPictures(model);
    if (composes && scene.composed_from === null) {
      return {
        ok: false,
        error:
          "Escolha as imagens em Juntar imagens aprovadas antes de gerar com esse modelo.",
      };
    }
    if (!composes && scene.composed_from !== null) {
      return {
        ok: false,
        error:
          "Essa cena tem imagens escolhidas, e esse modelo não desenha a partir delas. Recarregue a página ou tire as imagens.",
      };
    }

    // Before anything is inserted or paid for: an empty subject throws here.
    const prompt = buildScenePrompt(subject, scene.image_style);

    // Only this attempt's reference if the model can take one; see
    // startGeneration.
    const referencePath = takesReference(model) ? scene.reference_path : null;
    const composedFrom = composes ? scene.composed_from : null;

    return await openGeneration(
      supabase,
      { kind: "scene", id: sceneId },
      { model, prompt, subject, referencePath, composedFrom },
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
