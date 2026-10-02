/**
 * The live lesson as a deck: what the shared screen shows, one slide at a
 * time, in the order the book introduces it.
 *
 * Pure, so the three rules the screen follows are tested here and the
 * component only draws them: the order of the words inside a point, where a
 * contrast set is presented, and what comes after and before a slide.
 */
import type { Representation } from "@/lib/content/queries";

import type { ContrastRow } from "../content/images/contrast-sets";

/** A word as the screen needs it. */
export type DeckWord = {
  readonly id: string;
  readonly term: string;
  /**
   * The point that introduces the word. Point numbers run on from one book to
   * the next (book 2 starts at 53), so the number alone places a word in the
   * course.
   */
  readonly pointNumber: number;
  /** When the word was extracted, which is its place inside the point. */
  readonly createdAt: string;
  readonly representation: Representation | null;
  readonly imageUrl: string | null;
};

/** A published question as the screen needs it. */
export type DeckQuestion = {
  readonly id: string;
  readonly pointNumber: number;
  /** Its place among the questions of its point, as the teacher ordered them. */
  readonly position: number;
  readonly prompt: string;
  readonly expectedAnswer: string;
  readonly imageUrl: string | null;
};

/** One thing on the screen: a word alone, a whole contrast set, or a question. */
export type Slide = {
  readonly key: string;
  readonly pointNumber: number;
  /** Its place among the slides of its point, from 0. */
  readonly index: number;
  /**
   * More than one word is a contrast set, shown side by side. Empty on a
   * question slide.
   */
  readonly words: readonly DeckWord[];
  /**
   * The question of a question slide, with its number among the questions of
   * the point, from 1. Null on a presentation slide.
   */
  readonly question: (DeckQuestion & { readonly number: number }) | null;
};

/** Where the teacher is: a point, and a slide inside it. */
export type Position = {
  readonly pointNumber: number;
  readonly index: number;
};

/**
 * The order of the words inside a point: the order they were extracted in,
 * which is the order the book lists them. The images screen sorts a point
 * alphabetically, which suits a list to look words up in and not a lesson.
 * Measured on 2026-10-01: no two words of a point share a created_at, and the
 * term only settles a tie that has not happened yet.
 */
export function compareInBookOrder(a: DeckWord, b: DeckWord): number {
  if (a.pointNumber !== b.pointNumber) return a.pointNumber - b.pointNumber;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.term.localeCompare(b.term, "en");
}

/**
 * Every slide of the course, in order.
 *
 * A contrast set is presented whole, at the point of its latest member, and
 * nowhere else: its earlier members do not get a slide of their own at their
 * own points. Inside that point the set stands where the first of its members
 * introduced there would have stood, and its words keep the order the teacher
 * gave the set. Nothing about this is stored; it is derived on each read from
 * the point of every member.
 *
 * A set with fewer than two of its words in `words` is not a set here, and
 * the word that is left is shown alone.
 */
export function buildDeck(
  words: readonly DeckWord[],
  rows: readonly ContrastRow[],
): readonly Slide[] {
  const byId = new Map(words.map((word) => [word.id, word]));
  const members = new Map<string, { word: DeckWord; position: number }[]>();
  for (const row of rows) {
    const word = byId.get(row.vocabulary_item_id);
    if (word === undefined) continue;
    const list = members.get(row.set_id) ?? [];
    list.push({ word, position: row.position });
    members.set(row.set_id, list);
  }

  const setOf = new Map<string, { id: string; words: DeckWord[] }>();
  for (const [id, list] of members) {
    if (list.length < 2) continue;
    const set = {
      id,
      words: list.sort((a, b) => a.position - b.position).map((m) => m.word),
    };
    for (const word of set.words) setOf.set(word.id, set);
  }

  const slides: Slide[] = [];
  const shown = new Set<string>();
  const push = (key: string, pointNumber: number, shownWords: DeckWord[]) => {
    const last = slides.at(-1);
    const index = last?.pointNumber === pointNumber ? last.index + 1 : 0;
    slides.push({ key, pointNumber, index, words: shownWords, question: null });
  };

  for (const word of [...words].sort(compareInBookOrder)) {
    const set = setOf.get(word.id);
    if (set === undefined) {
      push(word.id, word.pointNumber, [word]);
      continue;
    }
    const latest = Math.max(...set.words.map((member) => member.pointNumber));
    if (word.pointNumber !== latest || shown.has(set.id)) continue;
    shown.add(set.id);
    push(set.id, latest, set.words);
  }
  return slides;
}

