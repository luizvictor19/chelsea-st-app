import { withDeadline } from "./deadline.ts";
import type { Take, TurnEngine, TutorTurn } from "./turn-engine.ts";

/**
 * The rules of one tutoring session, apart from any screen: whose turn it is,
 * when the tutor gives the start of the sentence, what a failure or a blocked
 * microphone does to the turn, and that nothing arriving after the student has
 * left may speak or change anything.
 *
 * The screen records, draws and forwards events. Keeping the rules here is
 * what lets them be tested without a browser.
 */

export type Phase =
  "intro" | "speaking" | "waiting" | "listening" | "thinking" | "finished";

export type Microphone = "ok" | "denied" | { readonly unavailable: string };

export type SessionState = {
  readonly phase: Phase;
  readonly turn: TutorTurn | null;
  /** A short line under the button, or null. */
  readonly hint: string | null;
  /** When the tutor gives the start of the sentence, or null when it won't. */
  readonly nudgeAt: number | null;
  readonly microphone: Microphone;
  /** The written word under the picture. Per word: a new word hides it. */
  readonly helpShown: boolean;
  /** How many different words have been shown, for the closing screen. */
  readonly practised: number;
  /** When the first turn arrived, or null before it did. */
  readonly startedAt: number | null;
};

/** For a stray touch and for a hold with nothing said in it. */
export const HOLD_WHILE_TALKING = "Segure enquanto fala.";

/** For a turn the tutor failed to answer: not hers to fix, so she retries. */
export const NOT_HEARD_NOW = "Não consegui ouvir agora. Tente de novo.";

/** For a session the tutor failed to open. */
export const NOT_STARTED_NOW = "Não consegui começar agora. Tente de novo.";

/** Runs `run` after `ms`, and hands back what cancels it. */
export type Schedule = (run: () => void, ms: number) => () => void;

export type SessionOptions = {
  readonly engine: TurnEngine;
  /** How long a question waits untouched before the start of the sentence. */
  readonly nudgeAfterMs: number;
  /** The longest the tutor holds the turn while speaking. */
  readonly maxSpeakingMs: number;
  readonly now?: () => number;
  readonly schedule?: Schedule;
};

const browserSchedule: Schedule = (run, ms) => {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
};

const INITIAL: SessionState = {
  phase: "intro",
  turn: null,
  hint: null,
  nudgeAt: null,
  microphone: "ok",
  helpShown: false,
  practised: 0,
  startedAt: null,
};

export class Session {
  private readonly engine: TurnEngine;
  private readonly nudgeAfterMs: number;
  private readonly maxSpeakingMs: number;
  private readonly now: () => number;
  private readonly schedule: Schedule;

  private state: SessionState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly practisedTerms = new Set<string>();
  private cancelNudge: (() => void) | null = null;
  /** The start of the sentence was already given for the current question. */
  private nudged = false;
  private beginning = false;
  private open = true;
  /**
   * Bumped by close(). Every await that can outlive the screen checks it on
   * the way back, so an answer or a nudge that lands after the student left
   * neither speaks nor touches the state.
   */
  private generation = 0;

  constructor(options: SessionOptions) {
    this.engine = options.engine;
    this.nudgeAfterMs = options.nudgeAfterMs;
    this.maxSpeakingMs = options.maxSpeakingMs;
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? browserSchedule;
  }

  // Arrow properties, so the screen can hand them to useSyncExternalStore.
  readonly getState = (): SessionState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The screen is showing the session. Called again after a close. */
  reopen(): void {
    this.open = true;
  }

  /**
   * The student left. Whatever is still on its way is dropped when it lands:
   * no voice, no state change. Stopping the voice already playing is the
   * screen's, which owns the browser.
   */
  close(): void {
    this.stopNudge();
    this.open = false;
    this.generation += 1;
  }

  async begin(): Promise<void> {
    // A double tap on Começar must not open the session twice.
    if (this.beginning || this.state.phase !== "intro") return;
    this.beginning = true;
    const generation = this.generation;
    let first: TutorTurn;
    try {
      first = await this.engine.start();
    } catch {
      this.beginning = false;
      if (this.current(generation)) this.set({ hint: NOT_STARTED_NOW });
      return;
    }
    if (!this.current(generation)) return;
    this.set({ startedAt: this.now() });
    await this.play(first, generation);
  }

  /**
   * She pressed the button. True when a recording may start: it is her turn
   * and the microphone is usable. Stops the countdown to the nudge.
   */
  listen(): boolean {
    if (!this.open || this.state.phase !== "waiting") return false;
    if (this.state.microphone !== "ok") return false;
    this.stopNudge();
    this.set({ phase: "listening", hint: null });
    return true;
  }

