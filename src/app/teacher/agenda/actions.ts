"use server";

import { revalidatePath } from "next/cache";

import { sendInvitesAfterResponse } from "@/lib/calendar/server";
import { requireTeacher } from "@/lib/content/queries";
import {
  readProfileForm,
  readTimeOffForm,
  readWindowForm,
} from "@/lib/lessons/availability-form";
import { readProposalForm } from "@/lib/lessons/proposal-form";
import { sendProposalMailAfterResponse } from "@/lib/lessons/proposals/server";
import { lessonsLabel } from "@/lib/lessons/proposals/view";
import { refusalSentence, STUDENT_BALANCE_SHORT } from "@/lib/lessons/refusals";
import { lessonMinutesFrom } from "@/lib/lessons/rules";
import { creditsLabel } from "@/lib/lessons/slots";

import { instantIn } from "@/lib/datetime";
import { teacherZone } from "../students/queries";

export type AgendaResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly error: string };

type Supabase = Awaited<ReturnType<typeof requireTeacher>>["supabase"];

/** The screen, the student's screens and the dashboard read what these write. */
function refresh() {
  revalidatePath("/teacher/agenda");
  revalidatePath("/dashboard", "layout");
}

/** Her row of teachers in an organization, or null. RLS gives only hers. */
async function ownProfile(
  supabase: Supabase,
  userId: string,
  organizationId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("teachers")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Creates or changes her profile in the organization: the Meet, the
 * calendar e-mail and whether she takes bookings (teachers, 0052). The role
 * comes from her membership there, read again on the server.
 */
export async function saveTeacherProfile(
  formData: FormData,
): Promise<AgendaResult> {
  const { supabase, user } = await requireTeacher();
  const read = readProfileForm(formData);
  if (!read.ok) return { ok: false, error: read.message };
  const organizationId = String(formData.get("organization_id") ?? "");

  const { data: members, error: membersError } = await supabase
    .from("organization_members")
    .select("role, organizations!inner(has_teacher)")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId);
  if (membersError) return { ok: false, error: membersError.message };
  const role = members.some((m) => m.role === "teacher")
    ? "teacher"
    : members.some((m) => m.role === "admin" && m.organizations.has_teacher)
      ? "admin"
      : null;
  if (role === null) {
    return { ok: false, error: "Você não ensina nessa organização." };
  }

  const values = {
    meet_url: read.values.meetUrl,
    calendar_email: read.values.calendarEmail,
    is_active: read.values.isActive,
  };
  const id = await ownProfile(supabase, user.id, organizationId);
  const { error } =
    id === null
      ? await supabase.from("teachers").insert({
          ...values,
          organization_id: organizationId,
          user_id: user.id,
          member_role: role,
        })
      : await supabase
          .from("teachers")
          .update({ ...values, updated_at: new Date().toISOString() })
          .eq("id", id);
  if (error) return { ok: false, error: refusalSentence(error.message) };
  refresh();
  return {
    ok: true,
    message: read.values.isActive
      ? "Perfil salvo · aceitando reservas."
      : "Perfil salvo · sem aceitar reservas.",
  };
}

/** A weekly window in her zone, with room for one lesson (lesson_rules). */
export async function addWindow(formData: FormData): Promise<AgendaResult> {
  const { supabase, user } = await requireTeacher();
  const teacherId = String(formData.get("teacher_id") ?? "");
  const { data: rules, error: rulesError } = await supabase.rpc("lesson_rules");
  const lessonMinutes = rulesError ? null : lessonMinutesFrom(rules);
  if (lessonMinutes === null) {
    return { ok: false, error: "Não foi possível ler a duração da aula." };
  }
  const read = readWindowForm(formData, lessonMinutes);
  if (!read.ok) return { ok: false, error: read.message };

  const { data: teacher } = await supabase
    .from("teachers")
    .select("organization_id")
    .eq("id", teacherId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!teacher) return { ok: false, error: "Salve o seu perfil primeiro." };

  const { error } = await supabase.from("teacher_availability").insert({
    organization_id: teacher.organization_id,
    teacher_id: teacherId,
    weekday: read.values.weekday,
    start_time: read.values.startTime,
    end_time: read.values.endTime,
    timezone: await teacherZone(supabase, user.id),
  });
  if (error) return { ok: false, error: refusalSentence(error.message) };
  refresh();
  return { ok: true, message: "Janela adicionada." };
}

export async function removeWindow(windowId: string): Promise<AgendaResult> {
  const { supabase } = await requireTeacher();
  const { data, error } = await supabase
    .from("teacher_availability")
    .delete()
    .eq("id", windowId)
    .select("id");
  if (error) return { ok: false, error: refusalSentence(error.message) };
  if (data.length === 0) {
    return { ok: false, error: "Essa janela já não existia." };
  }
  refresh();
  return {
    ok: true,
    message: "Janela removida. As aulas já reservadas nela continuam.",
  };
}

