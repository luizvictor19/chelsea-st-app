"use server";

import { requireTeacher } from "@/lib/content/queries";
import { formatLessonDate, formatLessonTime } from "@/lib/datetime";

import { LESSON_MINUTES, lessonToMark } from "./stop";

export type StopResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly error: string };

/** Wider than any real lesson; lessonToMark does the exact test. */
const LONGEST_PLAUSIBLE_LESSON_MINUTES = 8 * 60;

/**
 * "Parei aqui": writes the point to the student's lesson running now or
 * starting within the hour, or creates a lesson for her now when there is
 * none (a lesson outside the agenda). Marking again overwrites. The answer
 * names the student, which is what makes a mark on the wrong one visible.
 *
 * The point comes by number, as the deck knows it: every point is common
 * today (measured 2026-10-30), with numbers unique across the course.
 */
export async function markStop(
  studentId: string,
  pointNumber: number,
): Promise<StopResult> {
  const { supabase, user } = await requireTeacher();
  const now = new Date();

  const [point, student, zone] = await Promise.all([
    supabase
      .from("points")
      .select("id")
      .eq("number", pointNumber)
      .is("school_id", null)
      .maybeSingle(),
    supabase
      .from("students")
      .select("school_id, profiles!inner(full_name)")
      .eq("id", studentId)
      .maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", user.id).single(),
  ]);
  if (point.error) return { ok: false, error: point.error.message };
  if (student.error) return { ok: false, error: student.error.message };
  if (zone.error) return { ok: false, error: zone.error.message };
  if (point.data === null) {
    return { ok: false, error: `O ponto ${pointNumber} não existe.` };
  }
  if (student.data === null) {
    return { ok: false, error: "Aluno não encontrado." };
  }
  const name = student.data.profiles.full_name;

  const earliest = new Date(
    now.getTime() - LONGEST_PLAUSIBLE_LESSON_MINUTES * 60_000,
  );
  const { data: lessons, error: lessonsError } = await supabase
    .from("lessons")
    .select("id, scheduled_at, duration_minutes")
    .eq("student_id", studentId)
    .eq("status", "scheduled")
    .gte("scheduled_at", earliest.toISOString());
  if (lessonsError) return { ok: false, error: lessonsError.message };

  const target = lessonToMark(
    lessons.map((row) => ({
      id: row.id,
      scheduledAt: row.scheduled_at,
      durationMinutes: row.duration_minutes,
    })),
    now,
  );

  if (target === null) {
    const { error } = await supabase.from("lessons").insert({
      student_id: studentId,
      school_id: student.data.school_id,
      scheduled_at: now.toISOString(),
      duration_minutes: LESSON_MINUTES,
      stopped_at_point_id: point.data.id,
    });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      message: `Marcado para ${name}: ponto ${pointNumber} · aula nova, de agora`,
    };
  }

  const { data: updated, error } = await supabase
    .from("lessons")
    .update({ stopped_at_point_id: point.data.id })
    .eq("id", target.id)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (updated.length === 0) {
    return { ok: false, error: "Nada foi gravado: a aula não foi encontrada." };
  }
  const start = new Date(target.scheduledAt);
  return {
    ok: true,
    message: `Marcado para ${name}: ponto ${pointNumber} · aula de ${formatLessonDate(start, zone.data.timezone)}, ${formatLessonTime(start, zone.data.timezone)}`,
  };
}
