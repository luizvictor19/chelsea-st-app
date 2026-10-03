import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  HIGH_ABOVE,
  LOW_BELOW,
  NO_USAGE,
  bandOf,
  countUsage,
  countedSentences,
  createUsageReader,
  meanUsage,
  usageTotal,
  type UsageQuestion,
  type UsageWord,
} from "./word-usage.ts";

/** The id is the term, so a result reads as the words it found. */
function item(term: string, wordClass: string | null = null): UsageWord {
  return { id: term, term, wordClass };
}

/** Terms in the shapes the project's vocabulary really holds. */
const VOCABULARY: readonly UsageWord[] = [
  item("a"),
  item("pen", "noun"),
  item("pencil", "noun"),
  item("book", "noun"),
  item("table", "noun"),
  item("the"),
  item("this"),
  item("yes"),
  item("no"),
  item("what is (what's)", "phrase"),
  item("it is (it's)", "phrase"),
  item("is this?", "phrase"),
  item("it is not (isn't)", "phrase"),
  item("what colour?", "question_word"),
  item("taking from", "verb"),
  item("putting on", "verb"),
  item("on", "preposition"),
  item("coming from"),
  item("there's"),
  item("etc."),
];

const reader = createUsageReader(VOCABULARY);

function used(...sentences: string[]): readonly string[] {
  return [...reader.used(sentences)].sort();
}

function question(
  prompt: string,
  expectedAnswer: string,
  isPublished = true,
  answerLanguage: "en" | "pt" = "en",
): UsageQuestion {
  return { prompt, expectedAnswer, answerLanguage, isPublished };
}

describe("the words a sentence uses", () => {
  test("a word is found the way the validator reads it", () => {
    // Punctuation, the capital and the typographic apostrophe are all folded.
    assert.deepEqual(used("Yes, THIS pen."), ["pen", "this", "yes"]);
    assert.deepEqual(used("the pen, etc"), ["etc.", "pen", "the"]);
    assert.deepEqual(used("it isn’t"), ["it is not (isn't)"]);
  });

  test("a word no term holds uses nothing", () => {
    assert.deepEqual(used("kettle"), []);
    assert.deepEqual(used(""), []);
  });

  test("a term of several words needs its words in a row", () => {
    assert.deepEqual(used("Is this a pen?"), ["a", "is this?", "pen", "this"]);
    // "is" and "this" are both there, and not together.
    assert.deepEqual(used("This pen is on the table"), [
      "on",
      "pen",
      "table",
      "the",
      "this",
    ]);
  });

  test("one word of a term is not the term", () => {
    // The validator reads "is" as presented by four terms; the count does not.
    assert.deepEqual(used("is"), []);
    assert.deepEqual(used("what"), []);
  });

  test("the form in brackets counts for the term", () => {
    assert.deepEqual(used("No, it isn't a pen"), [
      "a",
      "it is not (isn't)",
      "no",
      "pen",
    ]);
    assert.deepEqual(used("What's this?"), ["this", "what is (what's)"]);
    assert.deepEqual(used("What is this?"), [
      "is this?",
      "this",
      "what is (what's)",
    ]);
  });

  test("a term found inside a longer one counts as well", () => {
    // "it is not" holds "it is": the sentence does say it.
    assert.deepEqual(used("it is not"), ["it is (it's)", "it is not (isn't)"]);
  });

  test("a contracted is on a noun is the noun", () => {
    assert.deepEqual(used("The pen's on the table"), [
      "on",
      "pen",
      "table",
      "the",
    ]);
  });

  test("a contraction that is a term of its own is not its stem", () => {
    assert.deepEqual(used("it's"), ["it is (it's)"]);
    assert.deepEqual(used("there's"), ["there's"]);
  });

  test("what colour? is found with is contracted onto colour", () => {
    assert.deepEqual(used("What colour's this pencil?"), [
      "pencil",
      "this",
      "what colour?",
    ]);
  });

  test("a verb of several words is found with words between its own", () => {
    assert.deepEqual(used("I'm taking the book from the table"), [
      "book",
      "table",
      "taking from",
      "the",
    ]);
    assert.deepEqual(used("You're putting the pen on the book"), [
      "book",
      "on",
      "pen",
      "putting on",
      "the",
    ]);
  });

  test("a verb of several words needs its words in their order", () => {
    assert.deepEqual(used("from the table taking"), ["table", "the"]);
    assert.deepEqual(used("on the book, putting"), ["book", "on", "the"]);
  });

  test("a verb of several words is found inside one sentence only", () => {
    assert.deepEqual(used("taking the book", "from the table"), [
      "book",
      "table",
      "the",
    ]);
  });

  test("only a verb may stand apart", () => {
    // "coming from" has no word class: its words are wanted in a row.
    assert.deepEqual(used("coming the from"), ["the"]);
    assert.deepEqual(used("coming from the table"), [
      "coming from",
      "table",
      "the",
    ]);
    assert.deepEqual(used("what is the colour"), ["the", "what is (what's)"]);
  });
});

