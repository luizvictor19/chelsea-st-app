"use server";

import { revalidatePath } from "next/cache";

import { requireTeacher } from "@/lib/content/queries";
import { refusalSentence } from "@/lib/lessons/refusals";
import { creditsLabel } from "@/lib/lessons/slots";

export type AgendaResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly error: string };

/**
 * Cancels through cancel_lesson (0052), the same rule as /teacher/agenda: a
 * lesson is born only by a booking and changes status only through the
 * functions (0054). A lesson the student paid for gives her credits back; one
 * moved from the fixed agenda debited nothing, and nothing comes back.
 */
export async function cancelLesson(lessonId: string): Promise<AgendaResult> {
  const { supabase } = await requireTeacher();
  const { data, error } = await supabase.rpc("cancel_lesson", {
    p_lesson: lessonId,
  });
  if (error) return { ok: false, error: refusalSentence(error.message) };
  revalidatePath("/teacher/students", "layout");
  revalidatePath("/teacher/agenda");
  return {
    ok: true,
    message:
      data > 0
        ? `Aula cancelada · ${creditsLabel(data)} de volta para o aluno.`
        : "Aula cancelada.",
  };
}
