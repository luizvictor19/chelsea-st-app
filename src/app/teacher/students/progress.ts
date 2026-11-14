/** One lesson with "Parei aqui" marked: where it stopped, in which book. */
export type Mark = {
  readonly scheduledAt: string;
  /** The book's position: Livro 1, Livro 2. */
  readonly book: number;
  /** The course number of the point, 1 to 128, as the lesson screen shows. */
  readonly point: number;
  readonly lastPoint: number | null;
};

export type Progress = {
  readonly book: number;
  readonly point: number;
  readonly lastPoint: number | null;
  /** Marked lessons, of any status. */
  readonly lessons: number;
};

/**
 * Where one student stopped: the latest marked lesson by scheduled_at, the
 * same rule as lastStop on the lesson screen, so the two never disagree. A
 * review that went back counts as where she stopped. Null when none is marked.
 */
export function progressOf(marks: readonly Mark[]): Progress | null {
  const latest = marks.reduce<Mark | null>(
    (best, mark) =>
      best === null ||
      new Date(mark.scheduledAt).getTime() >
        new Date(best.scheduledAt).getTime()
        ? mark
        : best,
    null,
  );
  if (latest === null) return null;
  return {
    book: latest.book,
    point: latest.point,
    lastPoint: latest.lastPoint,
    lessons: marks.length,
  };
}

/** "Livro 1 · ponto 14 de 52 · 6 aulas", said on the student's row. */
export function progressLine(progress: Progress | null): string {
  if (progress === null) return "nenhum ponto marcado ainda";
  const point =
    progress.lastPoint === null
      ? `ponto ${progress.point}`
      : `ponto ${progress.point} de ${progress.lastPoint}`;
  const lessons =
    progress.lessons === 1 ? "1 aula" : `${progress.lessons} aulas`;
  return `Livro ${progress.book} · ${point} · ${lessons}`;
}