/**
 * The deck with the questions of each point after the presentation slides of
 * that point, in the order of their position. A point that has questions and
 * no words is a point of question slides only.
 */
export function withQuestions(
  deck: readonly Slide[],
  questions: readonly DeckQuestion[],
): readonly Slide[] {
  const points = new Set([
    ...deck.map((slide) => slide.pointNumber),
    ...questions.map((question) => question.pointNumber),
  ]);
  return [...points]
    .sort((a, b) => a - b)
    .flatMap((pointNumber) => {
      const presented = slidesAt(deck, pointNumber);
      const asked = questions
        .filter((question) => question.pointNumber === pointNumber)
        .sort((a, b) => a.position - b.position)
        .map((question, order) => ({
          key: question.id,
          pointNumber,
          index: presented.length + order,
          words: [],
          question: { ...question, number: order + 1 },
        }));
      return [...presented, ...asked];
    });
}

/** The slides of one point, in order. Empty for a point with no slides. */
export function slidesAt(
  deck: readonly Slide[],
  pointNumber: number,
): readonly Slide[] {
  return deck.filter((slide) => slide.pointNumber === pointNumber);
}

function isAfter(slide: Slide, position: Position): boolean {
  return (
    slide.pointNumber > position.pointNumber ||
    (slide.pointNumber === position.pointNumber && slide.index > position.index)
  );
}

function isBefore(slide: Slide, position: Position): boolean {
  return (
    slide.pointNumber < position.pointNumber ||
    (slide.pointNumber === position.pointNumber && slide.index < position.index)
  );
}

/**
 * The slide after this one, crossing into the next point that has any, or
 * null at the end of the course. Asked from a point with no slides, it is
 * the first slide of the next point that has one.
 */
export function nextPosition(
  deck: readonly Slide[],
  position: Position,
): Position | null {
  const next = deck.find((slide) => isAfter(slide, position));
  return next === undefined
    ? null
    : { pointNumber: next.pointNumber, index: next.index };
}

/** The slide before this one, the mirror of nextPosition. */
export function previousPosition(
  deck: readonly Slide[],
  position: Position,
): Position | null {
  const previous = deck.findLast((slide) => isBefore(slide, position));
  return previous === undefined
    ? null
    : { pointNumber: previous.pointNumber, index: previous.index };
}

/**
 * The position a URL asks for, held to what exists: an item past the end of
 * its point is the last one, and a point with no slides keeps item 0, so a
 * stale link lands somewhere instead of on nothing.
 */
export function clampPosition(
  deck: readonly Slide[],
  position: Position,
): Position {
  const count = slidesAt(deck, position.pointNumber).length;
  const index = Math.min(Math.max(position.index, 0), Math.max(count - 1, 0));
  return { pointNumber: position.pointNumber, index };
}

/** Where the teacher is and how much of that slide is showing, from level 1. */
export type View = {
  readonly position: Position;
  readonly level: number;
};

/**
 * How many levels a slide has. A question has three: its picture or a neutral
 * card, then the question, then the expected answer. A presentation has two,
 * the picture and then the word; with no picture the word is all there is,
 * and it shows at once.
 */
export function levelCount(slide: Slide, pictured: boolean): number {
  if (slide.question !== null) return 3;
  return pictured ? 2 : 1;
}

/** Arriving at a slide: always at its first level. */
export function showAt(position: Position): View {
  return { position, level: 1 };
}

/** One level more of the same slide, stopping at its last. */
export function revealMore(view: View, levels: number): View {
  return { ...view, level: Math.min(view.level + 1, levels) };
}

/** One level less of the same slide, stopping at its first. */
export function revealLess(view: View): View {
  return { ...view, level: Math.max(view.level - 1, 1) };
}
