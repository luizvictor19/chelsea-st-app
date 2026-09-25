/**
 * The word's instruction, vocabulary_items.image_subject, and the two ways it
 * is written.
 *
 * Kept out of actions.ts so the writes can be exercised under node against a
 * table held in memory: the rule that matters here is which row a write lands
 * on and when it is refused, and that is decided by the filters below, not by
 * the database the tests do not have.
 */

/**
 * An update on vocabulary_items, and the part of the query builder these
 * writes use after it. actions.ts hands in the Supabase one; the tests hand in
 * a table held in memory.
 */
export type SubjectDb = (values: {
  image_subject: string | null;
}) => SubjectFilter;

type SubjectFilter = {
  eq(column: "id" | "image_subject", value: string): SubjectFilter;
  is(column: "image_subject", value: null): SubjectFilter;
  select(columns: "id"): PromiseLike<{
    data: readonly { id: string }[] | null;
    error: { message: string } | null;
  }>;
};

/**
 * What the field holds, as the column holds it: trimmed, and null for
 * nothing. The column refuses a blank string, so an emptied field is null.
 */
export function normalizeSubject(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** The field's text when a word is opened. */
export function openingSubject(word: {
  readonly imageSubject: string | null;
}): string {
  return word.imageSubject ?? "";
}

/**
 * The teacher's own text, on leaving the field and on generating. Always
 * written: an edit is the most recent thing the teacher said about the word,
 * whatever the column held before.
 */
export async function storeSubject(
  db: SubjectDb,
  wordId: string,
  text: string,
): Promise<string | null> {
  const value = normalizeSubject(text);
  const { error } = await db({ image_subject: value })
    .eq("id", wordId)
    .select("id");
  if (error) throw new Error(error.message);
  return value;
}

/**
 * The instruction a picture finished outside the platform was made from, when
 * the teacher gives one. It becomes the word's, as a generation's does, and
 * the value returned is what the upload's attempt records. Left empty it is
 * null and the word is not touched: an optional field left blank is not the
 * teacher clearing the word's instruction.
 */
export async function storeUploadSubject(
  db: SubjectDb,
  wordId: string,
  text: string,
): Promise<string | null> {
  if (normalizeSubject(text) === null) return null;
  return storeSubject(db, wordId, text);
}

/**
 * A suggestion, written to the word that asked for it and only if the column
 * still holds what the screen had when it asked.
 *
 * The comparison is in the update's own filter, so it and the write are one
 * statement: an edit that lands while the model is thinking changes the
 * column, the filter then matches no row, and the edit stays. 'kept' is that
 * case. The word is named by id from the request, never by whatever the
 * screen has open when the answer comes back.
 */
export async function storeSuggestion(
  db: SubjectDb,
  wordId: string,
  expected: string | null,
  suggestion: string,
): Promise<"stored" | "kept"> {
  const matching = db({ image_subject: normalizeSubject(suggestion) }).eq(
    "id",
    wordId,
  );
  const filtered =
    expected === null
      ? matching.is("image_subject", null)
      : matching.eq("image_subject", expected);
  const { data, error } = await filtered.select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0 ? "stored" : "kept";
}

/** Said when a suggestion arrived after the teacher had edited the field. */
export const EDIT_KEPT = "Sua edição foi mantida.";

/**
 * What the field shows once a suggestion has answered.
 *
 * The suggestion fills the field only if it was stored and the field still
 * holds what it held at the request. Text typed in the meantime and not yet
 * saved wins too: it is saved on leaving the field, after the suggestion,
 * so the column ends on it as well.
 */
export function landSuggestion(
  atRequest: string,
  now: string,
  answer: { readonly stored: boolean; readonly subject: string },
): { readonly field: string; readonly note: string | null } {
  if (answer.stored && now === atRequest) {
    return { field: answer.subject, note: null };
  }
  return { field: now, note: EDIT_KEPT };
}
