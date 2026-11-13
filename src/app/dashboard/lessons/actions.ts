"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { refusalSentence } from "@/lib/lessons/refusals";
import { creditsLabel } from "@/lib/lessons/slots";
import { createClient } from "@/lib/supabase/server";

export type LessonResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly error: string };

/** The signed-in student's client; RLS and the functions decide the rest. */
async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

function refresh() {
  revalidatePath("/dashboard", "layout");
}

/**
 * Books the slot for her and debits what a lesson costs her, in one call to
 * book_lesson (0052): the cost and the person are the database's, never
 * this request's.
 */
export async function bookLesson(
  teacherId: string,
  startsAt: string,
): Promise<LessonResult> {
  const { supabase } = await signedIn();
  const { data, error } = await supabase.rpc("book_lesson", {
    p_teacher: teacherId,
    p_starts_at: startsAt,
  });
  if (error) return { ok: false, error: refusalSentence(error.message) };
  refresh();
  const booked = data.at(0);
  if (booked === undefined) {
    return { ok: false, error: refusalSentence(null) };
  }
  return {
    ok: true,
    message: `Aula reservada por ${creditsLabel(booked.credits_debited)}. Saldo: ${creditsLabel(booked.balance)}.`,
  };
}

/**
 * Cancels her lesson through cancel_lesson (0052), and says what the ledger
 * did: how many credits came back, or that none did. None can be the time to
 * get them back having ended, or the charge that paid for them having been
 * refunded (credit_refund skips a voided lot), so the sentence says only
 * what happened.
 */
export async function cancelMyLesson(lessonId: string): Promise<LessonResult> {
  const { supabase } = await signedIn();
  const { data: lesson } = await supabase
    .from("lessons")
    .select("credits_debited")
    .eq("id", lessonId)
    .maybeSingle();
  const { data, error } = await supabase.rpc("cancel_lesson", {
    p_lesson: lessonId,
  });
  if (error) return { ok: false, error: refusalSentence(error.message) };
  refresh();
  if (data > 0) {
    return {
      ok: true,
      message: `Aula cancelada. ${creditsLabel(data)} de volta no seu saldo.`,
    };
  }
  return {
    ok: true,
    message:
      (lesson?.credits_debited ?? 0) > 0
        ? "Aula cancelada. Nenhum crédito voltou para o seu saldo."
        : "Aula cancelada.",
  };
}
