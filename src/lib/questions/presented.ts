/**
 * Which words of a question the lesson has not presented yet.
 *
 * The method rests on one rule: a sentence only uses words already
 * introduced at its point. This is what holds that rule on the questions
 * screen. It warns and never blocks: the teacher reads the marks and decides,
 * because a mark can be a name of the cast or a word the grammar table
 * taught, and only they know which.
 *
 * A word counts from the point of the vocabulary item that carries it, and a
 * word in a contrast set counts from the point of the set's latest member:
 * the set is shown side by side, so it is shown whole or not at all.
 *
 * What it reads is words, not grammar. It cannot tell a plural from a
 * singular or a possessive from a contraction, and it does not try.
 *
 * EVERY RULE BELOW WAS MEASURED BEFORE IT WENT IN.
 *
 * Against the 31 questions and answers printed in lesson 1 of book 1 (points
 * 1 to 7: 62 sentences, 339 words) and the 283 vocabulary items of the
 * project, on 2026-10-01, with scripts/measure-question-validator.ts. With no
 * rule at all, 193 of the 339 words are marked. With the five rules, 7 are,
 * and each of the 7 is a word the book uses before any vocabulary box gives
 * it. The count each rule answers for is beside the rule. What was measured
 * and left out is at the bottom of this file.
 */

/** A point of the course: the book, then the number in its margin. */
export type Place = {
  readonly book: number;
  readonly point: number;
};

/** A vocabulary item, as the validator needs it. */
export type VocabularyWord = {
  readonly term: string;
  /** Where first_point_id puts it. */
  readonly place: Place;
  /** Its contrast set, or null. */
  readonly setId: string | null;
};

/**
 * The normalisations, each one switchable so the measurement can take it out
 * and count what comes back. The screen always runs all of RULES.
 */
export type Rule =
  "punctuation" | "case" | "termWords" | "apostrophe" | "contractedIs";

/**
 * The rules in force, in the order the measurement adds them. The first
 * number is the marks left on the 339 words of lesson 1 once the rule comes
 * in; the second is how many come back when that rule alone is taken out of
 * the five, which is what the rule answers for.
 *
 *   none          193
 *   punctuation   144   98   "pen?" is pen, "Yes," is yes, and the "..." the
 *                            book prints for an open answer is not a word.
 *   case          103   77   "Is" is is. It also reads Brown, the family's
 *                            name, as brown, the colour: see below.
 *   termWords      69   83   A term is often several words: "what is
 *                            (what's)", "is this?", "it is not (isn't)".
 *   apostrophe     21   20   The book prints ’ and a keyboard types '.
 *                            Dictation 1, as stored, has both in one block.
 *   contractedIs    7   14   "The pen's on the book": from point 4 on the
 *                            book contracts is onto any noun.
 *
 * The 7 left are London, Windsor and Grantchester, twice each at point 4
 * (London is boxed at point 26, the other two never), and "etc." at point 7
 * (boxed at point 14). All true: the book uses them ahead of their box.
 *
 * BROWN IS READ AS BROWN. The cast's surname is in no vocabulary box, and
 * folding the case makes it the colour, which is boxed at point 6, the point
 * the family arrives at. So from point 6 on it is not marked, by coincidence
 * and not by a rule about names: 12 of the 77 in lesson 1. Before point 6 it
 * is marked, as a word that comes later.
 *
 * contractedIs reads words, not grammar: "Anna's book" passes as well, before
 * the possessive is taught. Lesson 1 prints no possessive to count.
 */
export const RULES: readonly Rule[] = [
  "punctuation",
  "case",
  "termWords",
  "apostrophe",
  "contractedIs",
];

/** A word of the text the lesson has not presented at that point. */
export type Mark = {
  /** Where the word sits in the text, punctuation left outside. */
  readonly start: number;
  readonly end: number;
  /** The word as written. */
  readonly word: string;
  /**
   * Null when no vocabulary item carries it at all; otherwise where it is
   * first presented, which is after the point asked about.
   */
  readonly presentedAt: Place | null;
};

export type Checker = {
  /** The words of `text` not presented at or before `at`, in order. */
  check(text: string, at: Place): readonly Mark[];
};

/** Negative, zero or positive, as a comes before, with or after b. */
export function comparePlaces(a: Place, b: Place): number {
  return a.book !== b.book ? a.book - b.book : a.point - b.point;
}

