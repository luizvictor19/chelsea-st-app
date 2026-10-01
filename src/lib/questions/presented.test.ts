import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  RULES,
  comparePlaces,
  createChecker,
  presentationPlaces,
  type Rule,
  type VocabularyWord,
} from "./presented.ts";

/** A small vocabulary in the shapes the project's terms really take. */
function item(
  term: string,
  point: number,
  setId: string | null = null,
  book = 1,
): VocabularyWord {
  return { term, place: { book, point }, setId };
}

const VOCABULARY: readonly VocabularyWord[] = [
  item("a", 1),
  item("lamp", 1),
  item("what is (what's)", 1),
  item("it is (it's)", 1),
  item("this", 1),
  item("is this?", 2),
  item("it is not (isn't)", 2),
  item("no", 2),
  item("the", 3),
  item("grey", 4),
  item("Grey", 9),
  item("Mrs", 4),
  item("shelf", 5),
  item("on", 5),
  item("etc.", 8),
  item("garden", 8),
  item("there's", 9),
  item("there", 12),
];

const at = (point: number, book = 1) => ({ book, point });

function marked(
  text: string,
  point: number,
  rules: readonly Rule[] = RULES,
  vocabulary = VOCABULARY,
): readonly string[] {
  return createChecker(vocabulary, rules)
    .check(text, at(point))
    .map((mark) => mark.word);
}

const without = (rule: Rule) => RULES.filter((other) => other !== rule);

describe("the question validator", () => {
  test("marks nothing in a sentence made of presented words", () => {
    assert.deepEqual(marked("Is this a lamp?", 2), []);
    assert.deepEqual(marked("No, it isn't a lamp; it's the shelf.", 5), []);
  });

  test("marks a word no vocabulary item carries, with no place", () => {
    const marks = createChecker(VOCABULARY).check("Is this a kettle?", at(2));
    assert.deepEqual(marks, [
      { start: 10, end: 16, word: "kettle", presentedAt: null },
    ]);
  });

  test("marks a word presented later, and says where", () => {
    const marks = createChecker(VOCABULARY).check(
      "Is the lamp in the garden?",
      at(5),
    );
    assert.deepEqual(
      marks.map((mark) => [mark.word, mark.presentedAt]),
      [
        ["in", null],
        ["garden", { book: 1, point: 8 }],
      ],
    );
  });

  test("a word counts at its own point, not only after it", () => {
    assert.deepEqual(marked("the garden", 8), []);
    assert.deepEqual(marked("the garden", 7), ["garden"]);
  });

  test("an earlier book counts whole, a later one not at all", () => {
    const vocabulary = [item("lamp", 40, null, 1), item("shelf", 2, null, 2)];
    const checker = createChecker(vocabulary);
    assert.deepEqual(checker.check("lamp shelf", at(2, 2)), []);
    assert.deepEqual(
      checker.check("lamp shelf", at(50, 1)).map((mark) => mark.word),
      ["shelf"],
    );
  });

  test("the mark covers the word and leaves the punctuation out", () => {
    const text = "No, (kettle) isn't this.";
    const [mark] = createChecker(VOCABULARY).check(text, at(2));
    assert.equal(text.slice(mark.start, mark.end), "kettle");
  });
});

