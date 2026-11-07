import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TEXT_PRICES } from "../text/cost.ts";

import {
  MAX_PAIRS,
  MIN_PAIRS,
  PAIRS_PER_POINT,
  SUGGEST_QUESTIONS_MODEL,
  SUGGEST_QUESTIONS_SCHEMA,
  buildSuggestQuestionsPrompt,
  draftImage,
  parseDrafts,
  pendingTerms,
  presentedSets,
  resolveImage,
  shownAs,
  type SuggestWord,
} from "./suggest-questions.ts";

/*
 * Book 1 as the database held it on 2026-11-06, cut down: the numbers of
 * points 5 and 7 have no natural question until "How many?" (point 28), and
 * the 10 published questions sit at points 1 to 3.
 */
describe("pendingTerms", () => {
  const BOOK = [
    { point: 1, term: "pen", kind: "photo" },
    { point: 1, term: "this", kind: "usage" },
    { point: 3, term: "large", kind: "figure" },
    { point: 3, term: "contraction", kind: "metalanguage" },
    { point: 5, term: "in", kind: "figure" },
    { point: 5, term: "one", kind: "symbol" },
    { point: 5, term: "two", kind: "symbol" },
    { point: 7, term: "six", kind: "symbol" },
    { point: 7, term: "where", kind: "usage" },
    { point: 9, term: "in front of", kind: "figure" },
    { point: 9, term: "behind", kind: "figure" },
    { point: 9, term: "Tom", kind: null },
  ];
  const asked = (point: number, prompt: string, answer: string) => ({
    point,
    prompt,
    expectedAnswer: answer,
    answerLanguage: "en" as const,
  });
  const PUBLISHED = [
    asked(1, "Is this a pen?", "Yes, it’s a pen."),
    asked(3, "Is the box large?", "Yes, it’s large."),
    asked(6, "Where’s the pen? Is it in the box?", "It’s in the box."),
  ];

  test("the numbers wait, and a word a question uses does not", () => {
    assert.deepEqual(pendingTerms(BOOK, PUBLISHED, 8), ["one", "two", "six"]);
  });

  test("only earlier points count, on both sides", () => {
    // At point 5 the question of point 6 has not happened, and in is new.
    assert.deepEqual(pendingTerms(BOOK, PUBLISHED, 5), []);
    assert.deepEqual(pendingTerms(BOOK, PUBLISHED, 6), ["in", "one", "two"]);
  });

  test("a term of several words needs all of them", () => {
    const front = [
      asked(
        9,
        "Is the pen in front of the box?",
        "Yes, it’s in front of the box.",
      ),
    ];
    const half = [asked(9, "Is the pen in the box?", "Yes, it’s in the box.")];
    assert.ok(!pendingTerms(BOOK, front, 10).includes("in front of"));
    assert.ok(pendingTerms(BOOK, half, 10).includes("in front of"));
  });

  test("usage, metalanguage and a kind not decided never wait", () => {
    const pending = pendingTerms(BOOK, [], 10);
    for (const never of ["this", "contraction", "where", "Tom"]) {
      assert.ok(!pending.includes(never), never);
    }
  });

  test("an answer in Portuguese uses no English word", () => {
    const translated = [
      {
        ...asked(2, "The pen.", "Uma caneta pen."),
        answerLanguage: "pt" as const,
      },
    ];
    assert.ok(!pendingTerms(BOOK, translated, 3).includes("pen"));
    const onlyAnswer = [
      {
        point: 2,
        prompt: "O que é isto?",
        expectedAnswer: "pen",
        answerLanguage: "pt" as const,
      },
    ];
    assert.ok(pendingTerms(BOOK, onlyAnswer, 3).includes("pen"));
  });
});

describe("the pending line of the prompt", () => {
  const words: readonly SuggestWord[] = [
    {
      point: 5,
      term: "one",
      class: "numeral",
      kind: "symbol",
      picture: false,
      subject: null,
      set: null,
    },
    {
      point: 8,
      term: "cup",
      class: "noun",
      kind: "photo",
      picture: true,
      subject: "a cup",
      set: null,
    },
  ];
  const at = (pending?: readonly string[]) =>
    buildSuggestQuestionsPrompt({
      book: 1,
      point: 8,
      words,
      scenes: [],
      pending,
    }).user;

  test("is there only when something waits", () => {
    assert.doesNotMatch(at(), /no question uses yet/u);
    assert.doesNotMatch(at([]), /no question uses yet/u);
    assert.match(at(["one", "two"]), /no question uses yet .*: one, two$/u);
  });
});

