/**
 * The rules of a student's agenda (#129) that do not need the database.
 *
 * Every function takes the zone as an argument, for the reason
 * src/lib/datetime.ts gives: a zone read from the host is how a lesson lands
 * on the wrong day.
 */

/** Indexed by `lesson_schedules.weekday`, where 0 is Sunday. */
export const WEEKDAYS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

/** How many weeks "Gerar aulas" reaches ahead. */
export const WEEKS_AHEAD = 8;

/** Below this many days of lessons ahead, the screen asks for more. */
export const WARN_DAYS = 14;

/** What the live lessons last (docs/context.md); the form starts here. */
export const DEFAULT_DURATION_MINUTES = 45;

export type LessonStatus = "scheduled" | "done" | "cancelled" | "no_show";

export type AgendaLesson = {
  readonly id: string;
  readonly scheduledAt: string;
  readonly status: LessonStatus;
};

export type Slot = { readonly weekday: number; readonly time: string };

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** The weekday and "HH:MM" an instant falls on in `timeZone`. */
export function slotOf(instant: Date, timeZone: string): Slot {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: string) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return {
    weekday: WEEKDAY_INDEX[part("weekday")],
    time: `${part("hour")}:${part("minute")}`,
  };
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

/**
 * The lessons that leave the agenda with a schedule: still scheduled, not
 * started, on its weekday and time in its zone. A lesson there and nowhere
 * else is the schedule's own; one moved to another hour stays.
 */
export function lessonsLeavingWith(
  schedule: {
    readonly weekday: number;
    readonly startTime: string;
    readonly timeZone: string;
  },
  lessons: readonly AgendaLesson[],
  now: Date,
): AgendaLesson[] {
  const time = schedule.startTime.slice(0, 5);
  return lessons.filter((row) => {
    const start = new Date(row.scheduledAt);
    if (row.status !== "scheduled" || start <= now) return false;
    const slot = slotOf(start, schedule.timeZone);
    return slot.weekday === schedule.weekday && slot.time === time;
  });
}

/** Whether the lessons generated so far end within WARN_DAYS, or never began. */
export function runsOutSoon(lastLesson: Date | null, now: Date): boolean {
  if (lastLesson === null) return true;
  return lastLesson.getTime() - now.getTime() < WARN_DAYS * 86_400_000;
}

/** "HH:MM" from a time input, or null. */
export function parseStartTime(raw: string): string | null {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : null;
}

/** "19h", "19h30": the hour as people say it. */
export function hourLabel(time: string): string {
  const [hour, minute] = time.split(":");
  return `${Number(hour)}h${minute === "00" ? "" : minute}`;
}

/** "Segunda, 19h · 45 min" */
export function scheduleLabel(
  weekday: number,
  startTime: string,
  durationMinutes: number,
): string {
  return `${WEEKDAYS[weekday]}, ${hourLabel(startTime)} · ${durationMinutes} min`;
}

/** What the database said when a schedule was not written. */
type ScheduleWriteFailure = {
  readonly code?: string;
  readonly message: string;
};

/**
 * The teacher's sentence for a schedule the database refused. The zone is
 * copied from her profile, and since 0048 (#219) a zone the server does not
 * know is refused on write: a name its tzdata dropped after she set it.
 * Anything else keeps the database's own message.
 */
export function scheduleWriteError(error: ScheduleWriteFailure): string {
  if (error.code === "23505") return "Esse horário já existe.";
  if (error.code === "23514" && error.message.includes("time zone")) {
    return "O fuso horário do seu perfil não é reconhecido. Nada foi salvo.";
  }
  return error.message;
}
