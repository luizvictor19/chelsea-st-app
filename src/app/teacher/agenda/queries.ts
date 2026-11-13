import type { requireTeacher } from "@/lib/content/queries";

import { progressOf, type Mark, type Progress } from "../students/progress";

type Supabase = Awaited<ReturnType<typeof requireTeacher>>["supabase"];

/** An organization she teaches in (teaches_in, 0042), with her role there. */
export type Teachable = {
  readonly organizationId: string;
  readonly name: string;
  readonly role: "teacher" | "admin";
};

/** Her row of teachers (0052) in one organization. */
export type TeacherProfile = {
  readonly id: string;
  readonly organizationId: string;
  readonly meetUrl: string | null;
  readonly calendarEmail: string | null;
  readonly isActive: boolean;
};

export type Window = {
  readonly id: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly timeZone: string;
};

export type TimeOff = {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
};

export type BookedLesson = {
  readonly id: string;
  readonly studentName: string;
  readonly scheduledAt: string;
  readonly durationMinutes: number;
  readonly creditsDebited: number;
  /** Where the student stopped, by the last "Parei aqui" (progressOf). */
  readonly progress: Progress | null;
  /** The last note written on a lesson of hers. */
  readonly lastNote: string | null;
};

export type TeacherAgenda = {
  readonly teachable: readonly Teachable[];
  /** Her row in the first organization she teaches in, or null before it. */
  readonly profile: TeacherProfile | null;
  readonly windows: readonly Window[];
  readonly timeOff: readonly TimeOff[];
  /** Her booked lessons not finished yet, soonest first. */
  readonly lessons: readonly BookedLesson[];
};

/**
 * Where she teaches: as a teacher, or as an admin where the organization has
 * a teacher. A person who is both in one organization teaches as the teacher.
 */
async function readTeachable(
  supabase: Supabase,
  userId: string,
): Promise<Teachable[]> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id, role, organizations!inner(name, has_teacher)")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const byOrganization = new Map<string, Teachable>();
  for (const row of data) {
    const teaches =
      row.role === "teacher" ||
      (row.role === "admin" && row.organizations.has_teacher);
    if (!teaches) continue;
    const known = byOrganization.get(row.organization_id);
    if (known?.role === "teacher") continue;
    byOrganization.set(row.organization_id, {
      organizationId: row.organization_id,
      name: row.organizations.name,
      role: row.role === "teacher" ? "teacher" : "admin",
    });
  }
  return [...byOrganization.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
}

/** Her profile, hours and booked lessons, as RLS gives them to her. */
export async function readTeacherAgenda(
  supabase: Supabase,
  userId: string,
  now: Date,
): Promise<TeacherAgenda> {
  const [teachable, rows] = await Promise.all([
    readTeachable(supabase, userId),
    supabase
      .from("teachers")
      .select("id, organization_id, meet_url, calendar_email, is_active")
      .eq("user_id", userId),
  ]);
  if (rows.error) throw new Error(rows.error.message);

  const first = teachable[0];
  const row =
    first === undefined
      ? undefined
      : rows.data.find((r) => r.organization_id === first.organizationId);
  if (row === undefined) {
    return { teachable, profile: null, windows: [], timeOff: [], lessons: [] };
  }
  const profile: TeacherProfile = {
    id: row.id,
    organizationId: row.organization_id,
    meetUrl: row.meet_url,
    calendarEmail: row.calendar_email,
    isActive: row.is_active,
  };

  const [windows, timeOff, lessons] = await Promise.all([
    supabase
      .from("teacher_availability")
      .select("id, weekday, start_time, end_time, timezone")
      .eq("teacher_id", profile.id)
      .order("weekday")
      .order("start_time"),
    supabase
      .from("teacher_time_off")
      .select("id, starts_at, ends_at")
      .eq("teacher_id", profile.id)
      .gt("ends_at", now.toISOString())
      .order("starts_at"),
    readBooked(supabase, profile.id, now),
  ]);
  if (windows.error) throw new Error(windows.error.message);
  if (timeOff.error) throw new Error(timeOff.error.message);

  return {
    teachable,
    profile,
    windows: windows.data.map((w) => ({
      id: w.id,
      weekday: w.weekday,
      startTime: w.start_time.slice(0, 5),
      endTime: w.end_time.slice(0, 5),
      timeZone: w.timezone,
    })),
    timeOff: timeOff.data.map((t) => ({
      id: t.id,
      startsAt: t.starts_at,
      endsAt: t.ends_at,
    })),
    lessons,
  };
}

/**
 * Wider than any real lesson, as on /teacher/students: only narrows the rows
 * fetched; a lesson still running is cut by its own duration below.
 */
const LONGEST_PLAUSIBLE_LESSON_MINUTES = 8 * 60;

/** Her scheduled lessons not finished, with where each student stopped. */
async function readBooked(
  supabase: Supabase,
  teacherId: string,
  now: Date,
): Promise<BookedLesson[]> {
  const earliest = new Date(
    now.getTime() - LONGEST_PLAUSIBLE_LESSON_MINUTES * 60_000,
  );
  const { data, error } = await supabase
    .from("lessons")
    .select("id, student_id, scheduled_at, duration_minutes, credits_debited")
    .eq("teacher_id", teacherId)
    .eq("status", "scheduled")
    .gte("scheduled_at", earliest.toISOString())
    .order("scheduled_at", { ascending: true });
  if (error) throw new Error(error.message);
  const ahead = data.filter(
    (row) =>
      new Date(row.scheduled_at).getTime() + row.duration_minutes * 60_000 >
      now.getTime(),
  );
  const studentIds = [...new Set(ahead.map((row) => row.student_id))];
  if (studentIds.length === 0) return [];

  const [students, marks, notes] = await Promise.all([
    supabase
      .from("students")
      .select("id, profiles!inner(full_name)")
      .in("id", studentIds),
    supabase
      .from("lessons")
      .select(
        "student_id, scheduled_at, points!lessons_stopped_at_point_fkey(number, books!inner(position, last_point))",
      )
      .in("student_id", studentIds)
      .not("stopped_at_point_id", "is", null),
    supabase
      .from("lessons")
      .select("student_id, teacher_note, scheduled_at")
      .in("student_id", studentIds)
      .not("teacher_note", "is", null)
      .order("scheduled_at", { ascending: false }),
  ]);
  if (students.error) throw new Error(students.error.message);
  if (marks.error) throw new Error(marks.error.message);
  if (notes.error) throw new Error(notes.error.message);

  const names = new Map(
    students.data.map((row) => [row.id, row.profiles.full_name]),
  );
  const markRows: (Mark & { studentId: string })[] = marks.data.flatMap(
    (row) =>
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

  return ahead.map((row) => ({
    id: row.id,
    studentName: names.get(row.student_id) ?? "Aluno",
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
    creditsDebited: row.credits_debited,
    progress: progressOf(
      markRows.filter((mark) => mark.studentId === row.student_id),
    ),
    lastNote:
      notes.data.find((note) => note.student_id === row.student_id)
        ?.teacher_note ?? null,
  }));
}