describe("draftImage", () => {
  const WORDS = [
    { id: "w-pen", term: "pen", picture: true },
    { id: "w-the", term: "the", picture: false },
  ];
  const SCENES = [
    { id: "s-box", description: "No, the box isn’t small; it’s large" },
  ];

  test("gives the ids the form keeps", () => {
    assert.deepEqual(
      draftImage({ imageKind: "word", image: "Pen" }, WORDS, SCENES),
      { kind: "word", id: "w-pen" },
    );
    assert.deepEqual(
      draftImage(
        { imageKind: "scene", image: "No, the box isn't small; it's large" },
        WORDS,
        SCENES,
      ),
      { kind: "scene", id: "s-box" },
    );
    assert.deepEqual(
      draftImage(
        { imageKind: "new_scene", image: "a pen on a box" },
        WORDS,
        SCENES,
      ),
      {
        kind: "new_scene",
        description: "a pen on a box",
      },
    );
    assert.deepEqual(
      draftImage({ imageKind: "acted_out", image: "" }, WORDS, SCENES),
      { kind: "acted" },
    );
  });

  test("a picture that does not exist is none, with the reason in Portuguese", () => {
    const none = draftImage({ imageKind: "word", image: "the" }, WORDS, SCENES);
    assert.deepEqual(none, {
      kind: "none",
      reason: "a palavra sugerida ainda não tem imagem aprovada",
    });
    const gone = draftImage({ imageKind: "word", image: "cup" }, WORDS, SCENES);
    assert.equal(
      gone.kind === "none" ? gone.reason : null,
      "a palavra sugerida para a imagem não existe neste ponto",
    );
  });
});

test("the chosen model has a price, so the button can log what it cost", () => {
  assert.ok(Object.hasOwn(TEXT_PRICES, SUGGEST_QUESTIONS_MODEL));
});

/*
 * Synthetic, in the geometry of book 1: terms of several words, a contrast
 * set that closes only at its latest member, a word with a picture and no
 * subject, a word about grammar, and a future point whose words must never
 * reach the prompt.
 */
function word(
  point: number,
  term: string,
  extra: Partial<SuggestWord> = {},
): SuggestWord {
  return {
    point,
    term,
    class: "noun",
    kind: "photo",
    picture: true,
    subject: `the ${term} on its own`,
    set: null,
    ...extra,
  };
}

const WORDS: readonly SuggestWord[] = [
  word(1, "cup"),
  word(1, "it is (it's)", {
    class: "phrase",
    kind: "usage",
    picture: false,
    subject: null,
  }),
  word(2, "is this?", {
    class: "phrase",
    kind: "usage",
    picture: false,
    subject: null,
  }),
  word(2, "hot", { class: "adjective", kind: "figure", set: "s1" }),
  word(2, "plural", { kind: "metalanguage", picture: false, subject: null }),
  word(3, "cold", { class: "adjective", kind: "figure", set: "s1" }),
  word(3, "Tom", { subject: null }),
  word(4, "kettle"),
];

const SCENES = [
  { description: "No, the cup isn’t hot; it’s cold", point: 3 },
  { description: "the kettle on the cup", point: 4 },
];

const at = (point: number) =>
  buildSuggestQuestionsPrompt({ book: 1, point, words: WORDS, scenes: SCENES });

describe("buildSuggestQuestionsPrompt", () => {
  test("no word of a later point reaches the prompt", () => {
    const { system, user } = at(3);
    assert.doesNotMatch(user + system, /kettle/u);
  });

  test("the new words are listed as new, and not among the earlier ones", () => {
    const { user } = at(3);
    const [earlier, fresh] = user.split("New words of this point:");
    assert.match(fresh ?? "", /- cold ·/u);
    assert.match(fresh ?? "", /- Tom ·/u);
    assert.doesNotMatch(earlier ?? "", /- cold ·|- Tom ·/u);
    assert.match(earlier ?? "", /- cup ·/u);
    assert.match(earlier ?? "", /- is this\? ·/u);
  });

  test("the first point says nothing came before it", () => {
    assert.match(at(1).user, /- none: this is the first point/u);
  });

  test("a set is shown once its latest member is presented", () => {
    assert.match(at(2).user, /Shown side by side: none/u);
    assert.match(at(3).user, /Shown side by side: hot\/cold/u);
  });

  test("a scene enters only from its point", () => {
    assert.match(at(2).user, /Existing scenes:\n- none/u);
    assert.match(at(3).user, /- "No, the cup isn’t hot; it’s cold"/u);
    assert.doesNotMatch(at(3).user, /kettle/u);
  });

  test("a point with no new words is refused", () => {
    assert.throws(() =>
      buildSuggestQuestionsPrompt({
        book: 1,
        point: 9,
        words: WORDS,
        scenes: [],
      }),
    );
  });

  test("the schema closes every object and asks nothing structured outputs refuse", () => {
    const text = JSON.stringify(SUGGEST_QUESTIONS_SCHEMA);
    assert.doesNotMatch(text, /minItems|maxItems|minLength|maxLength/u);
    assert.equal(text.match(/"additionalProperties":false/gu)?.length, 2);
  });
});

