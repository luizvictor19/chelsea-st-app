"use server";

import { revalidatePath } from "next/cache";

import { requireTeacher } from "@/lib/content/queries";

import {
  instantIn,
  lessonsLeavingWith,
  parseMeetUrl,
  parseStartTime,
  WEEKS_AHEAD,
} from "./agenda";
import { teacherZone } from "./queries";

export type AgendaResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly error: string };

type Supabase = Awaited<ReturnType<typeof requireTeacher>>["supabase"];

const UNIQUE_VIOLATION = "23505";

/** The list and every agenda under it read what these actions write. */
function refresh() {
  revalidatePath("/teacher/students", "layout");
}

function lessonsCreated(count: number): string {
  if (count === 0) return "nenhuma aula nova";
  return count === 1 ? "1 aula nova" : `${count} aulas novas`;
}

/** The student's school, which every row written for her carries. */
async function schoolOf(
  supabase: Supabase,
  studentId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("students")
    .select("school_id")
    .eq("id", studentId)
    .maybeSingle();
  return data?.school_id ?? null;
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
  return error === null ? data : error.message;
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
  const schoolId = await schoolOf(supabase, studentId);
  if (schoolId === null) {
    return { ok: false, error: "Nada foi salvo: aluna não encontrada." };
  }

  // The time is typed in the teacher's zone, so the schedule lives there too.
  const { error } = await supabase.from("lesson_schedules").insert({
    student_id: studentId,
    school_id: schoolId,
    weekday,
    start_time: time,
    timezone: await teacherZone(supabase, user.id),
    duration_minutes: durationMinutes,
  });
  if (error) {
    return {
      ok: false,
      error:
        error.code === UNIQUE_VIOLATION
          ? "Esse horário já existe."
          : error.message,
    };
  }
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

export async function cancelLesson(lessonId: string): Promise<AgendaResult> {
  const { supabase } = await requireTeacher();
  const { data, error } = await supabase
    .from("lessons")
    .update({ status: "cancelled" })
    .eq("id", lessonId)
    .eq("status", "scheduled")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (data.length === 0) {
    return { ok: false, error: "Essa aula já não estava agendada." };
  }
  refresh();
  return { ok: true, message: "Aula cancelada." };
}

/**
 * Moves a lesson by creating the new one first and cancelling the original
 * after. Should the cancel fail, she sees two lessons and the teacher reads
 * the error; the other order could leave her with none and nobody told. The
 * original keeps its row, cancelled, so its slot never comes back from
 * materialize_lessons.
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
      "student_id, school_id, scheduled_at, duration_minutes, meet_url, status",
    )
    .eq("id", lessonId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (original === null || original.status !== "scheduled") {
    return { ok: false, error: "Essa aula já não está agendada." };
  }

  const start = instantIn(date, time, await teacherZone(supabase, user.id));
  if (start.getTime() === new Date(original.scheduled_at).getTime()) {
    return { ok: false, error: "A aula já está nesse horário." };
  }
  if (start <= new Date()) {
    return { ok: false, error: "Escolha um horário que ainda não passou." };
  }

  const { error: insertError } = await supabase.from("lessons").insert({
    student_id: original.student_id,
    school_id: original.school_id,
    scheduled_at: start.toISOString(),
    duration_minutes: original.duration_minutes,
    meet_url: original.meet_url,
  });
  if (insertError) {
    return {
      ok: false,
      error:
        insertError.code === UNIQUE_VIOLATION
          ? "A aluna já tem aula nesse horário."
          : insertError.message,
    };
  }
  refresh();

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
