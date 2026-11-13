/**
 * The form of a lesson proposal (#319), read before the database does: one
 * lesson (a day and a time) or a series (weekdays, a time, a first and a last
 * day), turned into the instants of each lesson in the zone of whoever
 * proposes. The rule of a series is never stored: the database receives the
 * instants, as lessons stores them (Q6 of the plan). The same function runs
 * on the screen, so the list shown before sending is the list sent.
 */

import { instantIn } from "../datetime.ts";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The longest span a series may cover, in days. Not a rule of the booking
 * (the database refuses a lesson past its horizon by name): a guard against a
 * typed year that would make the loop below run for millennia.
 */
export const MAX_SERIES_DAYS = 400;

type Read<T> =
  | { readonly ok: true; readonly values: T }
  | { readonly ok: false; readonly message: string };

export type ProposalInput = {
  readonly mode: string;
  /** "YYYY-MM-DD", the day of one lesson. */
  readonly date: string;
  /** "HH:MM", in the proposer's zone. */
  readonly time: string;
  /** 0 is Sunday, as teacher_availability.weekday. */
  readonly weekdays: readonly number[];
  readonly firstDate: string;
  readonly lastDate: string;
};

function isDate(text: string): boolean {
  if (!DATE.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dayNumber(text: string): number {
  const [year, month, day] = text.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function dateOf(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** The instants of the lessons the input describes, soonest first. */
export function proposalStarts(
  input: ProposalInput,
  timeZone: string,
): Read<readonly Date[]> {
  if (!TIME.test(input.time)) {
    return { ok: false, message: "Escolha o horário da aula." };
  }
  if (input.mode === "single") {
    if (!isDate(input.date)) {
      return { ok: false, message: "Escolha o dia da aula." };
    }
    return { ok: true, values: [instantIn(input.date, input.time, timeZone)] };
  }
  if (input.mode !== "series") {
    return { ok: false, message: "Escolha entre uma aula e uma série." };
  }
  const weekdays = new Set(
    input.weekdays.filter(
      (day) => Number.isInteger(day) && day >= 0 && day <= 6,
    ),
  );
  if (weekdays.size === 0) {
    return { ok: false, message: "Marque pelo menos um dia da semana." };
  }
  if (!isDate(input.firstDate) || !isDate(input.lastDate)) {
    return { ok: false, message: "Escolha a primeira e a última data." };
  }
  const first = dayNumber(input.firstDate);
  const last = dayNumber(input.lastDate);
  if (last < first) {
    return {
      ok: false,
      message: "A última data não pode vir antes da primeira.",
    };
  }
  if (last - first > MAX_SERIES_DAYS) {
    return { ok: false, message: "Escolha uma última data mais próxima." };
  }
  const starts: Date[] = [];
  for (let day = first; day <= last; day += 1) {
    // Day 0 of the epoch was a Thursday.
    if (weekdays.has((day + 4) % 7)) {
      starts.push(instantIn(dateOf(day), input.time, timeZone));
    }
  }
  if (starts.length === 0) {
    return {
      ok: false,
      message: "Nenhum dia marcado cai entre essas datas.",
    };
  }
  return { ok: true, values: starts };
}

/** The input of the proposal form, as the browser sends it. */
export function proposalInputOf(form: FormData): ProposalInput {
  return {
    mode: String(form.get("mode") ?? ""),
    date: String(form.get("date") ?? ""),
    time: String(form.get("time") ?? ""),
    weekdays: form
      .getAll("weekday")
      .map((value) => String(value))
      .filter((value) => /^[0-6]$/.test(value))
      .map(Number),
    firstDate: String(form.get("first_date") ?? ""),
    lastDate: String(form.get("last_date") ?? ""),
  };
}

/** The proposal form read into instants, in the proposer's zone. */
export function readProposalForm(
  form: FormData,
  timeZone: string,
): Read<readonly Date[]> {
  return proposalStarts(proposalInputOf(form), timeZone);
}

/** The times the form offers, every 15 minutes of the day ("HH:MM"). */
export function quarterHours(): readonly string[] {
  const times: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
    const minute = String(minutes % 60).padStart(2, "0");
    times.push(`${hour}:${minute}`);
  }
  return times;
}
