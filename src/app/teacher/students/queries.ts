import { notFound } from "next/navigation";

import { requireTeacher } from "@/lib/content/queries";

import type { AgendaLesson, CancelRights } from "./agenda";
import { progressOf, type Mark, type Progress } from "./progress";
import { taught } from "./taught";

type Supabase = Awaited<ReturnType<typeof requireTeacher>>["supabase"];

/**
 * Wider than any real lesson. Only narrows the rows fetched, as on
 * /dashboard: a lesson still running is cut by its own duration below.
 */
export const LONGEST_PLAUSIBLE_LESSON_MINUTES = 8 * 60;

export type UpcomingLesson = AgendaLesson & {
  readonly durationMinutes: number;
};

export type StudentRow = {
  readonly id: string;
  readonly name: string;
  readonly next: string | null;
  readonly progress: Progress | null;
};

export type StudentAgenda = {
  readonly id: string;
  readonly name: string;
  /** Scheduled, not finished yet, soonest first. */
  readonly upcoming: readonly UpcomingLesson[];
  readonly progress: Progress | null;
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
    .select(
      "id, student_id, organization_id, teacher_id, scheduled_at, duration_minutes, status",
    )
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
      organizationId: row.organization_id,
      teacherId: row.teacher_id,
      scheduledAt: row.scheduled_at,
      status: row.status,
      durationMinutes: row.duration_minutes,
    }));
}

/** Her rows of teachers and the organizations she is an admin of. */
export async function readCancelRights(
  supabase: Supabase,
  userId: string,
  platformAdmin: boolean,
): Promise<CancelRights> {
  const [rows, admin] = await Promise.all([
    supabase.from("teachers").select("id").eq("user_id", userId),
    supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .eq("role", "admin"),
  ]);
  if (rows.error) throw new Error(rows.error.message);
  if (admin.error) throw new Error(admin.error.message);
  return {
    platformAdmin,
    adminOf: new Set(admin.data.map((row) => row.organization_id)),
    teacherRows: new Set(rows.data.map((row) => row.id)),
  };
}

/**
 * Every lesson with "Parei aqui" marked, of any status, by student; of the
 * students named only, when named (/teacher/agenda).
 */
export async function readMarks(
  supabase: Supabase,
  studentIds?: readonly string[],
): Promise<(Mark & { studentId: string })[]> {
  let query = supabase
    .from("lessons")
    .select(
      "student_id, scheduled_at, points!lessons_stopped_at_point_fkey(number, books!inner(position, last_point))",
    )
    .not("stopped_at_point_id", "is", null);
  if (studentIds !== undefined) query = query.in("student_id", studentIds);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data.flatMap((row) =>
    row.points === null
      ? []
      : [
          {
            studentId: row.student_id,
            scheduledAt: row.scheduled_at,
            book: row.points.books.position,
            point: row.points.number,
            lastPoint: row.points.books.last_point,
          },
        ],
  );
}

/**
 * Every active student the reader teaches, by name: RLS decides which rows,
 * and only those of an organization with a teacher stay (#362).
 */
export async function listStudents(
  supabase: Supabase,
  now: Date,
): Promise<StudentRow[]> {
  const [students, upcoming, marks] = await Promise.all([
    supabase
      .from("students")
      .select("id, profiles!inner(full_name), organizations!inner(has_teacher)")
      .eq("is_active", true),
    readUpcoming(supabase, now, null),
    readMarks(supabase),
  ]);
  if (students.error) throw new Error(students.error.message);

  return taught(students.data)
    .map((student) => {
      const own = upcoming.filter((row) => row.studentId === student.id);
      return {
        id: student.id,
        name: student.profiles.full_name,
        next: own.at(0)?.scheduledAt ?? null,
        progress: progressOf(
          marks.filter((row) => row.studentId === student.id),
        ),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * One student's booked lessons and where she stopped, or the not-found page
 * for an id RLS hides.
 */
export async function readAgenda(
  supabase: Supabase,
  studentId: string,
  now: Date,
): Promise<StudentAgenda> {
  const [student, upcoming, marks] = await Promise.all([
    supabase
      .from("students")
      .select("id, profiles!inner(full_name), organizations!inner(has_teacher)")
      .eq("id", studentId)
      .maybeSingle(),
    readUpcoming(supabase, now, studentId),
    readMarks(supabase, [studentId]),
  ]);
  if (student.error) throw new Error(student.error.message);
  // An employee's row is no student's agenda (#362).
  if (student.data === null || taught([student.data]).length === 0) {
    notFound();
  }

  return {
    id: student.data.id,
    name: student.data.profiles.full_name,
    upcoming,
    progress: progressOf(marks),
  };
}
