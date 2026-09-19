/**
 * The order the vocabulary of a book is read in: by lesson, then by the point
 * the word is introduced at, then alphabetically.
 *
 * It lives in one place because two callers need it to be the same order and
 * neither can tell if it drifts. The images screen lists the words in it, and
 * the suggestion pass walks the lesson in batches — so a batch is a stretch of
 * the list the teacher is looking at. "The third batch failed" is then a
 * region they can point at, instead of ten uuids.
 *
 * Sorted here and not in the query, for the reason listVocabularyImages
 * already gives: a nested order in PostgREST is the kind of thing that
 * quietly stops applying, and a few hundred rows cost nothing to sort.
 *
 * A word with no lesson or no point sorts last rather than first. It is not
 * part of the book's order yet, and putting it at the front would push
 * everything the teacher recognises down the page.
 */
export type OrderedWord = {
  readonly lessonNumber: number | null;
  readonly pointNumber: number | null;
  readonly term: string;
};

/** Last, for anything the book has not placed yet. */
const UNPLACED = Number.MAX_SAFE_INTEGER;

export function compareWords(a: OrderedWord, b: OrderedWord): number {
  const lessonA = a.lessonNumber ?? UNPLACED;
  const lessonB = b.lessonNumber ?? UNPLACED;
  if (lessonA !== lessonB) return lessonA - lessonB;

  const pointA = a.pointNumber ?? UNPLACED;
  const pointB = b.pointNumber ?? UNPLACED;
  if (pointA !== pointB) return pointA - pointB;

  /*
   * English, because these are English words in an English book, and the
   * teacher's locale would otherwise reorder the list depending on the
   * machine it was rendered on.
   */
  return a.term.localeCompare(b.term, "en");
}
