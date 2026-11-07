"use server";

import { revalidatePath } from "next/cache";

import { requireContentWriter, requireTeacher } from "@/lib/content/queries";
import type { ImageChoice } from "@/lib/questions/question-image";
import { approvedPicture } from "@/lib/questions/shown-word";

import {
  EDITED_ELSEWHERE,
  cleaned,
  deleteError,
  failureMessage,
  isId,
  parseFields,
  parseSuggestion,
  publishRefusal,
  questionError,
  questionRow,
  refusal,
  stillLoaded,
  suggestionColumns,
  type PictureOf,
  type QuestionFields,
} from "./draft";
import { sortDrafts, type Draft, type LeftOut } from "./publish-reviewed";

/** What every action on this screen answers with. */
export type QuestionResult =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

const SCREEN = "/teacher/content/questions";

const UNREADABLE = "O pedido chegou incompleto. Recarregue a página";

function failure(cause: unknown): QuestionResult {
  return { ok: false, error: failureMessage(cause) };
}

type Client = Awaited<ReturnType<typeof requireTeacher>>["supabase"];

/**
 * The approved picture of the word or the scene `image` names, read from
 * its row as the screen reads it: a word's through approvedPicture (a kind
 * that is drawn, and image_path), a scene's image_path while it is in use.
 * A lookup that knows only that one item; anything else has no picture.
 * A failed read throws, and the action says it.
 */
