/**
 * Date helpers for the student-facing screens.
 *
 * Every function takes the timezone explicitly and never reads the host's.
 * Formatting a UTC instant with the server's zone is what makes a lesson show
 * up on the wrong day, so the zone is always an argument, never an ambient.
 */

/** The calendar date as seen in `timeZone`, as YYYY-MM-DD. */
function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Whole calendar days from `from` to `to` as counted in `timeZone`.
 *
 * Counted on calendar dates rather than by dividing milliseconds, so 23:00
 * today to 01:00 tomorrow is one day, not zero.
 */
export function calendarDaysBetween(
  from: Date,
  to: Date,
  timeZone: string,
): number {
  const [fromYear, fromMonth, fromDay] = localDateKey(from, timeZone)
    .split("-")
    .map(Number);
  const [toYear, toMonth, toDay] = localDateKey(to, timeZone)
    .split("-")
    .map(Number);

  return Math.round(
    (Date.UTC(toYear, toMonth - 1, toDay) -
      Date.UTC(fromYear, fromMonth - 1, fromDay)) /
      86_400_000,
  );
}

// numeric: "always" on purpose. The "auto" formatter renders two days as
// "depois de amanhã", and the screen is specified to say "em 2 dias". One day
// is special-cased below, because "amanhã" does read better than "em 1 dia".
const relative = new Intl.RelativeTimeFormat("pt-BR", { numeric: "always" });

/** How long until `to`, in the words a person would use. */
export function humanCountdown(from: Date, to: Date, timeZone: string): string {
  const diffMs = to.getTime() - from.getTime();
  if (diffMs <= 0) {
    return "agora";
  }

  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) {
    return relative.format(Math.max(minutes, 1), "minute");
  }

  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 12) {
    return relative.format(hours, "hour");
  }

  const days = calendarDaysBetween(from, to, timeZone);
  if (days === 1) {
    return "amanhã";
  }
  // Half a day away but still the same calendar date, so days would read "em 0
  // dias". Hours are the honest unit there.
  if (days <= 0) {
    return relative.format(hours, "hour");
  }
  return relative.format(days, "day");
}

/** "sexta-feira, 04 de setembro" */
export function formatLessonDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone,
  }).format(date);
}

/** "19:00" */
export function formatLessonTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}
