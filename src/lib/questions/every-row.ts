/**
 * Every row of a table, however many the API hands over at a time.
 *
 * PostgREST answers a select with at most its configured number of rows and
 * says nothing about the rest: the answer is short, not wrong. For the
 * validator that would be the worst kind of short, because a vocabulary item
 * left out is a word marked as never presented, on an arbitrary share of the
 * words, with nothing on the screen to say why.
 *
 * So the read asks for the exact count with the first page and keeps asking,
 * from where it stopped, until it holds that many. Measured on 2026-10-01
 * the vocabulary is 283 items and the contrast sets 61 rows, of two books
 * out of twelve: one call each today, and no page size is assumed here.
 *
 * `read` answers with the rows from `from` on, in a stable order, and the
 * total. A page that comes back empty ends the read whatever the total says,
 * so a table that shrinks under it cannot make it ask forever.
 */
export async function everyRow<T>(
  read: (from: number) => Promise<{
    readonly rows: readonly T[];
    readonly total: number;
  }>,
): Promise<readonly T[]> {
  const all: T[] = [];
  for (;;) {
    const { rows, total } = await read(all.length);
    all.push(...rows);
    if (rows.length === 0 || all.length >= total) return all;
  }
}
