/**
 * What the suggestion button says while it walks a lesson, and when it stops.
 *
 * The pass goes in batches now, so it can end three ways instead of two: it
 * can finish, it can fail before it starts, or it can stop partway with some
 * of the lesson suggested and some not. That third one is new and it is the
 * one worth being careful about — a run that quietly stops leaves a lesson
 * half suggested, which is acceptable, but only if the screen says so.
 */

export type SuggestOutcome =
  | {
      readonly kind: "running";
      readonly covered: number;
      readonly total: number;
    }
  | {
      readonly kind: "done";
      readonly suggested: number;
      readonly rejected: number;
    }
  | {
      readonly kind: "stalled";
      readonly suggested: number;
      readonly rejected: number;
      readonly covered: number;
      readonly total: number;
      readonly error: string;
    };

/** "3 recusadas" only when there were any: a zero is noise. */
function withRejected(suggested: number, rejected: number): string {
  const head = suggested === 1 ? "1 sugerida" : `${suggested} sugeridas`;
  if (rejected === 0) return head;
  return rejected === 1
    ? `${head}, 1 recusada`
    : `${head}, ${rejected} recusadas`;
}

export function suggestNote(outcome: SuggestOutcome): string {
  if (outcome.kind === "running") {
    return `${outcome.covered} de ${outcome.total}`;
  }
  if (outcome.kind === "done") {
    return withRejected(outcome.suggested, outcome.rejected);
  }

  /*
   * How many words the run never reached, which is the number the teacher
   * needs and the one the count beside the lesson cannot give them: that one
   * says how many words carry a suggestion, and a word skipped by this run
   * may well carry one from the last. So this says what this run did not do,
   * and says it in the same breath as the reason.
   */
  const left = Math.max(0, outcome.total - outcome.covered);
  const missed = left === 1 ? "1 não passou" : `${left} não passaram`;
  return `Parou em ${outcome.covered} de ${outcome.total}: ${missed}. ${outcome.error}`;
}
