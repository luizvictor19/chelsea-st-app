"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { sendInvitesAfterResponse } from "@/lib/calendar/server";
import { readProposalForm } from "@/lib/lessons/proposal-form";
import { sendProposalMailAfterResponse } from "@/lib/lessons/proposals/server";
import { lessonsLabel } from "@/lib/lessons/proposals/view";
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
  // The invites (#294) were queued with the lesson; they go after the answer.
  sendInvitesAfterResponse(booked.lesson_id);
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
  sendInvitesAfterResponse(lessonId);
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

/**
 * She proposes a lesson or a series to a teacher of hers, outside the free
 * slots (#319, propose_lessons_to_teacher, 0057): the form read into instants
 * in her zone; nothing is held, and the database refuses when her balance
 * does not cover the proposal now. The teacher's e-mail goes after the answer.
 */
export async function proposeToTeacher(
  formData: FormData,
): Promise<LessonResult> {
  const { supabase, user } = await signedIn();
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return { ok: false, error: refusalSentence(null) };
  const read = readProposalForm(formData, profile.timezone);
  if (!read.ok) return { ok: false, error: read.message };
  const { data, error } = await supabase.rpc("propose_lessons_to_teacher", {
    p_teacher: String(formData.get("teacher_id") ?? ""),
    p_starts: read.values.map((start) => start.toISOString()),
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("credits_not_negative")
        ? "Seu saldo não cobre as aulas desta proposta."
        : refusalSentence(error.message),
    };
  }
  refresh();
  sendProposalMailAfterResponse(data);
  return {
    ok: true,
    message: `Proposta enviada · ${lessonsLabel(read.values.length)}. Nada é debitado antes do aceite do professor.`,
  };
}

/**
 * Her yes or no to a teacher's proposal (accept_lesson_proposal,
 * decline_lesson_proposal, 0057). The yes debits every lesson at what a
 * lesson costs her now, or nothing when her balance does not cover them all;
 * the calendar invites go after the answer.
 */
export async function answerMyProposal(
  proposalId: string,
  answer: "accept" | "decline",
): Promise<LessonResult> {
  const { supabase } = await signedIn();
  if (answer === "decline") {
    const { error } = await supabase.rpc("decline_lesson_proposal", {
      p_proposal: proposalId,
    });
    if (error) return { ok: false, error: refusalSentence(error.message) };
    refresh();
    return { ok: true, message: "Proposta recusada. Nada foi debitado." };
  }
  const { data, error } = await supabase.rpc("accept_lesson_proposal", {
    p_proposal: proposalId,
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("credits_not_negative")
        ? "Seu saldo não cobre todas as aulas da proposta. Nada foi debitado."
        : refusalSentence(error.message),
    };
  }
  refresh();
  const { data: items } = await supabase
    .from("lesson_proposal_items")
    .select("lesson_id")
    .eq("proposal_id", proposalId)
    .order("starts_at");
  const lessons = (items ?? []).flatMap((item) =>
    item.lesson_id === null ? [] : [item.lesson_id],
  );
  if (lessons.length > 0) sendInvitesAfterResponse(lessons);
  const accepted = data.at(0);
  return {
    ok: true,
    message:
      accepted === undefined
        ? "Proposta aceita."
        : `Proposta aceita · ${lessonsLabel(accepted.lesson_count)} por ${creditsLabel(accepted.credits_debited)}. Saldo: ${creditsLabel(accepted.balance)}.`,
  };
}

/** Takes back a proposal she made, while it is open (0057). */
export async function withdrawMyProposal(
  proposalId: string,
): Promise<LessonResult> {
  const { supabase } = await signedIn();
  const { error } = await supabase.rpc("withdraw_lesson_proposal", {
    p_proposal: proposalId,
  });
  if (error) return { ok: false, error: refusalSentence(error.message) };
  refresh();
  return { ok: true, message: "Proposta retirada." };
}