/** Whole days off, in her zone, from the first to the last. */
export async function addTimeOff(formData: FormData): Promise<AgendaResult> {
  const { supabase, user } = await requireTeacher();
  const teacherId = String(formData.get("teacher_id") ?? "");
  const read = readTimeOffForm(formData);
  if (!read.ok) return { ok: false, error: read.message };

  const { data: teacher } = await supabase
    .from("teachers")
    .select("organization_id")
    .eq("id", teacherId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!teacher) return { ok: false, error: "Salve o seu perfil primeiro." };

  const zone = await teacherZone(supabase, user.id);
  const { error } = await supabase.from("teacher_time_off").insert({
    organization_id: teacher.organization_id,
    teacher_id: teacherId,
    starts_at: instantIn(read.values.fromDate, "00:00", zone).toISOString(),
    ends_at: instantIn(read.values.untilDate, "00:00", zone).toISOString(),
  });
  if (error) return { ok: false, error: refusalSentence(error.message) };
  refresh();
  return {
    ok: true,
    message: "Folga adicionada. As aulas já reservadas nela continuam.",
  };
}

export async function removeTimeOff(timeOffId: string): Promise<AgendaResult> {
  const { supabase } = await requireTeacher();
  const { data, error } = await supabase
    .from("teacher_time_off")
    .delete()
    .eq("id", timeOffId)
    .select("id");
  if (error) return { ok: false, error: refusalSentence(error.message) };
  if (data.length === 0) {
    return { ok: false, error: "Essa folga já não existia." };
  }
  refresh();
  return { ok: true, message: "Folga removida." };
}

/**
 * Cancels a booked lesson as its teacher (cancel_lesson, 0052): the
 * student's credits always come back, and the sentence says how many the
 * ledger gave back.
 */
export async function cancelBookedLesson(
  lessonId: string,
): Promise<AgendaResult> {
  const { supabase } = await requireTeacher();
  const { data, error } = await supabase.rpc("cancel_lesson", {
    p_lesson: lessonId,
  });
  if (error) return { ok: false, error: refusalSentence(error.message) };
  refresh();
  revalidatePath("/teacher/students", "layout");
  sendInvitesAfterResponse(lessonId);
  return {
    ok: true,
    message:
      data > 0
        ? `Aula cancelada · ${creditsLabel(data)} de volta para o aluno.`
        : "Aula cancelada.",
  };
}

/**
 * Proposes a lesson or a series to a student of hers (#319,
 * propose_lessons_to_student, 0057): the form read into instants in her zone,
 * nothing debited, the e-mail to the student after the answer.
 */
export async function proposeLessons(
  formData: FormData,
): Promise<AgendaResult> {
  const { supabase, user } = await requireTeacher();
  const zone = await teacherZone(supabase, user.id);
  const read = readProposalForm(formData, zone);
  if (!read.ok) return { ok: false, error: read.message };
  const { data, error } = await supabase.rpc("propose_lessons_to_student", {
    p_student: String(formData.get("student_id") ?? ""),
    p_starts: read.values.map((start) => start.toISOString()),
  });
  if (error) return { ok: false, error: refusalSentence(error.message) };
  refresh();
  revalidatePath("/teacher/students", "layout");
  sendProposalMailAfterResponse(data);
  return {
    ok: true,
    message: `Proposta enviada · ${lessonsLabel(read.values.length)}. Nada é debitado antes do aceite do aluno.`,
  };
}

/**
 * Her yes or no to a student's proposal (accept_lesson_proposal,
 * decline_lesson_proposal, 0057). On the yes the lessons are written and paid
 * from the student's balance, and their calendar invites go after the answer.
 */
export async function answerProposal(
  proposalId: string,
  answer: "accept" | "decline",
): Promise<AgendaResult> {
  const { supabase } = await requireTeacher();
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
    // The sentence of the ledger speaks to the student; here the balance
    // is hers, not the reader's.
    return {
      ok: false,
      error: error.message.includes("credits_not_negative")
        ? STUDENT_BALANCE_SHORT
        : refusalSentence(error.message),
    };
  }
  refresh();
  revalidatePath("/teacher/students", "layout");
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
        : `Proposta aceita · ${lessonsLabel(accepted.lesson_count)} marcada${accepted.lesson_count === 1 ? "" : "s"}, ${creditsLabel(accepted.credits_debited)} do saldo do aluno.`,
  };
}

/** Takes back a proposal she made, while it is open (0057). */
export async function withdrawProposal(
  proposalId: string,
): Promise<AgendaResult> {
  const { supabase } = await requireTeacher();
  const { error } = await supabase.rpc("withdraw_lesson_proposal", {
    p_proposal: proposalId,
  });
  if (error) return { ok: false, error: refusalSentence(error.message) };
  refresh();
  revalidatePath("/teacher/students", "layout");
  return { ok: true, message: "Proposta retirada." };
}
