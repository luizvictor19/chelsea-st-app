"use server";

import { revalidatePath } from "next/cache";

import { requireTeacher } from "@/lib/content/queries";

import {
  EDITED_ELSEWHERE,
  cleaned,
  deleteError,
  failureMessage,
  parseFields,
  questionError,
  questionRow,
  refusal,
  stillLoaded,
} from "./draft";

/** What every action on this screen answers with. */
export type QuestionResult =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

const SCREEN = "/teacher/content/questions";

const UNREADABLE = "O pedido chegou incompleto. Recarregue a página";

function failure(cause: unknown): QuestionResult {
  return { ok: false, error: failureMessage(cause) };
}

/**
 * Adds a question at the end of its point.
 *
 * The position is one past the highest the point holds, read here and not
 * taken from the screen. Two tabs adding at once can still read the same
 * number; the second insert is then refused by the unique on (point_id,
 * position) and says so, with the form left as it was.
 */
export async function addQuestion(
  pointId: string,
  fields: unknown,
): Promise<QuestionResult> {
  try {
    const { supabase } = await requireTeacher();
    const parsed = parseFields(fields);
    if (typeof pointId !== "string" || parsed === null) {
      return { ok: false, error: UNREADABLE };
    }
    const why = refusal(parsed);
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
    const { supabase } = await requireTeacher();
    const before = parseFields(loaded);
    const parsed = parseFields(fields);
    if (typeof questionId !== "string" || before === null || parsed === null) {
      return { ok: false, error: UNREADABLE };
    }
    const why = refusal(parsed);
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

/** Deletes a question and closes the gap, in one transaction (0027). */
export async function deleteQuestion(
  questionId: string,
): Promise<QuestionResult> {
  try {
    const { supabase } = await requireTeacher();
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
    const { supabase } = await requireTeacher();
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