describe("each rule, taken out on its own", () => {
  test("punctuation: a word keeps its meaning next to a mark", () => {
    assert.deepEqual(marked("Is this a lamp?", 2), []);
    assert.deepEqual(marked("Is this a lamp?", 2, without("punctuation")), [
      "lamp?",
    ]);
  });

  test("punctuation: a token with no letter or digit is not a word", () => {
    assert.deepEqual(marked("The lamp's ...", 3), []);
    assert.deepEqual(marked("The lamp's ...", 3, without("punctuation")), [
      "...",
    ]);
  });

  test("punctuation: a term is read the way a sentence is", () => {
    // "etc." is stored with its stop, and typed with or without one.
    assert.deepEqual(marked("the lamp etc.", 8), []);
    assert.deepEqual(marked("the lamp, etc, this", 8), []);
  });

  test("case: a capital at the head of a sentence is the same word", () => {
    assert.deepEqual(marked("This is a lamp", 2), []);
    assert.deepEqual(marked("This is a lamp", 2, without("case")), ["This"]);
  });

  test("case: a capitalised term is found in either case", () => {
    assert.deepEqual(marked("is this mrs", 4), []);
    assert.deepEqual(marked("is this mrs", 4, without("case")), ["mrs"]);
  });

  test("case: a name spelled like a word is read as the word", () => {
    // The surname is boxed at point 9 and the colour at point 4. Folded, the
    // two are one word, presented at the earlier of the two.
    assert.deepEqual(marked("is this Mrs Grey?", 4), []);
    assert.deepEqual(marked("is this Mrs Grey?", 4, without("case")), ["Grey"]);
  });

  test("termWords: every word of a term is presented by it", () => {
    assert.deepEqual(marked("what is this", 1), []);
    assert.deepEqual(marked("what's this", 1), []);
    assert.deepEqual(marked("what is this", 1, without("termWords")), [
      "what",
      "is",
    ]);
  });

  test("termWords: a word is presented by the earliest term holding it", () => {
    // "is" is in a term of point 1 and in one of point 2.
    assert.deepEqual(marked("is", 1), []);
  });

  test("apostrophe: the typographic one is the typed one", () => {
    assert.deepEqual(marked("it isn’t a lamp", 2), []);
    assert.deepEqual(marked("it isn’t a lamp", 2, without("apostrophe")), [
      "isn’t",
    ]);
  });

  test("contractedIs: 's on a presented word is presented", () => {
    assert.deepEqual(marked("The lamp's on the shelf", 5), []);
    assert.deepEqual(
      marked("The lamp's on the shelf", 5, without("contractedIs")),
      ["lamp's"],
    );
  });

  test("contractedIs: it holds for the typographic apostrophe by itself", () => {
    assert.deepEqual(marked("The lamp’s on the shelf", 5), []);
    assert.deepEqual(
      marked("The lamp’s on the shelf", 5, without("apostrophe")),
      [],
    );
  });

  test("contractedIs: 's on an unpresented word is marked, whole", () => {
    const marks = createChecker(VOCABULARY).check("The garden's grey", at(5));
    assert.deepEqual(marks, [
      {
        start: 4,
        end: 12,
        word: "garden's",
        presentedAt: { book: 1, point: 8 },
      },
    ]);
    assert.deepEqual(marked("The kettle's grey", 5), ["kettle's"]);
  });

  test("contractedIs: a contraction that is an item says its own point", () => {
    // "there's" is an item of point 9; "there" alone comes at point 12.
    const [mark] = createChecker(VOCABULARY).check("there's a lamp", at(5));
    assert.deepEqual(mark.presentedAt, { book: 1, point: 9 });
    assert.deepEqual(marked("there's a lamp", 9), []);
  });

  test("no rule strips a final s", () => {
    assert.deepEqual(marked("the lamps", 5), ["lamps"]);
  });
});

describe("contrast sets", () => {
  const vocabulary = [
    item("the", 1),
    item("red", 3, "colours"),
    item("pink", 3, "colours"),
    item("teal", 7, "colours"),
    item("tall", 3, "sizes"),
    item("tiny", 3, "sizes"),
  ];

  test("a set counts at the point of its latest member", () => {
    assert.deepEqual(
      presentationPlaces(vocabulary).map((place) => place.point),
      [1, 7, 7, 7, 3, 3],
    );
  });

  test("a member is marked until the whole set has been presented", () => {
    assert.deepEqual(marked("the red", 3, RULES, vocabulary), ["red"]);
    assert.deepEqual(marked("the red", 6, RULES, vocabulary), ["red"]);
    assert.deepEqual(marked("the red", 7, RULES, vocabulary), []);
    const [mark] = createChecker(vocabulary).check("the red", at(3));
    assert.deepEqual(mark.presentedAt, { book: 1, point: 7 });
  });

  test("a set inside one point moves nothing", () => {
    assert.deepEqual(marked("the tall tiny", 3, RULES, vocabulary), []);
  });

  test("the latest member is found across books", () => {
    const acrossBooks = [
      item("red", 40, "colours", 1),
      item("teal", 2, "colours", 2),
    ];
    assert.deepEqual(presentationPlaces(acrossBooks), [
      { book: 2, point: 2 },
      { book: 2, point: 2 },
    ]);
  });
});

describe("comparePlaces", () => {
  test("orders by book, then by point", () => {
    assert.ok(comparePlaces(at(52, 1), at(1, 2)) < 0);
    assert.ok(comparePlaces(at(3, 1), at(2, 1)) > 0);
    assert.equal(comparePlaces(at(3, 1), at(3, 1)), 0);
  });
});
