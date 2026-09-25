import type {
  SessionWord,
  Take,
  TurnEngine,
  TurnResult,
  TutorTurn,
  Verdict,
} from "./turn-engine.ts";

/**
 * A TurnEngine that never listens. It walks a fixed script over the words it
 * is given, so the session screen can be built and tried before the real tutor
 * exists: present a word and ask, then judge the answers in turn, right on the
 * first, wrong with a correction on the second, and so on. A right answer moves
 * to the next word; a correction asks the same word again.
 *
 * The audio handed to respond() is ignored on purpose. Nothing is sent or kept.
 * Only its length is read: a take under SILENT_BELOW_MS stands in for a hold
 * with no speech in it, which the real tutor will have to hear for itself.
 */

/** Says a line and resolves when it is over. */
export type Speak = (text: string) => Promise<void>;

export type FakeTurnEngineOptions = {
  /** Defaults to the browser's speechSynthesis; tests pass a silent one. */
  readonly speak?: Speak;
  /** How long the tutor "thinks" before answering, in milliseconds. */
  readonly thinkingMs?: number;
};

const QUESTION = "What is this?";

/** Shorter than this, the fake treats the take as nothing said. */
export const SILENT_BELOW_MS = 1000;

/** The start of the sentence the fake gives when she is stuck. Fixed text. */
const LEAD = "It's a…";

/** The article in front of a noun, by its first letter. Good enough here. */
function withArticle(term: string): string {
  return /^[aeiou]/i.test(term) ? `an ${term}` : `a ${term}`;
}

function present(word: SessionWord): string {
  return `This is ${withArticle(word.term)}. ${QUESTION}`;
}

/**
 * The fake voice, and the only reason it exists is to give the prototype the
 * feel of a tutor talking. Disposable: the real engine brings its own audio,
 * and this goes away with FakeTurnEngine.
 *
 * Resolves on end and on error alike, and at once where the browser has no
 * speech synthesis, so a missing voice can never leave the screen stuck in the
 * speaking state.
 */
export const browserSpeak: Speak = (text) =>
  new Promise<void>((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB";
    utterance.rate = 0.9;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });

export class FakeTurnEngine implements TurnEngine {
  private readonly words: readonly SessionWord[];
  private readonly speak: Speak;
  private readonly thinkingMs: number;
  private index = 0;
  private answers = 0;

  constructor(
    words: readonly SessionWord[],
    options: FakeTurnEngineOptions = {},
  ) {
    if (words.length === 0) throw new Error("FakeTurnEngine needs a word");
    this.words = words;
    this.speak = options.speak ?? browserSpeak;
    this.thinkingMs = options.thinkingMs ?? 900;
  }

  async start(): Promise<TutorTurn> {
    this.index = 0;
    this.answers = 0;
    return this.turn(
      `Hi! Let's practise some words. ${present(this.words[0])}`,
      this.words[0],
      null,
    );
  }

  async respond(take: Take): Promise<TurnResult> {
    if (this.thinkingMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.thinkingMs));
    }

    // Nothing said: not an answer, so neither the word nor the count moves.
    if (take.durationMs < SILENT_BELOW_MS) return { kind: "not-heard" };

    const word = this.words[this.index];
    this.answers += 1;

    // Odd answers are right, even ones get corrected: 1st right, 2nd wrong...
    if (this.answers % 2 === 0) {
      return {
        kind: "turn",
        turn: this.turn(
          `Not quite. It's ${withArticle(word.term)}. Try again. ${QUESTION}`,
          word,
          "corrected",
        ),
      };
    }

    this.index += 1;
    const next = this.words[this.index];
    if (next === undefined) {
      return {
        kind: "turn",
        turn: {
          ...this.turn(
            `Yes! It's ${withArticle(word.term)}. That's all for today. Well done!`,
            null,
            "correct",
          ),
          finished: true,
        },
      };
    }
    return {
      kind: "turn",
      turn: this.turn(
        `Yes! It's ${withArticle(word.term)}. Now, look. ${present(next)}`,
        next,
        "correct",
      ),
    };
  }

  async nudge(): Promise<TutorTurn> {
    const word = this.words[this.index];
    return { ...this.turn(`Try this: ${LEAD}`, word, null), lead: LEAD };
  }

  private turn(
    speech: string,
    word: SessionWord | null,
    verdict: Verdict | null,
  ): TutorTurn {
    const speak = this.speak;
    return {
      speech,
      question: word === null ? null : QUESTION,
      word,
      verdict,
      lead: null,
      finished: false,
      play: () => speak(speech),
    };
  }
}
