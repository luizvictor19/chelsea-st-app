/**
 * The numbers of a booking live in the database, in lesson_rules() (0052).
 * The generated types read a function with out parameters as an untyped
 * record, so the one number a form needs is narrowed here, and a shape that
 * is not the expected one is null: the caller refuses to save rather than
 * guess a length.
 */

/** The minutes of a lesson, from what lesson_rules() returned. */
export function lessonMinutesFrom(data: unknown): number | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row !== "object" || row === null) return null;
  const minutes = (row as { lesson_minutes?: unknown }).lesson_minutes;
  return typeof minutes === "number" && Number.isInteger(minutes) && minutes > 0
    ? minutes
    : null;
}

/**
 * How many weeks ahead the booking opens, from lesson_rules().book_opens_ahead
 * as PostgREST sends an interval ("56 days", or "P56D" in ISO style), counted
 * in whole weeks from now, rounded up. Null when the shape is not one of those.
 */
export function bookHorizonWeeksFrom(data: unknown): number | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row !== "object" || row === null) return null;
  const ahead = (row as { book_opens_ahead?: unknown }).book_opens_ahead;
  if (typeof ahead !== "string") return null;
  const days = /^(\d+) days?$/.exec(ahead) ?? /^P(\d+)D$/.exec(ahead);
  if (days === null || Number(days[1]) === 0) return null;
  return Math.ceil(Number(days[1]) / 7);
}