  /** She let go and the recording is being closed. */
  think(): void {
    if (this.state.phase === "listening") this.set({ phase: "thinking" });
  }

  /**
   * Nothing to send: a stray touch, a recording that failed to start or stop.
   * Her turn again, the countdown restarted.
   */
  cancel(hint: string | null): void {
    const { phase } = this.state;
    if (phase !== "listening" && phase !== "thinking") return;
    this.toWaiting();
    this.set({ hint });
  }

  async answer(take: Take): Promise<void> {
    const { phase } = this.state;
    if (phase !== "listening" && phase !== "thinking") return;
    this.set({ phase: "thinking" });
    const generation = this.generation;

    let result: Awaited<ReturnType<TurnEngine["respond"]>>;
    try {
      result = await this.engine.respond(take);
    } catch {
      // Not an answer and not a mistake: the tutor failed, she tries again.
      if (!this.current(generation)) return;
      this.toWaiting();
      this.set({ hint: NOT_HEARD_NOW });
      return;
    }
    if (!this.current(generation)) return;

    if (result.kind === "not-heard") {
      // Nothing said: not an answer and not a mistake either.
      this.toWaiting();
      this.set({ hint: HOLD_WHILE_TALKING });
      return;
    }
    await this.play(result.turn, generation);
  }

  /**
   * What the browser says about the microphone. Anything but "ok" puts the
   * unblock instructions on screen, and with them up nothing may happen
   * behind them: no countdown, no nudge, no recording.
   */
  setMicrophone(microphone: Microphone): void {
    this.set({ microphone });
    if (microphone !== "ok") this.stopNudge();
    else if (this.state.phase === "waiting") this.armNudge();
  }

  showHelp(): void {
    if (this.state.turn?.word != null) this.set({ helpShown: true });
  }

  private current(generation: number): boolean {
    return this.open && generation === this.generation;
  }

  private set(patch: Partial<SessionState>): void {
    if (!this.open) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private async play(next: TutorTurn, generation: number): Promise<void> {
    if (!this.current(generation)) return;
    const sameWord = this.state.turn?.word?.term === next.word?.term;
    // A nudge keeps the question it helps with; anything else is a new one.
    if (next.lead === null) this.nudged = false;
    if (next.word !== null) this.practisedTerms.add(next.word.term);
    this.stopNudge();
    this.set({
      turn: next,
      phase: "speaking",
      // Whatever the last hint was about, the tutor talking has moved past it.
      hint: null,
      helpShown: sameWord && this.state.helpShown,
      practised: this.practisedTerms.size,
    });

    await withDeadline(next.play(), this.maxSpeakingMs);
    if (!this.current(generation)) return;
    if (next.finished) this.set({ phase: "finished" });
    else this.toWaiting();
  }

  /**
   * Her turn. The countdown starts over from here, which is also what makes a
   * stray touch or a silent hold restart it.
   */
  private toWaiting(): void {
    this.set({ phase: "waiting" });
    this.armNudge();
  }

  private armNudge(): void {
    this.stopNudge();
    const asking = this.state.turn?.question != null;
    if (
      !this.open ||
      this.nudged ||
      !asking ||
      this.state.phase !== "waiting" ||
      this.state.microphone !== "ok"
    ) {
      return;
    }
    this.cancelNudge = this.schedule(() => {
      void this.giveNudge();
    }, this.nudgeAfterMs);
    this.set({ nudgeAt: this.now() + this.nudgeAfterMs });
  }

  private stopNudge(): void {
    this.cancelNudge?.();
    this.cancelNudge = null;
    if (this.state.nudgeAt !== null) this.set({ nudgeAt: null });
  }

  private async giveNudge(): Promise<void> {
    this.cancelNudge = null;
    this.set({ nudgeAt: null });
    this.nudged = true;
    const generation = this.generation;

    let nudge: TutorTurn;
    try {
      nudge = await this.engine.nudge();
    } catch {
      // No start of the sentence this time; the turn is still hers.
      return;
    }
    if (!this.current(generation)) return;
    /*
     * The only guard is that it is still her turn. With a slow engine that is
     * not enough: she may answer, hear the next question, and be waiting again
     * when this nudge lands, and it would then play over the new question.
     * Harmless with the fake, whose nudge resolves at once. To be closed when
     * the real engine arrives, by checking that the turn this nudge was asked
     * for is still the current one.
     */
    if (this.state.phase !== "waiting" || this.state.microphone !== "ok") {
      return;
    }
    await this.play(nudge, generation);
  }
}
