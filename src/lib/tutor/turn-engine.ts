/**
 * The seam between the session screen and whatever plays the tutor.
 *
 * The screen only knows this interface: it hands over the student's audio for
 * one turn and gets back what the tutor says and what the screen should show.
 * The fake engine behind it today is replaced by the real tutor without the
 * screen changing.
 */

/** A word as the session shows it: the picture, and the spelling for help. */
export type SessionWord = {
  readonly term: string;
  readonly imageUrl: string;
};

/** How the tutor judged the answer that led to this turn, if there was one. */
export type Verdict = "correct" | "corrected";

export type TutorTurn = {
  /** What the tutor says, as text. Also the transcript line on screen. */
  readonly speech: string;
  /** The question under the picture, or null when there is nothing to answer. */
  readonly question: string | null;
  /** The word in the middle of the screen, or null once the session is over. */
  readonly word: SessionWord | null;
  readonly verdict: Verdict | null;
  /**
   * The start of the answer, shown and said when the student is stuck. Null
   * on every turn but a nudge.
   */
  readonly lead: string | null;
  /** True on the last turn: the tutor has nothing more to ask. */
  readonly finished: boolean;
  /**
   * Says the speech out loud and resolves when the tutor stops talking. The
   * engine owns the voice, so the screen never has to know where it comes
   * from.
   */
  play(): Promise<void>;
};

/** One hold of the button: what was recorded and for how long. */
export type Take = {
  readonly audio: Blob;
  readonly durationMs: number;
};

/**
 * What came of a take. `not-heard` is a hold with no speech in it: it is not an
 * answer and not a mistake, the tutor stays where it was and the screen asks
 * her to hold while she talks.
 */
export type TurnResult =
  | { readonly kind: "turn"; readonly turn: TutorTurn }
  | { readonly kind: "not-heard" };

export interface TurnEngine {
  /** The tutor's opening turn, before the student has said anything. */
  start(): Promise<TutorTurn>;
  /** One turn: the student's recording in, the tutor's answer out. */
  respond(take: Take): Promise<TurnResult>;
  /**
   * The tutor gives the start of the sentence, because she has not tried yet.
   * Does not count as an answer and does not move the session on.
   */
  nudge(): Promise<TutorTurn>;
}
