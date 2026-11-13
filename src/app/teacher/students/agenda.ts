/**
 * The dates of the teacher's agenda that do not need the database.
 *
 * Every function takes the zone as an argument, for the reason
 * src/lib/datetime.ts gives: a zone read from the host is how a lesson lands
 * on the wrong day.
 */

/** Indexed by `teacher_availability.weekday`, where 0 is Sunday. */
export const WEEKDAYS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

export type LessonStatus = "scheduled" | "done" | "cancelled" | "no_show";

export type AgendaLesson = {
  readonly id: string;
  readonly scheduledAt: string;
  readonly status: LessonStatus;
  readonly organizationId: string;
  readonly teacherId: string;
};

/** What the reader may do to a lesson she sees, by cancel_lesson (0054). */
export type CancelRights = {
  readonly platformAdmin: boolean;
  /** Organizations she is an admin of. */
  readonly adminOf: ReadonlySet<string>;
  /** Her rows of teachers, one per organization she teaches in. */
  readonly teacherRows: ReadonlySet<string>;
};

/**
 * Whether cancel_lesson lets the reader cancel the lesson: its teacher, the
 * admin of its organization, or the platform admin. Another teacher of the
 * organization reads the lesson (lessons_read) and writes its note, but does
 * not cancel it, so the screen does not offer it.
 */
export function mayCancel(
  rights: CancelRights,
  lesson: Pick<AgendaLesson, "organizationId" | "teacherId">,
): boolean {
  return (
    rights.platformAdmin ||
    rights.adminOf.has(lesson.organizationId) ||
    rights.teacherRows.has(lesson.teacherId)
  );
}

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant of a wall-clock date ("YYYY-MM-DD") and time ("HH:MM") in
 * `timeZone`. The offset is read twice: the first guess can sit on the other
 * side of a DST change from the answer.
 */
export function instantIn(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetAt(new Date(wall), timeZone);
  return new Date(wall - offsetAt(new Date(first), timeZone));
}
