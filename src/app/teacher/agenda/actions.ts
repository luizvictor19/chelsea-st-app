"use server";

import { revalidatePath } from "next/cache";

import { requireTeacher } from "@/lib/content/queries";
import {
  readProfileForm,
  readTimeOffForm,
  readWindowForm,
} from "@/lib/lessons/availability-form";
import { refusalSentence } from "@/lib/lessons/refusals";
import { lessonMinutesFrom } from "@/lib/lessons/rules";
import { creditsLabel } from "@/lib/lessons/slots";

import { instantIn } from "../students/agenda";
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
  return {
    ok: true,
    message:
      data > 0
        ? `Aula cancelada · ${creditsLabel(data)} de volta para o aluno.`
        : "Aula cancelada.",
  };
}