describe("the count the teacher chooses", () => {
  const build = (count?: number) =>
    buildSuggestQuestionsPrompt({
      book: 1,
      point: 3,
      words: WORDS,
      scenes: SCENES,
      count,
    });

  test("is the number asked for, the default when left out", () => {
    assert.match(
      build().system,
      new RegExp(`Write ${PAIRS_PER_POINT} question and answer pairs`, "u"),
    );
    assert.match(build(12).system, /Write 12 question and answer pairs/u);
    assert.match(build(1).system, /Write one question and answer pair for/u);
  });

  test("outside the range, or not whole, is refused before anything is asked", () => {
    for (const count of [MIN_PAIRS - 1, MAX_PAIRS + 1, 2.5, Number.NaN]) {
      assert.throws(() => build(count), String(count));
    }
    assert.doesNotThrow(() => build(MIN_PAIRS));
    assert.doesNotThrow(() => build(MAX_PAIRS));
  });
});

describe("shownAs", () => {
  test("follows what the database holds about the word", () => {
    assert.equal(shownAs(WORDS[0]!), "picture: the cup on its own");
    assert.equal(
      shownAs(word(3, "Tom", { subject: null })),
      "picture exists, what it shows is not recorded",
    );
    assert.equal(shownAs(WORDS[1]!), "no picture, used in sentences");
    assert.equal(shownAs(WORDS[4]!), "a word about grammar, never asked");
    assert.equal(
      shownAs(word(5, "six", { kind: "symbol", picture: false })),
      "no picture",
    );
  });
});

describe("presentedSets", () => {
  test("keeps the members in the order given", () => {
    assert.deepEqual(presentedSets(WORDS, 4), [["hot", "cold"]]);
  });
});

const PAIR = {
  prompt: "Is this a cup?",
  expected_answer: "Yes, it's a cup",
  answer_language: "en",
  image_kind: "word",
  image: "cup",
  practises: "cup",
};

describe("parseDrafts", () => {
  test("reads the schema's shape", () => {
    const parsed = parseDrafts(
      JSON.stringify({ questions: [PAIR], pending: ["plural"] }),
    );
    assert.deepEqual(parsed, {
      ok: true,
      questions: [
        {
          prompt: "Is this a cup?",
          expectedAnswer: "Yes, it's a cup",
          answerLanguage: "en",
          imageKind: "word",
          image: "cup",
          practises: "cup",
        },
      ],
      pending: ["plural"],
    });
  });

  test("refuses, with the reason, what is off the schema", () => {
    const cases: [string, string][] = [
      ["{", "not json"],
      ["[]", "no questions"],
      [JSON.stringify({ questions: [] }), "no pending list"],
      [
        JSON.stringify({ questions: [{ ...PAIR, prompt: 1 }], pending: [] }),
        "question 1: no prompt",
      ],
      [
        JSON.stringify({
          questions: [{ ...PAIR, image_kind: "chart" }],
          pending: [],
        }),
        "question 1: image_kind",
      ],
      [
        JSON.stringify({
          questions: [{ ...PAIR, answer_language: "es" }],
          pending: [],
        }),
        "question 1: answer_language",
      ],
    ];
    for (const [text, reason] of cases) {
      assert.deepEqual(parseDrafts(text), { ok: false, reason }, text);
    }
  });
});

describe("resolveImage", () => {
  const presented = WORDS.filter((w) => w.point <= 3);

  test("a word matches whatever its case and apostrophe", () => {
    const tom = resolveImage(
      { imageKind: "word", image: "TOM" },
      presented,
      SCENES,
    );
    assert.equal(tom.kind === "word" ? tom.word.term : null, "Tom");
  });

  test("a word that does not exist, or has no picture, is invalid", () => {
    assert.deepEqual(
      resolveImage({ imageKind: "word", image: "kettle" }, presented, SCENES),
      {
        kind: "invalid",
        reason: "no such word",
      },
    );
    assert.deepEqual(
      resolveImage(
        { imageKind: "word", image: "it is (it's)" },
        presented,
        SCENES,
      ),
      {
        kind: "invalid",
        reason: "word has no picture",
      },
    );
  });

  test("a scene matches its description with a typed apostrophe", () => {
    const scene = resolveImage(
      { imageKind: "scene", image: "No, the cup isn't hot; it's cold" },
      presented,
      SCENES,
    );
    assert.equal(scene.kind, "scene");
    assert.deepEqual(
      resolveImage({ imageKind: "scene", image: "a dog" }, presented, SCENES),
      {
        kind: "invalid",
        reason: "no such scene",
      },
    );
  });

  test("acted out and a new scene are what they say", () => {
    assert.deepEqual(
      resolveImage({ imageKind: "acted_out", image: "" }, presented, SCENES),
      {
        kind: "acted_out",
      },
    );
    assert.deepEqual(
      resolveImage(
        { imageKind: "new_scene", image: "a hot cup" },
        presented,
        SCENES,
      ),
      {
        kind: "new_scene",
        description: "a hot cup",
      },
    );
    assert.equal(
      resolveImage({ imageKind: "new_scene", image: "" }, presented, SCENES)
        .kind,
      "invalid",
    );
  });
});
