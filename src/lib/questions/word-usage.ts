import { RULES, contractedStem, fold, words, type Rule } from "./presented.ts";

/**
 * How many questions use each word of the vocabulary.
 *
 * Derived every time it is read and stored nowhere: the questions screen
 * shows it so the teacher sees which word still has no example and which
 * already has too many.
 *
 * A sentence and a term are read by the validator's own reading (words, fold
 * and contractedStem, from presented.ts), so the two cannot disagree about
 * what a word is: "pen?" is pen, "Is" is is, ’ is ', and "pen's" is pen.
 *
 * WHERE THE COUNT PARTS FROM THE VALIDATOR, AND WHY. The validator asks
 * whether a word was presented, and for that every word of a term is
 * presented by it: "is" alone is presented by "what is (what's)", "it is
 * (it's)", "is this?" and "it is not (isn't)". Counted that way, any
 * sentence with "is" in it would be an example of all four, and none of them
 * could ever show as lacking one. Measured on 2026-10-03: 28 of the 283
 * terms are of several words. So a term counts as a whole:
 *
 * - its words in a row ("is this" for "is this?"), or
 * - the form it gives in brackets ("isn't" for "it is not (isn't)"), or
 * - for a verb of several words, its words in order with others between
 *   them, inside one sentence: "taking the book from the table" uses
 *   "taking from". Decided by Luiz on 2026-10-03, by word_class = verb. On
 *   that day the class holds 8 terms of several words: putting on, taking
 *   from, going to, and the five of the there is / there are family.
 *
 * A sentence here is one field, the prompt or the answer: a term is never
 * found half in one and half in the other.
 */

const ON: ReadonlySet<Rule> = new Set(RULES);

/** The word class whose terms of several words may stand apart. */
const APART_CLASS = "verb";

/** A vocabulary item, as the count needs it. */
export type UsageWord = {
  readonly id: string;
  readonly term: string;
  /** vocabulary_items.word_class, or null when it has none. */
  readonly wordClass: string | null;
};

/** A question, as the count needs it. */
export type UsageQuestion = {
  readonly prompt: string;
  readonly expectedAnswer: string;
  readonly answerLanguage: "en" | "pt";
  readonly isPublished: boolean;
};

/** The questions a word is in, by whether the student sees them yet. */
export type Usage = {
  readonly published: number;
  readonly unpublished: number;
};

export const NO_USAGE: Usage = { published: 0, unpublished: 0 };

export function usageTotal(usage: Usage): number {
  return usage.published + usage.unpublished;
}

export type UsageReader = {
  /**
   * The ids of the words the sentences use. A set, so a word written twice,
   * or in the prompt and again in the answer, is there once.
   */
  used(sentences: readonly string[]): ReadonlySet<string>;
};

const BRACKETED = /\(([^)]*)\)/gu;

/** The forms a term is written in: outside the brackets, and each inside. */
function formsOf(term: string): readonly (readonly string[])[] {
  return [
    term.replace(BRACKETED, " "),
    ...[...term.matchAll(BRACKETED)].map((match) => match[1]),
  ]
    .map((form) => words(form, ON).map((part) => fold(part.word, ON)))
    .filter((form) => form.length > 0);
}

function inARow(sentence: readonly string[], form: readonly string[]) {
  for (let from = 0; from + form.length <= sentence.length; from += 1) {
    if (form.every((part, index) => sentence[from + index] === part)) {
      return true;
    }
  }
  return false;
}

function inOrder(sentence: readonly string[], form: readonly string[]) {
  let next = 0;
  for (const word of sentence) {
    if (word === form[next]) next += 1;
    if (next === form.length) return true;
  }
  return false;
}

export function createUsageReader(
  vocabulary: readonly UsageWord[],
): UsageReader {
  const terms = vocabulary.map((item) => ({
    id: item.id,
    forms: formsOf(item.term),
    apart: item.wordClass === APART_CLASS,
  }));
  const known = new Set(
    terms.flatMap((term) => term.forms.flatMap((form) => form)),
  );

  /**
   * The sentence as folded words. A word no term holds, ending in 's, is
   * read as its stem when a term holds that: the validator's contractedIs,
   * with "some term holds it" in the place of "presented by this point".
   */
  function read(sentence: string): readonly string[] {
    return words(sentence, ON).map(({ word }) => {
      const own = fold(word, ON);
      if (known.has(own)) return own;
      const stem = contractedStem(word, ON);
      if (stem === null) return own;
      const folded = fold(stem, ON);
      return known.has(folded) ? folded : own;
    });
  }

  return {
    used(sentences) {
      const asRead = sentences.map(read);
      const ids = new Set<string>();
      for (const term of terms) {
        const found = term.forms.some((form) =>
          asRead.some((sentence) =>
            term.apart ? inOrder(sentence, form) : inARow(sentence, form),
          ),
        );
        if (found) ids.add(term.id);
      }
      return ids;
    },
  };
}

/**
 * The sentences of a question the count reads: the prompt, and the answer
 * when it is in English. A Portuguese answer holds no word of the course,
 * which is also why the validator leaves it alone.
 */
export function countedSentences(question: {
  readonly prompt: string;
  readonly expectedAnswer: string;
  readonly answerLanguage: "en" | "pt";
}): readonly string[] {
  return question.answerLanguage === "en"
    ? [question.prompt, question.expectedAnswer]
    : [question.prompt];
}

/**
 * The usage of every word some question uses, by word id. A word no question
 * uses is not in the map: read it with `?? NO_USAGE`.
 */
export function countUsage(
  reader: UsageReader,
  questions: readonly UsageQuestion[],
): ReadonlyMap<string, Usage> {
  const usage = new Map<string, Usage>();
  for (const question of questions) {
    for (const id of reader.used(countedSentences(question))) {
      const known = usage.get(id) ?? NO_USAGE;
      usage.set(
        id,
        question.isPublished
          ? { ...known, published: known.published + 1 }
          : { ...known, unpublished: known.unpublished + 1 },
      );
    }
  }
  return usage;
}

/** The mean of the counts, zero for no counts at all. */
export function meanUsage(counts: readonly number[]): number {
  if (counts.length === 0) return 0;
  return counts.reduce((sum, count) => sum + count, 0) / counts.length;
}

/**
 * The two lines between the bands, as shares of the lesson's mean: under
 * LOW_BELOW times the mean a word is little used, over HIGH_ABOVE times it
 * is much used. Given by Luiz on 2026-10-03 as a first reading, with one
 * lesson holding questions (11, in lesson 1 of book 1): they are here to be
 * tuned once more lessons have them.
 */
export const LOW_BELOW = 0.5;
export const HIGH_ABOVE = 2;

export type Band = "none" | "low" | "medium" | "high";

/**
 * Where a word's count stands against the mean of its lesson. Zero is a band
 * of its own whatever the mean is, so a lesson with no question at all, mean
 * zero, is all "none". Both lines belong to the middle: exactly half the
 * mean and exactly twice it are "medium".
 */
export function bandOf(count: number, mean: number): Band {
  if (count === 0) return "none";
  if (count < LOW_BELOW * mean) return "low";
  if (count > HIGH_ABOVE * mean) return "high";
  return "medium";
}
