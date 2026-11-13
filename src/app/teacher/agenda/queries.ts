import { inviteWarnings } from "@/lib/calendar/invite-status";
import type { requireTeacher } from "@/lib/content/queries";

import { progressOf, type Progress } from "../students/progress";
import {
  LONGEST_PLAUSIBLE_LESSON_MINUTES,
  readMarks,
} from "../students/queries";

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
  /** The calendar invites that did not go (#294), as the screen says it. */
  readonly inviteWarnings: readonly string[];
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

  const [students, marks, notes, invites] = await Promise.all([
    supabase
      .from("students")
      .select("id, profiles!inner(full_name)")
      .in("id", studentIds),
    readMarks(supabase, studentIds),
    // The latest notes first; a few per student is enough to find the last.
    supabase
      .from("lessons")
      .select("student_id, teacher_note")
      .in("student_id", studentIds)
      .not("teacher_note", "is", null)
      .order("scheduled_at", { ascending: false })
      .limit(NOTES_READ_PER_STUDENT * studentIds.length),
    // Whoever teaches reads the state of the invites (0056), no address.
    supabase
      .from("calendar_invites")
      .select("lesson_id, method, recipient, status, last_error")
      .in(
        "lesson_id",
        ahead.map((row) => row.id),
      ),
  ]);
  if (students.error) throw new Error(students.error.message);
  if (notes.error) throw new Error(notes.error.message);
  // The warnings are an aside: a failed read leaves them out, not the agenda.
  const inviteRows = invites.error ? [] : invites.data;

  const names = new Map(
    students.data.map((row) => [row.id, row.profiles.full_name]),
  );
  return ahead.map((row) => ({
    id: row.id,
    studentName: names.get(row.student_id) ?? "Aluno",
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
    creditsDebited: row.credits_debited,
    progress: progressOf(
      marks.filter((mark) => mark.studentId === row.student_id),
    ),
    lastNote:
      notes.data.find((note) => note.student_id === row.student_id)
        ?.teacher_note ?? null,
    inviteWarnings: inviteWarnings(
      inviteRows.filter((invite) => invite.lesson_id === row.id),
    ),
  }));
}

/**
 * How many noted lessons per student the screen reads, newest first: a
 * bounded read. A student's last note is missed only when the others in the
 * list wrote more than this many notes, together, after it.
 */
const NOTES_READ_PER_STUDENT = 5;
