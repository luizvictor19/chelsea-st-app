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
