// Relative, with the extension: suggest-flow.test.ts runs under node, which
// resolves neither the @/ alias nor a missing extension.
import { compareWords } from "../../../../lib/content/word-order.ts";
import {
  createChecker,
  grammarTableTerms,
} from "../../../../lib/questions/presented.ts";
import {
  MAX_PAIRS,
  MIN_PAIRS,
  SUGGEST_QUESTIONS_MODEL,
  buildSuggestQuestionsPrompt,
  draftImage,
  parseDrafts,
  pendingTerms,
  type DraftImage,
  type SuggestWord,
} from "../../../../lib/questions/suggest-questions.ts";
import type { TextProvider } from "../../../../lib/text/provider.ts";
import type { FailureWording } from "../images/claude-failure.ts";
import { askModel, usdOrNull } from "../images/suggestion-call.ts";

import { COUNT_RANGE, NO_NEW_WORDS } from "./suggest-texts.ts";

export { COUNT_RANGE, NO_NEW_WORDS };

/**
 * "Sugerir perguntas" for one point (#230, sub-issue of #67), apart from
 * Supabase and from the SDK, so the order that matters is tested under node:
 * nobody who cannot write common content reaches the paid call, and nothing
 * is written. The drafts go back to the screen, which shows them as cards;
 * a draft becomes a question only through the question form (#231).
 */

/** A word of the book, with what the prompt and the form need of it. */
export type BookWord = SuggestWord & { readonly id: string };

export type PointInputs = {
  readonly book: number;
  readonly point: number;
  /** Every word of the book, at every point: the validator needs the later ones. */
  readonly words: readonly BookWord[];
  /** The scenes in use with an approved picture. */
  readonly scenes: readonly {
    readonly id: string;
    readonly description: string;
  }[];
  /**
   * The book's grammar tables: their words count as presented at their
   * point for the validator (#233), and are not offered to the model.
   */
  readonly tables: readonly {
    readonly point: number;
    readonly content: string;
  }[];
  /** Every question of the book, written by hand or not, published or not. */
  readonly questions: readonly {
    readonly point: number;
    readonly prompt: string;
    readonly expectedAnswer: string;
    readonly answerLanguage: "en" | "pt";
  }[];
};

/** One draft, as a card shows it. */
export type SuggestedQuestion = {
  readonly prompt: string;
  readonly expectedAnswer: string;
  readonly answerLanguage: "en" | "pt";
  readonly image: DraftImage;
  /** What the model says the pair practises, in English. */
  readonly practises: string;
  /** Words the lesson has not presented by the point, as the validator marks them. */
  readonly marks: readonly string[];
};

export type SuggestQuestionsResult =
  | {
      readonly ok: true;
      /** The model that wrote the drafts, for the provenance (0045). */
      readonly model: string;
      readonly asked: number;
      readonly questions: readonly SuggestedQuestion[];
      /** Earlier words that were offered as still waiting. */
      readonly pending: readonly string[];
      /** New words of the point the model left for later, in its words. */
      readonly leftOut: readonly string[];
    }
  | { readonly ok: false; readonly error: string };

export type SuggestDeps = {
  /** can_write_content for common content, the database's rule. */
  readonly canWrite: () => Promise<boolean>;
  /** The point's inputs, or null when there is no such point. */
  readonly inputs: () => Promise<PointInputs | null>;
  /** Built only once the checks pass, so a refusal never needs the key. */
  readonly provider: () => TextProvider;
  /** One line for the function log; never what fails the call. */
  readonly log: (line: Record<string, unknown>) => void;
};

export const COMMON_ONLY =
  "Só quem edita o conteúdo comum pode pedir perguntas.";
export const POINT_GONE = "Esse ponto não existe mais. Recarregue a página.";
export const UNREADABLE =
  "O modelo não devolveu perguntas legíveis. Tente de novo.";

export const QUESTIONS_WORDING: FailureWording = {
  stopped: "O modelo não devolveu perguntas. Tente de novo.",
  failed: "Não consegui pedir as perguntas.",
};

