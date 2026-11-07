// Relative, with the extension: suggestion-cards.test.ts runs under node,
// which resolves neither the @/ alias nor a missing extension.
import {
  MAX_PAIRS,
  MIN_PAIRS,
} from "../../../../lib/questions/suggest-questions.ts";
import { NO_IMAGE } from "../../../../lib/questions/question-image.ts";

import type { QuestionFields, Suggestion } from "./draft.ts";
import type { SuggestedQuestion } from "./suggest-flow.ts";

/**
 * The cards of "Sugerir perguntas" (#231, sub-issue of #67), kept out of the
 * component so the rules are tested without a browser.
 *
 * A card is a draft of the model and nothing else until the teacher saves it
 * through the question form. It lives in this browser only: a reload drops
 * every card, which costs one more request (about 0.1 cent, measured in #83)
 * and loses nothing that was written, since nothing was. The screen asks
 * before leaving while a card is on it (leave-guard.tsx).
 *
 * A card is either shown, with Usar and Descartar, or in use: open in a form
 * of its own, filled with the draft. Closing that form puts the card back as
 * it was; only Descartar takes a card away, and only a save uses it up.
 */

/** Where the quantity field starts (plan of #67). */
export const DEFAULT_COUNT = 6;

export type SuggestionCard = {
  /** For React, and for knowing which card an action belongs to. */
  readonly key: string;
  readonly question: SuggestedQuestion;
  /** The model that wrote it, for the provenance (0045). */
  readonly model: string;
  readonly inUse: boolean;
};

let next = 0;

/** The same sentences, as a card holds them: a repeat adds nothing. */
function sameDraft(a: SuggestedQuestion, b: SuggestedQuestion): boolean {
  return (
    a.prompt.trim() === b.prompt.trim() &&
    a.expectedAnswer.trim() === b.expectedAnswer.trim()
  );
}

/**
 * The cards on screen after an answer: the ones already there, in their
 * place, and the new drafts after them. A card the teacher has not decided on
 * is not the model's to take back, so an answer never replaces one; a draft
 * equal to a card on screen is dropped, and so is one repeated in the same
 * answer. `added` is how many cards the answer brought.
 */
export function withAnswer(
  onScreen: readonly SuggestionCard[],
  model: string,
  questions: readonly SuggestedQuestion[],
): { readonly cards: readonly SuggestionCard[]; readonly added: number } {
  const cards = [...onScreen];
  let added = 0;
  for (const question of questions) {
    if (cards.some((card) => sameDraft(card.question, question))) continue;
    cards.push({
      key: `sugestao-${(next += 1)}`,
      question,
      model,
      inUse: false,
    });
    added += 1;
  }
  return { cards, added };
}

function withCard(
  cards: readonly SuggestionCard[],
  key: string,
  inUse: boolean,
): readonly SuggestionCard[] {
  return cards.map((card) => (card.key === key ? { ...card, inUse } : card));
}

/** Usar: the card opens in a form of its own. */
export function used(
  cards: readonly SuggestionCard[],
  key: string,
): readonly SuggestionCard[] {
  return withCard(cards, key, true);
}

/** The card's form closed without a save: the card is back as it came. */
export function putBack(
  cards: readonly SuggestionCard[],
  key: string,
): readonly SuggestionCard[] {
  return withCard(cards, key, false);
}

/** Descartar, or a save of its form: the card leaves the screen. */
export function removed(
  cards: readonly SuggestionCard[],
  key: string,
): readonly SuggestionCard[] {
  return cards.filter((card) => card.key !== key);
}

/**
 * The quantity as typed, as a number the action takes, or null when it is
 * not one: a whole number from MIN_PAIRS to MAX_PAIRS, the action's range.
 */
export function countOf(typed: string): number | null {
  const text = typed.trim();
  if (!/^\d+$/.test(text)) return null;
  const count = Number(text);
  return count >= MIN_PAIRS && count <= MAX_PAIRS ? count : null;
}

/**
 * What the form opens on for a card: the draft's sentences and language,
 * unpublished, and its picture as the form chooses one. A new scene opens as
 * a scene not yet picked, with Criar cena written (`sceneText`): suggesting
 * never makes a picture, and creating the scene stays the teacher's tap. A
 * picture the model named that does not exist opens as none decided.
 */
export function draftToFields(question: SuggestedQuestion): {
  readonly fields: QuestionFields;
  readonly sceneText: string | null;
} {
  const base = {
    prompt: question.prompt,
    expectedAnswer: question.expectedAnswer,
    answerLanguage: question.answerLanguage,
    isPublished: false,
  };
  const { image } = question;
  switch (image.kind) {
    case "word":
      return {
        fields: { ...base, image: { kind: "word", id: image.id } },
        sceneText: null,
      };
    case "scene":
      return {
        fields: { ...base, image: { kind: "scene", id: image.id } },
        sceneText: null,
      };
    case "new_scene":
      return {
        fields: { ...base, image: { kind: "scene", id: null } },
        sceneText: image.description,
      };
    case "acted":
      return { fields: { ...base, image: { kind: "acted" } }, sceneText: null };
    case "none":
      return { fields: { ...base, image: NO_IMAGE }, sceneText: null };
  }
}

/** What a question saved from the card records of where it came from (0045). */
export function provenance(card: SuggestionCard): Suggestion {
  return {
    model: card.model,
    prompt: card.question.prompt,
    answer: card.question.expectedAnswer,
  };
}
