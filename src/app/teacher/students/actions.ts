"use server";

import { revalidatePath } from "next/cache";

import { requireTeacher } from "@/lib/content/queries";
import { parseMeetUrl } from "@/lib/lessons/meet-url";
import { refusalSentence } from "@/lib/lessons/refusals";
import { creditsLabel } from "@/lib/lessons/slots";

import {
  instantIn,
  lessonsLeavingWith,
  parseStartTime,
  scheduleWriteError,
  WEEKS_AHEAD,
} from "./agenda";
import { teacherZone } from "./queries";

export type AgendaResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly error: string };

type Supabase = Awaited<ReturnType<typeof requireTeacher>>["supabase"];

const UNIQUE_VIOLATION = "23505";
/** Two lessons of hers that cross (lessons_student_no_overlap, 0052). */
const EXCLUSION_VIOLATION = "23P01";

/** The list and every agenda under it read what these actions write. */
function refresh() {
  revalidatePath("/teacher/students", "layout");
}

function lessonsCreated(count: number): string {
  if (count === 0) return "nenhuma aula nova";
  return count === 1 ? "1 aula nova" : `${count} aulas novas`;
}

/** The student's organization, which every row written for her carries. */
async function organizationOf(
  supabase: Supabase,
  studentId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("students")
    .select("organization_id")
    .eq("id", studentId)
    .maybeSingle();
  return data?.organization_id ?? null;
}

/**
 * Creates the lessons of her schedules up to WEEKS_AHEAD (0003). Never
 * duplicates: a slot that already holds a lesson, cancelled included, is
 * skipped, which is what keeps a lesson called off from coming back.
 */
async function materialize(
  supabase: Supabase,
  studentId: string,
): Promise<number | string> {
  const { data, error } = await supabase.rpc("materialize_lessons", {
    p_student_id: studentId,
    p_weeks: WEEKS_AHEAD,
  });
  if (error === null) return data;
  // materialize_lessons writes every occurrence in one statement, and since
  // 0052 one that crosses a lesson the student booked refuses all of them
  // (lessons_student_no_overlap). Said, so the teacher knows which lesson
  // to move; #295 retires the generation.
  return error.code === EXCLUSION_VIOLATION
    ? "uma aula do horário cruza uma aula que a aluna reservou; cancele uma das duas e gere de novo"
    : error.message;
}

export async function saveMeetUrl(
  studentId: string,
  raw: string,
): Promise<AgendaResult> {
  const { supabase } = await requireTeacher();
  const parsed = parseMeetUrl(raw);
  if (!parsed.ok) return parsed;

  const { data, error } = await supabase
    .from("students")
    .update({ meet_url: parsed.url })
    .eq("id", studentId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (data.length === 0) {
    return { ok: false, error: "Nada foi salvo: aluna não encontrada." };
  }
  refresh();
  return {
    ok: true,
    message: parsed.url === null ? "Link do Meet apagado." : "Link salvo.",
  };
}

export async function addSchedule(
  studentId: string,
  weekday: number,
  rawTime: string,
  durationMinutes: number,
): Promise<AgendaResult> {
  const { supabase, user } = await requireTeacher();
  const time = parseStartTime(rawTime);
  if (time === null) return { ok: false, error: "Escolha a hora." };
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return { ok: false, error: "Escolha o dia da semana." };
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return { ok: false, error: "A duração precisa ser em minutos inteiros." };
  }
  const organizationId = await organizationOf(supabase, studentId);
  if (organizationId === null) {
    return { ok: false, error: "Nada foi salvo: aluna não encontrada." };
  }

  // The time is typed in the teacher's zone, so the schedule lives there too.
  const { error } = await supabase.from("lesson_schedules").insert({
    student_id: studentId,
    organization_id: organizationId,
    weekday,
    start_time: time,
    timezone: await teacherZone(supabase, user.id),
    duration_minutes: durationMinutes,
  });
  if (error) return { ok: false, error: scheduleWriteError(error) };
  refresh();

  const created = await materialize(supabase, studentId);
  if (typeof created === "string") {
    return {
      ok: false,
      error: `Horário salvo, mas as aulas não foram geradas (${created}). Use Gerar aulas.`,
    };
  }
  return { ok: true, message: `Horário salvo · ${lessonsCreated(created)}.` };
}

/**
 * Removes a schedule and deletes its lessons still ahead. Deleted and not
 * cancelled: a cancelled row keeps its slot from materialize_lessons, so a
 * schedule added back at the same hour would generate nothing, silently.
 * The schedule goes first; if the lessons then fail, they stay on the agenda
 * where the teacher sees them, and the message says so.
 */