describe("countedSentences", () => {
  test("an English answer is read, a Portuguese one is not", () => {
    assert.deepEqual(countedSentences(question("a pen", "the book")), [
      "a pen",
      "the book",
    ]);
    assert.deepEqual(
      countedSentences(question("a pen", "a caneta no livro", true, "pt")),
      ["a pen"],
    );
  });
});

describe("countUsage", () => {
  test("counts questions, published and not, apart", () => {
    const usage = countUsage(reader, [
      question("Is this a pen?", "Yes, it's a pen."),
      question("Is this a book?", "No, it isn't a book; it's a pen.", false),
      question("What's this?", "It's a book.", false),
    ]);
    assert.deepEqual(usage.get("pen"), { published: 1, unpublished: 1 });
    assert.deepEqual(usage.get("book"), { published: 0, unpublished: 2 });
    assert.deepEqual(usage.get("is this?"), { published: 1, unpublished: 1 });
    assert.deepEqual(usage.get("it is (it's)"), {
      published: 1,
      unpublished: 2,
    });
    assert.deepEqual(usage.get("it is not (isn't)"), {
      published: 0,
      unpublished: 1,
    });
    assert.equal(usageTotal(usage.get("pen") ?? NO_USAGE), 2);
  });

  test("a word written twice in one question counts once", () => {
    const usage = countUsage(reader, [
      question("Is this pen a pen?", "Yes, the pen is a pen."),
    ]);
    assert.deepEqual(usage.get("pen"), { published: 1, unpublished: 0 });
    assert.deepEqual(usage.get("a"), { published: 1, unpublished: 0 });
  });

  test("a word no question uses is not in the map", () => {
    const usage = countUsage(reader, [question("a pen", "a pen")]);
    assert.equal(usage.get("table"), undefined);
    assert.equal(usageTotal(usage.get("table") ?? NO_USAGE), 0);
  });

  test("a word only in a Portuguese answer is not counted", () => {
    const usage = countUsage(reader, [question("a pen", "no", true, "pt")]);
    assert.equal(usage.get("no"), undefined);
  });

  test("no question, no usage", () => {
    assert.equal(countUsage(reader, []).size, 0);
  });
});

describe("meanUsage", () => {
  test("is the mean of the words some question uses", () => {
    assert.equal(meanUsage([4, 0, 2, 0]), 3);
    assert.equal(meanUsage([4, 2]), 3);
  });

  test("is zero when no word has a question", () => {
    assert.equal(meanUsage([0, 0, 0]), 0);
  });

  test("is zero for a lesson with no word", () => {
    assert.equal(meanUsage([]), 0);
  });
});

describe("bandOf", () => {
  test("the factors are the ones asked for", () => {
    assert.equal(LOW_BELOW, 0.5);
    assert.equal(HIGH_ABOVE, 2);
  });

  test("zero is its own band, whatever the mean", () => {
    assert.equal(bandOf(0, 0), "none");
    assert.equal(bandOf(0, 4), "none");
  });

  test("a lesson with no question at all is all none", () => {
    const counts = [0, 0, 0];
    const mean = meanUsage(counts);
    assert.equal(mean, 0);
    assert.deepEqual(
      counts.map((count) => bandOf(count, mean)),
      ["none", "none", "none"],
    );
  });

  test("under half the mean is low, and half of it is medium", () => {
    assert.equal(bandOf(1, 4), "low");
    assert.equal(bandOf(2, 4), "medium");
  });

  test("over twice the mean is high, and twice it is medium", () => {
    assert.equal(bandOf(8, 4), "medium");
    assert.equal(bandOf(9, 4), "high");
  });

  test("the words with no question do not move the lines", () => {
    // One word asked about four times, among words never asked about: the
    // mean is 4, and that word is in the middle of its own lesson.
    const counts = [4, 0, 0, 0];
    const mean = meanUsage(counts);
    assert.deepEqual(
      counts.map((count) => bandOf(count, mean)),
      ["medium", "none", "none", "none"],
    );
  });

  test("a mean that is not whole keeps the lines where they are", () => {
    // Mean 1.5: low under 0.75, high over 3.
    assert.equal(bandOf(1, 1.5), "medium");
    assert.equal(bandOf(3, 1.5), "medium");
    assert.equal(bandOf(4, 1.5), "high");
  });
});
