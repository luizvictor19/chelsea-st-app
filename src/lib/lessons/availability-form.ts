/**
 * The teacher's booking forms on /teacher/agenda (#276), read and checked
 * before the database does: her profile (teachers), a weekly window
 * (teacher_availability) and a time off (teacher_time_off), with the same
 * rules as their checks in 0052, said in Portuguese. The length of a lesson
 * is not copied here: the caller passes the one lesson_rules() gives.
 */

import { parseMeetUrl } from "./meet-url.ts";

/** The shape teachers_calendar_email_shape checks. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TIME = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Read<T> =
  | { readonly ok: true; readonly values: T }
  | { readonly ok: false; readonly message: string };

export type ProfileValues = {
  readonly meetUrl: string | null;
  readonly calendarEmail: string | null;
  readonly isActive: boolean;
};

/** Her Meet, her calendar e-mail and whether she takes bookings. */
export function readProfileForm(form: FormData): Read<ProfileValues> {
  const meet = parseMeetUrl(String(form.get("meet_url") ?? ""));
  if (!meet.ok) return { ok: false, message: meet.error };
  const email = String(form.get("calendar_email") ?? "").trim();
  if (email !== "" && !EMAIL.test(email)) {
    return { ok: false, message: "Confira o e-mail da agenda." };
  }
  const isActive = form.get("is_active") === "on";
  if (isActive && (meet.url === null || email === "")) {
    return {
      ok: false,
      message:
        "Para aceitar reservas, preencha o link do Meet e o e-mail da agenda.",
    };
  }
  return {
    ok: true,
    values: {
      meetUrl: meet.url,
      calendarEmail: email === "" ? null : email,
      isActive,
    },
  };
}

export type WindowValues = {
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
};

function minutesOf(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

/**
 * A weekly window: a weekday (0 is Sunday), a start and an end on that day,
 * the end after the start (24:00 closes the day) and room for one lesson.
 */
export function readWindowForm(
  form: FormData,
  lessonMinutes: number,
): Read<WindowValues> {
  const weekdayText = String(form.get("weekday") ?? "");
  const weekday = /^[0-6]$/.test(weekdayText) ? Number(weekdayText) : null;
  if (weekday === null) {
    return { ok: false, message: "Escolha o dia da semana." };
  }
  const startTime = String(form.get("start_time") ?? "");
  const endTime = String(form.get("end_time") ?? "");
  if (!TIME.test(startTime) || startTime === "24:00" || !TIME.test(endTime)) {
    return { ok: false, message: "Escolha o início e o fim." };
  }
  const length = minutesOf(endTime) - minutesOf(startTime);
  if (length <= 0) {
    return {
      ok: false,
      message: "O fim da janela precisa vir depois do início.",
    };
  }
  if (length < lessonMinutes) {
    return {
      ok: false,
      message: `A janela precisa caber uma aula de ${lessonMinutes} min.`,
    };
  }
  return { ok: true, values: { weekday, startTime, endTime } };
}

export type TimeOffValues = {
  /** The first day off, "YYYY-MM-DD". */
  readonly fromDate: string;
  /** The day after the last day off, where the time off ends. */
  readonly untilDate: string;
};

function isDate(text: string): boolean {
  if (!DATE.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function nextDay(text: string): string {
  const [year, month, day] = text.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

/** Whole days off, from the first to the last, both included. */
export function readTimeOffForm(form: FormData): Read<TimeOffValues> {
  const from = String(form.get("from") ?? "");
  const to = String(form.get("to") ?? "") || from;
  if (!isDate(from) || !isDate(to)) {
    return { ok: false, message: "Escolha o primeiro e o último dia." };
  }
  if (to < from) {
    return {
      ok: false,
      message: "O último dia da folga não pode vir antes do primeiro.",
    };
  }
  return { ok: true, values: { fromDate: from, untilDate: nextDay(to) } };
}
