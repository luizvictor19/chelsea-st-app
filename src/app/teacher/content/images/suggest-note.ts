/**
 * What the suggestion button says beside its bar, running or not.
 *
 * There used to be two numbers about suggestions on the screen: a count in
 * the lesson header, from the server and always there, and this note, from
 * the run and only there once a run had happened. They answered almost the
 * same question and never quite agreed, because one was the state and the
 * other was the last thing that happened to it. They are one place now, here,
 * and which of the two it shows depends on whether a run is going.
 *
 * At rest it is the state, straight from the server's count. While a run
 * walks the lesson it is the run, because during those seconds the state is
 * exactly what the teacher cannot see changing. When the run ends the note
 * goes back to the state, by then with the new number in it.
 */

export type SuggestOutcome =
  | {
      readonly kind: "running";
      /** The first and last word of the batch in flight, counting from one. */
      readonly from: number;
      readonly to: number;
      readonly total: number;
    }
  | {
      readonly kind: "stalled";
      readonly covered: number;
      readonly total: number;
      readonly error: string;
    };

/** "3 sem resposta" only when there were any: a zero is noise. */
function withUnanswered(suggested: number, unanswered: number): string {
  const head = suggested === 1 ? "1 sugerido" : `${suggested} sugeridos`;
  if (unanswered === 0) return head;
  return unanswered === 1
    ? `${head}, 1 sem resposta`
    : `${head}, ${unanswered} sem resposta`;
}

/**
 * The lesson as it stands: how many of its words carry a suggestion.
 *
 * Zero is written out rather than hidden. A lesson nobody has suggested yet
 * is the one where the button matters most, and an empty space there would
 * read as a screen that has not loaded.
 *
 * `unanswered` is the words the last run in this browser sent and did not come
 * back with a suggestion for. It is the one part of this sentence that is not
 * state, and it is here because it has nowhere else to be: nothing is written
 * for those words, so if the note drops them nobody ever learns they were
 * skipped.
 *
 * Sent minus suggested, and not the parser's count of refusals, because the
 * two are not the same number and the difference is the dangerous half. A
 * refusal is an answer the parser dropped and did count. A word the model
 * simply left out of its reply produces no entry at all: it is in neither
 * list, and until this sentence it was invisible everywhere — the word kept
 * whatever suggestion it had from before, indistinguishable from one written
 * a second ago.
 */
export function restingNote(suggested: number, unanswered: number): string {
  return withUnanswered(suggested, unanswered);
}

export function suggestNote(outcome: SuggestOutcome): string {
  /*
   * The batch that is in flight, and not the words already done, because this
   * note is written before the call goes out rather than after it comes back.
   * It used to be set only once a batch had answered, which meant the first
   * twenty-eight seconds of a run said nothing at all, and fifty-six if the
   * retry went the same way. A screen that says nothing while it works is
   * indistinguishable from one that has stopped.
   */
  if (outcome.kind === "running") {
    const range =
      outcome.from === outcome.to
        ? `${outcome.from}`
        : `${outcome.from} a ${outcome.to}`;
    return `Sugerindo ${range} de ${outcome.total}`;
  }

  /*
   * How many words the run never reached, which is the number the teacher
   * needs and the one the state cannot give them: the state says how many
   * words carry a suggestion, and a word skipped by this run may well carry
   * one from the last. So this says what this run did not do, and says it in
   * the same breath as the reason.
   */
  const left = Math.max(0, outcome.total - outcome.covered);
  const missed = left === 1 ? "1 não passou" : `${left} não passaram`;
  return `Parou em ${outcome.covered} de ${outcome.total}: ${missed}. ${outcome.error}`;
}
