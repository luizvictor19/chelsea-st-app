import assert from "node:assert/strict";
import { describe, test } from "node:test";

import Anthropic from "@anthropic-ai/sdk";

import type { TextProvider } from "../../../../lib/text/provider.ts";

import {
  COMMON_ONLY,
  COUNT_RANGE,
  NO_NEW_WORDS,
  POINT_GONE,
  QUESTIONS_WORDING,
  UNREADABLE,
  proposeQuestions,
  type BookWord,
  type PointInputs,
  type SuggestDeps,
} from "./suggest-flow.ts";

const word = (
  point: number,
  id: string,
  term: string,
  extra: Partial<BookWord> = {},
): BookWord => ({
  id,
  point,
  term,
  class: "noun",
  kind: "photo",
  picture: true,
  subject: `the ${term} on its own`,
  set: null,
  ...extra,
});

/** Book 1, cut down: point 5 brings in and the numbers, point 7 where. */
const INPUTS: PointInputs = {
  book: 1,
  point: 7,
  words: [
    word(1, "w-pen", "pen"),
    word(1, "w-it", "it is (it's)", {
      kind: "usage",
      picture: false,
      subject: null,
    }),
    word(2, "w-table", "table"),
    word(2, "w-box", "box"),
    word(3, "w-the", "the", { kind: "usage", picture: false, subject: null }),
    word(5, "w-in", "in", { kind: "figure" }),
    word(5, "w-on", "on", { kind: "figure" }),
    word(5, "w-one", "one", { kind: "symbol", picture: false, subject: null }),
    word(7, "w-where", "where", {
      kind: "usage",
      picture: false,
      subject: null,
    }),
    word(9, "w-behind", "behind", { kind: "figure" }),
  ],
  scenes: [
    { id: "s-pen", description: "the pen on the table" },
    { id: "s-cup", description: "the cup behind the box" },
  ],
  // One table before the point asked about, one after.
  tables: [
    { point: 3, content: "he is | he's\nshe is | she's" },
    { point: 9, content: "they are | they're" },
  ],
  questions: [
    {
      point: 2,
      prompt: "Is it a pen?",
      expectedAnswer: "Yes, it's a pen.",
      answerLanguage: "en",
    },
  ],
};

const DRAFT = {
  prompt: "Where's the pen?",
  expected_answer: "It's on the table.",
  answer_language: "en",
  image_kind: "scene",
  image: "the pen on the table",
  practises: "where",
};

function answering(drafts: unknown[], pending: string[] = []) {
  const asked: { system: string; user: string }[] = [];
  const provider: TextProvider = {
    async complete(input) {
      asked.push(input);
      return {
        text: JSON.stringify({ questions: drafts, pending }),
        model: "claude-haiku-5-5-20261001",
        usage: { inputTokens: 2_000, cachedInputTokens: 0, outputTokens: 900 },
      };
    },
  };
  return { provider, asked };
}

function deps(overrides: Partial<SuggestDeps> = {}) {
  const calls: string[] = [];
  const logs: Record<string, unknown>[] = [];
  const { provider } = answering([DRAFT]);
  const all: SuggestDeps = {
    canWrite: async () => {
      calls.push("canWrite");
      return true;
    },
    inputs: async () => {
      calls.push("inputs");
      return INPUTS;
    },
    provider: () => {
      calls.push("provider");
      return provider;
    },
    log: (line) => logs.push(line),
    ...overrides,
  };
  return { all, calls, logs };
}

