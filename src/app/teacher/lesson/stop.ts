/**
 * Which lesson "Parei aqui" writes to (#127), without the database.
 */

/** How far ahead a lesson still counts as the one being taught now. */
export const AHEAD_MINUTES = 60;

/** What the live lessons last (docs/context.md): a lesson created by the mark. */
export const LESSON_MINUTES = 45;

export type MarkableLesson = {
  readonly id: string;
  readonly scheduledAt: string;
  readonly durationMinutes: number;
};

/**
 * Among a student's scheduled lessons, the one running now or starting
 * within AHEAD_MINUTES, the closest to now; null when there is none, and the
 * mark then makes a lesson of its own.
 */
export function lessonToMark<T extends MarkableLesson>(
  lessons: readonly T[],
  now: Date,
): T | null {
  const nowMs = now.getTime();
  let best: T | null = null;
  for (const candidate of lessons) {
    const start = new Date(candidate.scheduledAt).getTime();
    const end = start + candidate.durationMinutes * 60_000;
    if (end <= nowMs || start > nowMs + AHEAD_MINUTES * 60_000) continue;
    if (
      best === null ||
      Math.abs(start - nowMs) <
        Math.abs(new Date(best.scheduledAt).getTime() - nowMs)
    ) {
      best = candidate;
    }
  }
  return best;
}