export async function removeSchedule(
  scheduleId: string,
): Promise<AgendaResult> {
  const { supabase } = await requireTeacher();
  const { data: schedule, error: readError } = await supabase
    .from("lesson_schedules")
    .select("student_id, weekday, start_time, timezone")
    .eq("id", scheduleId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (schedule === null) {
    return { ok: false, error: "Esse horário já não existe." };
  }

  const now = new Date();
  const { data: ahead, error: aheadError } = await supabase
    .from("lessons")
    .select("id, scheduled_at, status")
    .eq("student_id", schedule.student_id)
    .eq("status", "scheduled")
    // A booked lesson (0052) is not the schedule's: it stays.
    .is("teacher_id", null)
    .gt("scheduled_at", now.toISOString());
  if (aheadError) return { ok: false, error: aheadError.message };

  const leaving = lessonsLeavingWith(
    {
      weekday: schedule.weekday,
      startTime: schedule.start_time,
      timeZone: schedule.timezone,
    },
    ahead.map((row) => ({
      id: row.id,
      scheduledAt: row.scheduled_at,
      status: row.status,
    })),
    now,
  );

  const { error: deleteError } = await supabase
    .from("lesson_schedules")
    .delete()
    .eq("id", scheduleId);
  if (deleteError) return { ok: false, error: deleteError.message };
  refresh();

  if (leaving.length === 0) {
    return { ok: true, message: "Horário removido." };
  }
  const { error: lessonsError } = await supabase
    .from("lessons")
    .delete()
    .in(
      "id",
      leaving.map((row) => row.id),
    );
  if (lessonsError) {
    return {
      ok: false,
      error: `Horário removido, mas as aulas dele continuam na agenda (${lessonsError.message}). Cancele uma a uma.`,
    };
  }
  const count = leaving.length;
  return {
    ok: true,
    message: `Horário removido · ${count === 1 ? "1 aula futura saiu" : `${count} aulas futuras saíram`} da agenda.`,
  };
}

export async function generateLessons(
  studentId: string,
): Promise<AgendaResult> {
  const { supabase } = await requireTeacher();
  const created = await materialize(supabase, studentId);
  if (typeof created === "string") return { ok: false, error: created };
  refresh();
  const text = lessonsCreated(created);
  return { ok: true, message: text[0].toUpperCase() + text.slice(1) + "." };
}

/**
 * Cancels through cancel_lesson (0052), as /teacher/agenda does: a lesson of
 * the fixed agenda is cancelled by whoever teaches there, as before, and a
 * booked one gives the student's credits back. Since 0052 a booked lesson
 * no longer changes by a direct update.
 */
export async function cancelLesson(lessonId: string): Promise<AgendaResult> {
  const { supabase } = await requireTeacher();
  const { data, error } = await supabase.rpc("cancel_lesson", {
    p_lesson: lessonId,
  });
  if (error) return { ok: false, error: refusalSentence(error.message) };
  refresh();
  revalidatePath("/teacher/agenda");
  return {
    ok: true,
    message:
      data > 0
        ? `Aula cancelada · ${creditsLabel(data)} de volta para o aluno.`
        : "Aula cancelada.",
  };
}

/**
 * Moves a lesson by creating the new one first and cancelling the original
 * after. Should the cancel fail, she sees two lessons and the teacher reads
 * the error; the other order could leave her with none and nobody told. The
 * original keeps its row, cancelled, so its slot never comes back from
 * materialize_lessons. A move shorter than the lesson's length cancels
 * first (lessons_student_no_overlap, 0052), and says so if the new one fails.
 */
export async function rescheduleLesson(
  lessonId: string,
  date: string,
  rawTime: string,
): Promise<AgendaResult> {
  const { supabase, user } = await requireTeacher();
  const time = parseStartTime(rawTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || time === null) {
    return { ok: false, error: "Escolha a nova data e a hora." };
  }

  const { data: original, error: readError } = await supabase
    .from("lessons")
    .select(
      "student_id, organization_id, scheduled_at, duration_minutes, meet_url, status, teacher_id",
    )
    .eq("id", lessonId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (original === null || original.status !== "scheduled") {
    return { ok: false, error: "Essa aula já não está agendada." };
  }
  // A booked lesson (0052) is moved by cancelling it and booking again: its
  // credits go back through cancel_lesson, never by hand.
  if (original.teacher_id !== null) {
    return {
      ok: false,
      error:
        "Aula reservada: cancele, e o aluno reserva outro horário com os créditos de volta.",
    };
  }

  const start = instantIn(date, time, await teacherZone(supabase, user.id));
  if (start.getTime() === new Date(original.scheduled_at).getTime()) {
    return { ok: false, error: "A aula já está nesse horário." };
  }
  if (start <= new Date()) {
    return { ok: false, error: "Escolha um horário que ainda não passou." };
  }

  // A move inside the lesson's own length would cross the original, which
  // lessons_student_no_overlap (0052) refuses while both are scheduled. Then
  // the original is cancelled first, and a failed insert says so: she is
  // left without the lesson, and the teacher reads it.
  const originalStart = new Date(original.scheduled_at).getTime();
  const length = original.duration_minutes * 60_000;
  const crosses =
    start.getTime() < originalStart + length &&
    start.getTime() + length > originalStart;
  if (crosses) {
    const { error: cancelError } = await supabase
      .from("lessons")
      .update({ status: "cancelled" })
      .eq("id", lessonId);
    if (cancelError) return { ok: false, error: cancelError.message };
  }

  const { error: insertError } = await supabase.from("lessons").insert({
    student_id: original.student_id,
    organization_id: original.organization_id,
    scheduled_at: start.toISOString(),
    duration_minutes: original.duration_minutes,
    meet_url: original.meet_url,
  });
  if (insertError) {
    const reason =
      insertError.code === UNIQUE_VIOLATION ||
      insertError.code === EXCLUSION_VIOLATION
        ? "A aluna já tem aula nesse horário."
        : insertError.message;
    if (crosses) refresh();
    return {
      ok: false,
      error: crosses
        ? `A aula original foi cancelada, mas a nova não foi criada (${reason}) Crie a aula de novo.`
        : reason,
    };
  }
  refresh();
  if (crosses) return { ok: true, message: "Aula remarcada." };

  const { error: cancelError } = await supabase
    .from("lessons")
    .update({ status: "cancelled" })
    .eq("id", lessonId);
  if (cancelError) {
    return {
      ok: false,
      error: `A aula nova foi criada, mas a original não foi cancelada (${cancelError.message}). Cancele a original.`,
    };
  }
  return { ok: true, message: "Aula remarcada." };
}
