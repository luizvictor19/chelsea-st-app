import { notFound } from "next/navigation";

import { requireTeacher } from "@/lib/content/queries";

import type { AgendaLesson } from "./agenda";

type Supabase = Awaited<ReturnType<typeof requireTeacher>>["supabase"];

/**
 * Wider than any real lesson. Only narrows the rows fetched, as on
 * /dashboard: a lesson still running is cut by its own duration below.
 */
const LONGEST_PLAUSIBLE_LESSON_MINUTES = 8 * 60;

export type UpcomingLesson = AgendaLesson & {
  readonly durationMinutes: number;
};

export type StudentRow = {
  readonly id: string;
  readonly name: string;
  readonly meetUrl: string | null;
  readonly scheduleCount: number;
  readonly next: string | null;
  readonly last: string | null;
};

export type Schedule = {
  readonly id: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly timeZone: string;
  readonly durationMinutes: number;
};

export type StudentAgenda = {
  readonly id: string;
  readonly name: string;
  readonly meetUrl: string | null;
  readonly schedules: readonly Schedule[];
  /** Scheduled, not finished yet, soonest first. */
  readonly upcoming: readonly UpcomingLesson[];
};

/** The zone the teacher reads and types times in. */
export async function teacherZone(
  supabase: Supabase,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .single();
  if (error) throw new Error(error.message);
  return data.timezone;
}

/** Lessons still ahead, the one running now included. */
async function readUpcoming(
  supabase: Supabase,
  now: Date,
  studentId: string | null,
): Promise<(UpcomingLesson & { studentId: string })[]> {
  const earliest = new Date(
    now.getTime() - LONGEST_PLAUSIBLE_LESSON_MINUTES * 60_000,
  );
  let query = supabase
    .from("lessons")
    .select("id, student_id, scheduled_at, duration_minutes, status")
    .eq("status", "scheduled")
    .gte("scheduled_at", earliest.toISOString())
    .order("scheduled_at", { ascending: true });
  if (studentId !== null) query = query.eq("student_id", studentId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data
    .filter(
      (row) =>
        new Date(row.scheduled_at).getTime() + row.duration_minutes * 60_000 >
        now.getTime(),
    )
    .map((row) => ({
      id: row.id,
      studentId: row.student_id,
      scheduledAt: row.scheduled_at,
      status: row.status,
      durationMinutes: row.duration_minutes,
    }));
}

/** Every active student the reader teaches, by name. RLS decides which. */
export async function listStudents(
  supabase: Supabase,
  now: Date,
): Promise<StudentRow[]> {
  const [students, schedules, upcoming] = await Promise.all([
    supabase
      .from("students")
      .select("id, meet_url, profiles!inner(full_name)")
      .eq("is_active", true),
    supabase.from("lesson_schedules").select("student_id"),
    readUpcoming(supabase, now, null),
  ]);
  if (students.error) throw new Error(students.error.message);
  if (schedules.error) throw new Error(schedules.error.message);

  return students.data
    .map((student) => {
      const own = upcoming.filter((row) => row.studentId === student.id);
      return {
        id: student.id,
        name: student.profiles.full_name,
        meetUrl: student.meet_url,
        scheduleCount: schedules.data.filter(
          (row) => row.student_id === student.id,
        ).length,
        next: own.at(0)?.scheduledAt ?? null,
        last: own.at(-1)?.scheduledAt ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** One student's agenda, or the not-found page for an id RLS hides. */
export async function readAgenda(
  supabase: Supabase,
  studentId: string,
  now: Date,
): Promise<StudentAgenda> {
  const [student, schedules, upcoming] = await Promise.all([
    supabase
      .from("students")
      .select("id, meet_url, profiles!inner(full_name)")
      .eq("id", studentId)
      .maybeSingle(),
    supabase
      .from("lesson_schedules")
      .select("id, weekday, start_time, timezone, duration_minutes")
      .eq("student_id", studentId)
      .order("weekday")
      .order("start_time"),
    readUpcoming(supabase, now, studentId),
  ]);
  if (student.error) throw new Error(student.error.message);
  if (schedules.error) throw new Error(schedules.error.message);
  if (student.data === null) notFound();

  return {
    id: student.data.id,
    name: student.data.profiles.full_name,
    meetUrl: student.data.meet_url,
    schedules: schedules.data.map((row) => ({
      id: row.id,
      weekday: row.weekday,
      startTime: row.start_time,
      timeZone: row.timezone,
      durationMinutes: row.duration_minutes,
    })),
    upcoming,
  };
}
