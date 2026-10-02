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
  refusal,
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
    const question = cleaned(parsed);

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
      prompt: question.prompt,
      expected_answer: question.expectedAnswer,
      answer_language: question.answerLanguage,
      is_published: question.isPublished,
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
 * `loaded` is the four fields as the screen read them. The update only
 * matches a row that still holds them, so an edit made from an old view does
 * not silently undo one saved in another tab since: it matches nothing, and
 * the teacher is told to reload with the draft still on screen. A question
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
    const question = cleaned(parsed);

    const { data, error } = await supabase
      .from("questions")
      .update({
        prompt: question.prompt,
        expected_answer: question.expectedAnswer,
        answer_language: question.answerLanguage,
        is_published: question.isPublished,
      })
      .eq("id", questionId)
      .eq("prompt", before.prompt)
      .eq("expected_answer", before.expectedAnswer)
      .eq("answer_language", before.answerLanguage)
      .eq("is_published", before.isPublished)
      .select("id");
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