export async function proposeQuestions(
  deps: SuggestDeps,
  count: number,
): Promise<SuggestQuestionsResult> {
  if (!Number.isInteger(count) || count < MIN_PAIRS || count > MAX_PAIRS) {
    return { ok: false, error: COUNT_RANGE };
  }
  // Before anything is paid for: whoever may ask is decided by the rule
  // that decides who may write the question, which lives in the database.
  if (!(await deps.canWrite())) return { ok: false, error: COMMON_ONLY };

  const inputs = await deps.inputs();
  if (inputs === null) return { ok: false, error: POINT_GONE };
  const { book, point } = inputs;
  if (!inputs.words.some((word) => word.point === point)) {
    return { ok: false, error: NO_NEW_WORDS };
  }

  const words = [...inputs.words].sort((a, b) =>
    compareWords(
      { lessonNumber: null, pointNumber: a.point, term: a.term },
      { lessonNumber: null, pointNumber: b.point, term: b.term },
    ),
  );
  const checker = createChecker([
    ...words.map((word) => ({
      term: word.term,
      place: { book, point: word.point },
      setId: word.set,
    })),
    ...grammarTableTerms(
      inputs.tables.map((table) => ({
        content: table.content,
        place: { book, point: table.point },
      })),
    ),
  ]);
  const at = { book, point };
  // A scene can be offered at a point once every word of it is presented.
  const scenes = inputs.scenes.filter(
    (scene) => checker.check(scene.description, at).length === 0,
  );
  const pending = pendingTerms(words, inputs.questions, point);
  const prompt = buildSuggestQuestionsPrompt({
    book,
    point,
    words,
    scenes: scenes.map((scene) => ({ description: scene.description, point })),
    count,
    pending,
  });

  const started = performance.now();
  const answer = await askModel(deps.provider(), prompt, QUESTIONS_WORDING);
  const line: Record<string, unknown> = {
    event: "suggest_questions",
    book,
    point,
    count,
    model: SUGGEST_QUESTIONS_MODEL,
    pending: pending.length,
    modelMs: Math.round(performance.now() - started),
    usage: answer.usage,
    usd: usdOrNull(SUGGEST_QUESTIONS_MODEL, answer.usage),
  };
  if (!answer.ok) {
    // The reason goes to the log only: on this screen a cause on a failed
    // answer is how a lost response is told apart (askTwiceIfLost).
    deps.log({ ...line, outcome: "model_failed", cause: answer.cause });
    return { ok: false, error: answer.error };
  }
  const parsed = parseDrafts(answer.text);
  if (!parsed.ok) {
    deps.log({ ...line, outcome: "unreadable", cause: parsed.reason });
    return { ok: false, error: UNREADABLE };
  }

  const presented = words
    .filter((word) => word.point <= point)
    .map((word) => ({ id: word.id, term: word.term, picture: word.picture }));
  // The model is asked for a number it cannot be held to: what is over is
  // cut here, and what is short is said on the screen.
  const kept = parsed.questions.slice(0, count);
  const questions = kept.map((draft): SuggestedQuestion => ({
    prompt: draft.prompt,
    expectedAnswer: draft.expectedAnswer,
    answerLanguage: draft.answerLanguage,
    image: draftImage(draft, presented, scenes),
    practises: draft.practises,
    marks: [
      ...checker.check(draft.prompt, at),
      ...(draft.answerLanguage === "en"
        ? checker.check(draft.expectedAnswer, at)
        : []),
    ].map((mark) => mark.word),
  }));
  deps.log({
    ...line,
    outcome: "ok",
    returned: parsed.questions.length,
    kept: questions.length,
  });
  return {
    ok: true,
    // The id asked for, not the response's: it is what the price table and
    // the constant name, and what a query on the provenance groups by.
    model: SUGGEST_QUESTIONS_MODEL,
    asked: count,
    questions,
    pending,
    leftOut: parsed.pending,
  };
}