describe("proposeQuestions", () => {
  test("a count outside 1 to 20 is refused before anything is read", async () => {
    for (const count of [0, 21, 2.5]) {
      const { all, calls } = deps();
      assert.deepEqual(await proposeQuestions(all, count), {
        ok: false,
        error: COUNT_RANGE,
      });
      assert.deepEqual(calls, []);
    }
  });

  test("nobody who cannot write common content reaches the paid call", async () => {
    const { all, calls } = deps({ canWrite: async () => false });
    assert.deepEqual(await proposeQuestions(all, 6), {
      ok: false,
      error: COMMON_ONLY,
    });
    assert.ok(!calls.includes("provider"));
  });

  test("a point gone, or one with no new word, asks nothing", async () => {
    const gone = deps({ inputs: async () => null });
    assert.deepEqual(await proposeQuestions(gone.all, 6), {
      ok: false,
      error: POINT_GONE,
    });
    assert.ok(!gone.calls.includes("provider"));
    const empty = deps({ inputs: async () => ({ ...INPUTS, point: 8 }) });
    assert.deepEqual(await proposeQuestions(empty.all, 6), {
      ok: false,
      error: NO_NEW_WORDS,
    });
    assert.ok(!empty.calls.includes("provider"));
  });

  test("the drafts come back with their picture as ids and the validator's marks", async () => {
    const { provider, asked } = answering(
      [
        DRAFT,
        {
          ...DRAFT,
          prompt: "Is the pen in the box?",
          expected_answer: "It's behind the box.",
          image_kind: "word",
          image: "in",
        },
      ],
      ["one: nothing to count yet"],
    );
    const { all, logs } = deps({ provider: () => provider });
    const result = await proposeQuestions(all, 6);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.model, "claude-haiku-5-5");
    assert.deepEqual(result.questions[0]?.image, {
      kind: "scene",
      id: "s-pen",
    });
    assert.deepEqual(result.questions[1]?.image, { kind: "word", id: "w-in" });
    // behind is presented at point 9, after the point asked about.
    assert.deepEqual(result.questions[1]?.marks, ["behind"]);
    assert.deepEqual(result.leftOut, ["one: nothing to count yet"]);
    // In book order; pen is used by the question of point 2, and the words
    // of usage never wait.
    assert.deepEqual(result.pending, ["box", "table", "in", "on", "one"]);
    // A scene whose words are not all presented is not offered.
    assert.match(asked[0]?.user ?? "", /the pen on the table/u);
    assert.doesNotMatch(asked[0]?.user ?? "", /the cup behind the box/u);
    assert.match(asked[0]?.user ?? "", /no question uses yet .*one/u);
    assert.equal(logs.at(-1)?.outcome, "ok");
    assert.equal(typeof logs.at(-1)?.usd, "number");
  });

  test("a word a grammar table taught by the point is not marked, one taught later is (#233)", async () => {
    const { provider } = answering([
      {
        ...DRAFT,
        prompt: "Where's she?",
        expected_answer: "She's in the box. They're on the table.",
      },
    ]);
    const { all } = deps({ provider: () => provider });
    const result = await proposeQuestions(all, 1);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.questions[0]?.marks, ["They're"]);
  });

  test("what is over the count is cut", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      ...DRAFT,
      prompt: `Where's the pen ${i}?`,
    }));
    const { provider } = answering(many);
    const { all, logs } = deps({ provider: () => provider });
    const result = await proposeQuestions(all, 3);
    assert.equal(result.ok ? result.questions.length : null, 3);
    assert.equal(logs.at(-1)?.returned, 5);
    assert.equal(logs.at(-1)?.kept, 3);
  });

  test("a failure is the teacher's sentence, with no cause on the answer and the reason in the log", async () => {
    const failing: TextProvider = {
      async complete() {
        throw new Anthropic.APIConnectionTimeoutError();
      },
    };
    const { all, logs } = deps({ provider: () => failing });
    const result = await proposeQuestions(all, 6);
    assert.equal(result.ok, false);
    assert.ok(!("cause" in result));
    assert.equal(
      result.ok ? null : result.error,
      "O Claude não respondeu agora. Tente de novo em instantes.",
    );
    assert.equal(logs.at(-1)?.outcome, "model_failed");
    assert.equal(typeof logs.at(-1)?.cause, "string");
  });

  test("an answer off the schema is unreadable", async () => {
    const odd: TextProvider = {
      async complete() {
        return { text: "{}", model: "m", usage: null };
      },
    };
    const { all, logs } = deps({ provider: () => odd });
    assert.deepEqual(await proposeQuestions(all, 6), {
      ok: false,
      error: UNREADABLE,
    });
    assert.equal(logs.at(-1)?.outcome, "unreadable");
  });

  test("the sentences are the teacher's language", () => {
    for (const text of [
      COUNT_RANGE,
      COMMON_ONLY,
      POINT_GONE,
      NO_NEW_WORDS,
      UNREADABLE,
      QUESTIONS_WORDING.stopped,
      QUESTIONS_WORDING.failed,
    ]) {
      assert.doesNotMatch(text, /—/u);
    }
  });
});
