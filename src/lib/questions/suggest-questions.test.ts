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
  parseDrafts,
  presentedSets,
  resolveImage,
  shownAs,
  type SuggestWord,
} from "./suggest-questions.ts";

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
