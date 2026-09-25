// Relative, with the extension: subject-saver.test.ts runs under node, which
// resolves neither the @/ alias nor a missing extension.
import { settle } from "./panel-state.ts";
import { landSuggestion, normalizeSubject } from "./subject-store.ts";

/**
 * What one word's panel does with the Instrução field: save it, and ask for a
 * suggestion that may replace it.
 *
 * Kept out of the component so it runs under node, and so the part that
 * outlives the panel is visible: a save still on its way when the teacher
 * moves to another word finishes after the panel is gone, and whatever it has
 * to say goes through `onFailure`, which the panel points at the teacher
 * area's snackbar rather than at its own state.
 */

type Answer =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

type SuggestAnswer =
  | { readonly ok: true; readonly subject: string; readonly stored: boolean }
  | { readonly ok: false; readonly error: string };

export type SuggestOutcome =
  | { readonly ok: true; readonly field: string; readonly note: string | null }
  | { readonly ok: false; readonly error: string };

/** The snackbar's sentence for a save that did not land. */
export function subjectNotSaved(term: string): string {
  return `A instrução de ${term} não foi salva.`;
}

export type SubjectSaver = {
  /**
   * Save the field as the word's instruction, if it changed. Queued behind any
   * save still on its way, so an older text never lands after a newer one.
   * Resolves true when the column is known to hold the text.
   */
  save(text: string): Promise<boolean>;
  /**
   * Ask for a suggestion with what the column holds, and say what the field
   * shows once it has answered. `fieldNow` is read after the answer, for the
   * text typed while it was on its way.
   */
  suggest(
    atRequest: string,
    fieldNow: () => string,
    ask: (expected: string | null) => Promise<SuggestAnswer>,
  ): Promise<SuggestOutcome>;
};

export function createSubjectSaver(options: {
  /** What the column held when the word was opened. */
  readonly initial: string | null;
  readonly save: (text: string) => Promise<Answer>;
  /** Called with the failed answer, even after the panel has closed. */
  readonly onFailure: (answer: {
    readonly error: string;
    readonly cause?: unknown;
  }) => void;
}): SubjectSaver {
  // What the column is known to hold. Undefined after a failed save, when
  // nobody knows, so the next save writes whatever it is given.
  let saved: string | null | undefined = options.initial;
  let queue: Promise<boolean> = Promise.resolve(true);

  function save(text: string): Promise<boolean> {
    const value = normalizeSubject(text);
    if (value === saved) return queue;
    saved = value;
    queue = queue.then(async () => {
      const result = await settle(() => options.save(text));
      if (result.ok) return true;
      saved = undefined;
      options.onFailure(result);
      return false;
    });
    return queue;
  }

  async function suggest(
    atRequest: string,
    fieldNow: () => string,
    ask: (expected: string | null) => Promise<SuggestAnswer>,
  ): Promise<SuggestOutcome> {
    /*
     * A failed save leaves the column on the old text, so a suggestion asked
     * with the edit would match nothing, be thrown away after it was paid
     * for, and have the screen say the edit was kept beside the snackbar
     * saying it was not saved. Nothing is asked, the field stays as it is,
     * and the snackbar is the one thing said.
     */
    if (!(await save(atRequest))) {
      return { ok: true, field: fieldNow(), note: null };
    }
    const result = await ask(normalizeSubject(atRequest));
    if (!result.ok) return result;
    const landed = landSuggestion(atRequest, fieldNow(), result);
    /*
     * A stored suggestion is known to be in the column only when it also
     * filled the field. When the field kept an edit, that edit may have been
     * saved after the suggestion or may not be saved yet, and nothing here
     * says which: the column is unknown, so the next save writes whatever it
     * is given, even the suggestion's exact text.
     */
    if (result.stored) {
      saved =
        landed.note === null ? normalizeSubject(result.subject) : undefined;
    }
    return { ok: true, ...landed };
  }

  return { save, suggest };
}