async function storedPictureOf(
  supabase: Client,
  image: ImageChoice,
): Promise<PictureOf> {
  if ((image.kind !== "word" && image.kind !== "scene") || image.id === null) {
    return () => null;
  }
  let picture: string | null;
  if (image.kind === "word") {
    const { data, error } = await supabase
      .from("vocabulary_items")
      .select("representation, image_path")
      .eq("id", image.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    picture =
      data === null
        ? null
        : approvedPicture({
            representation: data.representation,
            imageUrl: data.image_path,
          });
  } else {
    const { data, error } = await supabase
      .from("scenes")
      .select("image_path")
      .eq("id", image.id)
      .is("archived_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    picture = data?.image_path ?? null;
  }
  const { kind, id } = image;
  return (asked, askedId) =>
    asked === kind && askedId === id ? picture : null;
}

/**
 * Why `fields` cannot be written published (publishRefusal), with the
 * picture read from the database and not taken from the screen. Reads only
 * when there is something to read: a draft, or one acted out, needs none.
 */
async function storedPublishRefusal(
  supabase: Client,
  fields: QuestionFields,
): Promise<string | null> {
  const pictureOf = fields.isPublished
    ? await storedPictureOf(supabase, fields.image)
    : () => null;
  return publishRefusal(fields, pictureOf);
}

/**
 * Adds a question at the end of its point.
 *
 * The position is one past the highest the point holds, read here and not
 * taken from the screen. Two tabs adding at once can still read the same
 * number; the second insert is then refused by the unique on (point_id,
 * position) and says so, with the form left as it was.
 *
 * Published, it is only written showing a picture or acted out
 * (storedPublishRefusal), as is an edit saved published.
 *
 * `suggestion` is where a question saved from a card of Sugerir perguntas
 * came from (0045), and nothing for one written by hand. Only an add writes
 * it: saveQuestion never sends those columns, and the database refuses an
 * update that would change them (questions_suggestion_kept).
 */
export async function addQuestion(
  pointId: string,
  fields: unknown,
  suggestion?: unknown,
): Promise<QuestionResult> {
  try {
    const { supabase } = await requireContentWriter();
    const parsed = parseFields(fields);
    const origin = parseSuggestion(suggestion);
    if (
      typeof pointId !== "string" ||
      parsed === null ||
      origin === undefined
    ) {
      return { ok: false, error: UNREADABLE };
    }
    const why =
      refusal(parsed) ?? (await storedPublishRefusal(supabase, parsed));
    if (why !== null) return { ok: false, error: why };
    const row = questionRow(cleaned(parsed));
    // refusal has turned away every fields questionRow cannot write.
    if (row === null) return { ok: false, error: UNREADABLE };

    const last = await supabase
      .from("questions")
      .select("position")
      .eq("point_id", pointId)
      .order("position", { ascending: false })
      .limit(1);
    if (last.error) return { ok: false, error: last.error.message };

    const { error } = await supabase.from("questions").insert({
      point_id: pointId,
      position: (last.data.at(0)?.position ?? -1) + 1,
      ...row,
      ...suggestionColumns(origin),
    });
    if (error) {
      return { ok: false, error: questionError(error.message, error.code) };
    }
    revalidatePath(SCREEN);
    return { ok: true };
  } catch (cause) {
    return failure(cause);
  }
}

/**
 * Saves an edit, if the question is still what the form opened on.
 *
 * `loaded` is the fields as the screen read them. The update only matches a
 * row that still holds every column it writes, as they were loaded
 * (stillLoaded): the text, the publish box and the three columns of the
 * image. So an edit made from an old view does not silently undo one saved
 * in another tab since, the image included: it matches nothing, and the
 * teacher is told to reload with the draft still on screen. A question
 * deleted meanwhile is the same case and gets the same sentence.
 */
export async function saveQuestion(
  questionId: string,
  loaded: unknown,
  fields: unknown,
): Promise<QuestionResult> {
  try {
    const { supabase } = await requireContentWriter();
    const before = parseFields(loaded);
    const parsed = parseFields(fields);
    if (typeof questionId !== "string" || before === null || parsed === null) {
      return { ok: false, error: UNREADABLE };
    }
    const why =
      refusal(parsed) ?? (await storedPublishRefusal(supabase, parsed));
    if (why !== null) return { ok: false, error: why };
    const row = questionRow(cleaned(parsed));
    const matches = stillLoaded(before);
    // refusal has turned away the first; a row never holds the second.
    if (row === null || matches === null) {
      return { ok: false, error: UNREADABLE };
    }

    let update = supabase.from("questions").update(row).eq("id", questionId);
    for (const match of matches) {
      update =
        match.op === "is"
          ? update.is(match.column, null)
          : update.eq(match.column, match.value);
    }
    const { data, error } = await update.select("id");
    if (error) {
      return { ok: false, error: questionError(error.message, error.code) };
    }
    if (data.length === 0) return { ok: false, error: EDITED_ELSEWHERE };

    revalidatePath(SCREEN);
    return { ok: true };
  } catch (cause) {
    return failure(cause);
  }
}

/** What "Publicar revisadas" answers with (#232). */
export type PublishResult =
  | {
      readonly ok: true;
      /** Published now. */
      readonly published: number;
      /** Ready on screen, but changed or published in another tab since: not touched. */
      readonly changed: number;
      /** Left drafts, by the pictures the database holds. */
      readonly left: readonly LeftOut[];
    }
  | { readonly ok: false; readonly error: string };

/** More drafts than a point ever holds: a request this long is not the screen's. */
const PUBLISH_MAX = 200;

/** The drafts as the screen sent them, checked, or null. */
function parseDrafts(value: unknown): Draft[] | null {
  if (!Array.isArray(value) || value.length > PUBLISH_MAX) return null;
  const drafts: Draft[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { id, number, fields } = item as Record<string, unknown>;
    const parsed = parseFields(fields);
    if (!isId(id) || !Number.isInteger(number) || parsed === null) return null;
    drafts.push({ id, number: number as number, fields: parsed });
  }
  return drafts;
}

/**
 * The approved pictures of every word and scene the drafts show, read from
 * their rows as storedPictureOf reads one: a word's by approvedPicture, a
 * scene's image_path while it is in use.
 */
async function storedPicturesOf(
  supabase: Client,
  drafts: readonly Draft[],
): Promise<PictureOf> {
  const wordIds = new Set<string>();
  const sceneIds = new Set<string>();
  for (const { fields } of drafts) {
    if (fields.image.kind === "word" && fields.image.id !== null) {
      wordIds.add(fields.image.id);
    }
    if (fields.image.kind === "scene" && fields.image.id !== null) {
      sceneIds.add(fields.image.id);
    }
  }
  const words = new Map<string, string | null>();
  const scenes = new Map<string, string | null>();
  if (wordIds.size > 0) {
    const { data, error } = await supabase
      .from("vocabulary_items")
      .select("id, representation, image_path")
      .in("id", [...wordIds]);
    if (error) throw new Error(error.message);
    for (const row of data) {
      words.set(
        row.id,
        approvedPicture({
          representation: row.representation,
          imageUrl: row.image_path,
        }),
      );
    }
  }
  if (sceneIds.size > 0) {
    const { data, error } = await supabase
      .from("scenes")
      .select("id, image_path")
      .in("id", [...sceneIds])
      .is("archived_at", null);
    if (error) throw new Error(error.message);
    for (const row of data) scenes.set(row.id, row.image_path);
  }
  return (kind, id) =>
    (kind === "word" ? words.get(id) : scenes.get(id)) ?? null;
}

/**
 * "Publicar revisadas" for one point (#232): publishes the drafts that can
 * be published and leaves the others as drafts.
 *
 * `drafts` is the point's unpublished questions as the screen loaded them.
 * Which ones go is decided again here, with the pictures the database holds
 * (sortDrafts, publishRefusal's rule), not the screen's. Each one is
 * published only while its row still holds every column as loaded
 * (stillLoaded) and is still in this point: one edited, moved or published
 * in another tab since is not touched and is counted as changed, so nothing
 * is published that the teacher did not see. Only is_published is written.
 *
 * One update per question, not one transaction: each is whole on its own,
 * and the answer says how many went.
 */
export async function publishReviewed(
  pointId: string,
  drafts: unknown,
): Promise<PublishResult> {
  try {
    const { supabase } = await requireContentWriter();
    const parsed = parseDrafts(drafts);
    if (!isId(pointId) || parsed === null) {
      return { ok: false, error: UNREADABLE };
    }
    const { ready, left } = sortDrafts(
      parsed,
      await storedPicturesOf(supabase, parsed),
    );

    let published = 0;
    let changed = 0;
    for (const draft of ready) {
      const matches = stillLoaded(draft.fields);
      // sortDrafts let through only rows imageColumns can write.
      if (matches === null) {
        changed += 1;
        continue;
      }
      let update = supabase
        .from("questions")
        .update({ is_published: true })
        .eq("id", draft.id)
        .eq("point_id", pointId);
      for (const match of matches) {
        update =
          match.op === "is"
            ? update.is(match.column, null)
            : update.eq(match.column, match.value);
      }
      const { data, error } = await update.select("id");
      if (error) {
        if (published > 0) revalidatePath(SCREEN);
        return {
          ok: false,
          error: `${questionError(error.message, error.code)}. ${published === 1 ? "1 pergunta já foi publicada" : `${published} perguntas já foram publicadas`} antes do erro`,
        };
      }
      if (data.length === 0) changed += 1;
      else published += 1;
    }

    revalidatePath(SCREEN);
    return { ok: true, published, changed, left };
  } catch (cause) {
    return { ok: false, error: failureMessage(cause) };
  }
}

/** Deletes a question and closes the gap, in one transaction (0027). */
export async function deleteQuestion(
  questionId: string,
): Promise<QuestionResult> {
  try {
    const { supabase } = await requireContentWriter();
    if (typeof questionId !== "string") {
      return { ok: false, error: UNREADABLE };
    }
    const { error } = await supabase.rpc("delete_question", {
      p_question_id: questionId,
    });
    if (error) {
      return { ok: false, error: deleteError(error.message, error.code) };
    }
    revalidatePath(SCREEN);
    return { ok: true };
  } catch (cause) {
    return failure(cause);
  }
}

/**
 * Writes the order of a point's questions, whole (0027). `ids` is every
 * question of the point in the order wanted; a list that is no longer exactly
 * the point's questions is refused by the database and nothing moves.
 */
export async function reorderQuestions(
  pointId: string,
  ids: readonly string[],
): Promise<QuestionResult> {
  try {
    const { supabase } = await requireContentWriter();
    if (
      typeof pointId !== "string" ||
      !Array.isArray(ids) ||
      !ids.every((id) => typeof id === "string")
    ) {
      return { ok: false, error: UNREADABLE };
    }
    const { error } = await supabase.rpc("reorder_questions", {
      p_point_id: pointId,
      p_ids: [...ids],
    });
    if (error) {
      return { ok: false, error: questionError(error.message, error.code) };
    }
    revalidatePath(SCREEN);
    return { ok: true };
  } catch (cause) {
    return failure(cause);
  }
}