const TYPOGRAPHIC_APOSTROPHE = /’/gu;
const NOT_A_WORD_CHARACTER = /[^\p{L}\p{N}]/u;
const CONTRACTED_IS = /['’]s$/u;

/** A stretch of the text between two spaces, and where it starts. */
type Token = { readonly raw: string; readonly start: number };

function tokens(text: string): readonly Token[] {
  return [...text.matchAll(/\S+/gu)].map((match) => ({
    raw: match[0],
    start: match.index,
  }));
}

/** The token without the punctuation around it, and how much was cut off. */
function core(raw: string): { readonly word: string; readonly cut: number } {
  let from = 0;
  let to = raw.length;
  while (from < to && NOT_A_WORD_CHARACTER.test(raw[from])) from += 1;
  while (to > from && NOT_A_WORD_CHARACTER.test(raw[to - 1])) to -= 1;
  return { word: raw.slice(from, to), cut: from };
}

/** The form two spellings of one word share, under the rules given. */
function fold(word: string, rules: ReadonlySet<Rule>): string {
  let folded = word;
  if (rules.has("apostrophe")) {
    folded = folded.replace(TYPOGRAPHIC_APOSTROPHE, "'");
  }
  if (rules.has("case")) folded = folded.toLowerCase();
  return folded;
}

/**
 * The words a piece of text is made of, each with its place in the text. The
 * same reading for a term and for a sentence, so the two cannot disagree
 * about what a word is.
 */
function words(
  text: string,
  rules: ReadonlySet<Rule>,
): readonly { readonly word: string; readonly start: number }[] {
  const found = [];
  for (const token of tokens(text)) {
    if (!rules.has("punctuation")) {
      found.push({ word: token.raw, start: token.start });
      continue;
    }
    const { word, cut } = core(token.raw);
    // Nothing left: the token was punctuation, like the book's "...".
    if (word !== "") found.push({ word, start: token.start + cut });
  }
  return found;
}

/**
 * Where each vocabulary item counts as presented: its own point, or the
 * point of the latest member when it is in a contrast set.
 *
 * Measured on 2026-10-01: the project holds 21 sets and every one of them
 * sits inside a single point, so today this moves no word. It is here for
 * the set that reaches across points, which 0022 allows on purpose.
 */
export function presentationPlaces(
  vocabulary: readonly VocabularyWord[],
): readonly Place[] {
  const latest = new Map<string, Place>();
  for (const item of vocabulary) {
    if (item.setId === null) continue;
    const known = latest.get(item.setId);
    if (known === undefined || comparePlaces(item.place, known) > 0) {
      latest.set(item.setId, item.place);
    }
  }
  return vocabulary.map((item) =>
    item.setId === null ? item.place : (latest.get(item.setId) ?? item.place),
  );
}

export function createChecker(
  vocabulary: readonly VocabularyWord[],
  rules: readonly Rule[] = RULES,
): Checker {
  const on: ReadonlySet<Rule> = new Set(rules);
  const places = presentationPlaces(vocabulary);

  // The earliest place each word is presented at.
  const presented = new Map<string, Place>();
  vocabulary.forEach((item, index) => {
    const parts = on.has("termWords")
      ? words(item.term, on).map((part) => part.word)
      : [item.term];
    for (const part of parts) {
      const key = fold(part, on);
      const known = presented.get(key);
      if (known === undefined || comparePlaces(places[index], known) < 0) {
        presented.set(key, places[index]);
      }
    }
  });

  /** Undefined when presented by `at`; otherwise where, or null for nowhere. */
  function missing(word: string, at: Place): Place | null | undefined {
    const place = presented.get(fold(word, on));
    if (place === undefined) return null;
    return comparePlaces(place, at) <= 0 ? undefined : place;
  }

  return {
    check(text, at) {
      const marks: Mark[] = [];
      for (const { word, start } of words(text, on)) {
        let presentedAt = missing(word, at);
        if (presentedAt === undefined) continue;

        if (on.has("contractedIs") && CONTRACTED_IS.test(word)) {
          const stem = missing(word.slice(0, -2), at);
          if (stem === undefined) continue;
          // The word itself may be an item of its own ("there's"); when it
          // is not, what is known about it is what is known about its stem.
          presentedAt ??= stem;
        }

        marks.push({ start, end: start + word.length, word, presentedAt });
      }
      return marks;
    },
  };
}

/*
 * WHAT WAS MEASURED AND LEFT OUT, so nobody adds it from memory.
 *
 * - Plural and third person (books, opens). Lesson 1 and Dictation 1 print
 *   none that is marked: 0 of the 7. The plural arrives at point 14. With
 *   nothing to remove there is no rule, and one that strips an s is not
 *   harmless. Measure it on lesson 3 before writing it.
 * - Names of the cast and of places. Reading a capital as a name would take
 *   6 of the 7 remaining marks away, and all 6 are true. The names stay
 *   marked, and the teacher decides.
 * - Other contractions (n't, 're, 'm). Lesson 1 prints only isn't, which is
 *   in a vocabulary item. Nothing to remove.
 * - The words only a grammar table teaches (he, she, I, am, are). They are
 *   in blocks and not in vocabulary_items, so they are marked: 2 of the 80
 *   words of Dictation 1 (he, She's), the only marks it has. Ending that is
 *   a decision about where those words are stored, not a normalisation.
 */
