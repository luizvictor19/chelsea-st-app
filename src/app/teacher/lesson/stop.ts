/**
 * Which lesson "Parei aqui" writes to (#127), without the database.
 */

/** How far ahead a lesson still counts as the one being taught now. */
export const AHEAD_MINUTES = 60;

/**
 * How long after its planned end a lesson still takes the mark. "Parei aqui"
 * comes as the lesson closes, and lessons run over; without this, a mark two
 * minutes late would make a lesson of its own and leave the real one blank.
 */
export const GRACE_MINUTES = 60;

/** What the live lessons last (docs/context.md): a lesson created by the mark. */
export const LESSON_MINUTES = 45;

export type MarkableLesson = {
  readonly id: string;
  readonly scheduledAt: string;
  readonly durationMinutes: number;
};

/**
 * Among a student's scheduled lessons, the one nearest to now: running (0),
 * ended less than GRACE_MINUTES ago or starting within AHEAD_MINUTES, each
 * by how far its time is from now. Running always wins. Null when there is
 * none, and the mark then makes a lesson of its own.
 */
export function lessonToMark<T extends MarkableLesson>(
  lessons: readonly T[],
  now: Date,
): T | null {
  const nowMs = now.getTime();
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const candidate of lessons) {
    const start = new Date(candidate.scheduledAt).getTime();
    const end = start + candidate.durationMinutes * 60_000;
    if (
      end + GRACE_MINUTES * 60_000 <= nowMs ||
      start > nowMs + AHEAD_MINUTES * 60_000
    ) {
      continue;
    }
    const distance = Math.max(start - nowMs, nowMs - end, 0);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
