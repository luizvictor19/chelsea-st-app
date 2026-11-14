/**
 * The free slots of a teacher, as the student's screen shows them (#276).
 * The database decides which starts are free (bookable_slots, 0052): this
 * only groups them by day and names the day and the hour in the reader's
 * zone. Every function takes the zone as an argument, for the reason
 * src/lib/datetime.ts gives.
 */

export type Slot = {
  /** The instant, as the database sent it; book_lesson takes it back. */
  readonly startsAt: string;
  /** "19:00" in the reader's zone. */
  readonly time: string;
};

export type SlotDay = {
  /** "2026-11-16", the date in the reader's zone. */
  readonly key: string;
  /** "segunda-feira, 16 de novembro" */
  readonly label: string;
  readonly slots: readonly Slot[];
};

function dateKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function dayLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(instant);
}

function timeLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

/**
 * The starts grouped by the day they fall on in `timeZone`, the days and the
 * starts in time order. A start near midnight lands on the reader's day, not
 * the teacher's: the same instant is a Monday in São Paulo and a Tuesday in
 * Lisbon.
 */
export function groupSlotsByDay(
  startsAt: readonly string[],
  timeZone: string,
): SlotDay[] {
  const sorted = [...startsAt].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );
  const days: { key: string; label: string; slots: Slot[] }[] = [];
  for (const start of sorted) {
    const instant = new Date(start);
    const key = dateKey(instant, timeZone);
    let day = days.at(-1);
    if (day === undefined || day.key !== key) {
      day = { key, label: dayLabel(instant, timeZone), slots: [] };
      days.push(day);
    }
    day.slots.push({ startsAt: start, time: timeLabel(instant, timeZone) });
  }
  return days;
}

/** The week shown: `week` weeks from now, seven days long. */
export function weekSpan(now: Date, week: number): { from: Date; to: Date } {
  const from = new Date(now.getTime() + week * 7 * 86_400_000);
  return { from, to: new Date(from.getTime() + 7 * 86_400_000) };
}

/**
 * The week asked for in the address: a whole number from 0 to `lastWeek`,
 * the last week the booking reaches (lesson_rules, read by the caller).
 */
export function readWeek(
  raw: string | string[] | undefined,
  lastWeek: number,
): number {
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (text === undefined || !/^\d{1,3}$/.test(text)) return 0;
  return Math.min(Number(text), Math.max(lastWeek, 0));
}

/** "19:00 de segunda-feira, 16 de novembro": the start, as a person says it. */
export function startLabel(startsAt: string, timeZone: string): string {
  const instant = new Date(startsAt);
  return `${timeLabel(instant, timeZone)} de ${dayLabel(instant, timeZone)}`;
}

/** "1 crédito", "4 créditos" */
export function creditsLabel(credits: number): string {
  return credits === 1 ? "1 crédito" : `${credits} créditos`;
}
