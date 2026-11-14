import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { costMicroUsd } from "./cost.ts";
import { JudgeError } from "./errors.ts";
import { createFakeJudge, type FakeStep } from "./fake-judge.ts";
import {
  TAKE_REPLIES,
  countsAsAnswer,
  isAccepted,
  judgeTake,
  replyFor,
  type FailureLog,
  type JudgedTake,
} from "./judge-take.ts";
import { promptFingerprint } from "./prompt.ts";
import type { AnswerLanguage, Judgement } from "./provider.ts";

const RIGHT: Judgement = {
  heard: "Yes, it's a pen.",
  englishSpeech: true,
  noEnglishReason: null,
  matches: true,
  differences: [],
};

async function take(
  step: FakeStep,
  answerLanguage: AnswerLanguage = "en",
  log: FailureLog = () => {},
): Promise<JudgedTake> {
  return judgeTake(
    createFakeJudge([step]),
    {
      audio: new Uint8Array([1]),
      audioMs: 1200,
      question: answerLanguage === "en" ? "Is this a pen?" : "It's a pen.",
      expected: answerLanguage === "en" ? "Yes, it's a pen." : "É uma caneta.",
      answerLanguage,
    },
    { log },
  );
}

describe("judgeTake", () => {
  test("bate", async () => {
    const judged = await take({ judgement: RIGHT });
    assert.deepEqual(judged.outcome, { kind: "verdict", verdict: "match" });
    assert.equal(isAccepted(judged.outcome), true);
    assert.equal(replyFor(judged.outcome), null);
  });

  test("não bate, with only the differences that count", async () => {
    const judged = await take({
      judgement: {
        ...RIGHT,
        heard: "Yes, it is pen.",
        matches: false,
        differences: [
          { expected: "a", said: null, kind: "missing" },
          { expected: "Yes,", said: "Yes", kind: "replaced" },
        ],
      },
    });
    assert.deepEqual(judged.outcome, { kind: "verdict", verdict: "mismatch" });
    assert.deepEqual(judged.differences, [
      { expected: "a", said: null, kind: "missing" },
    ]);
    assert.equal(isAccepted(judged.outcome), false);
    assert.equal(countsAsAnswer(judged.outcome), true);
  });

  test('a difference of punctuation alone ("closed." against "closed") is dropped', async () => {
    const judged = await take({
      judgement: {
        ...RIGHT,
        heard: "No, the window is closed",
        matches: false,
        differences: [
          { expected: "closed.", said: "closed", kind: "replaced" },
        ],
      },
    });
    // The model said it does not match and named nothing substantive: the
    // recount calls that incerto, never a refusal of a right answer.
    assert.deepEqual(judged.outcome, {
      kind: "verdict",
      verdict: "uncertain",
    });
    const agreed = await take({
      judgement: {
        ...RIGHT,
        matches: true,
        differences: [
          { expected: "closed.", said: "closed", kind: "replaced" },
        ],
      },
    });
    assert.deepEqual(agreed.outcome, { kind: "verdict", verdict: "match" });
    assert.deepEqual(agreed.differences, []);
  });

  test("an accent is a difference that counts", async () => {
    const judged = await take(
      {
        judgement: {
          ...RIGHT,
          heard: "E uma caneta.",
          matches: false,
          differences: [{ expected: "É", said: "E", kind: "replaced" }],
        },
      },
      "pt",
    );
    assert.deepEqual(judged.outcome, { kind: "verdict", verdict: "mismatch" });
    assert.equal(judged.differences.length, 1);
  });

  test("fields that contradict each other are incerto, never an acceptance", async () => {
    const judged = await take({
      judgement: {
        ...RIGHT,
        matches: true,
        differences: [{ expected: "pen", said: "pan", kind: "replaced" }],
      },
    });
    assert.deepEqual(judged.outcome, {
      kind: "verdict",
      verdict: "uncertain",
    });
    assert.equal(isAccepted(judged.outcome), false);
    assert.equal(countsAsAnswer(judged.outcome), false);
    assert.equal(replyFor(judged.outcome), TAKE_REPLIES.again);
  });

  for (const reason of ["silence", "noise"] as const) {
    test(`${reason} is a retry`, async () => {
      const judged = await take({
        judgement: {
          heard: "",
          englishSpeech: false,
          noEnglishReason: reason,
          matches: false,
          differences: [],
        },
      });
      assert.deepEqual(judged.outcome, { kind: "retry", reason });
      assert.equal(replyFor(judged.outcome), "Again, please");
      assert.equal(countsAsAnswer(judged.outcome), false);
    });
  }

  test("only Portuguese, on an English question, is In English please", async () => {
    const judged = await take({
      judgement: {
        heard: "É uma caneta.",
        englishSpeech: false,
        noEnglishReason: "other_language",
        matches: false,
        differences: [],
      },
    });
    assert.deepEqual(judged.outcome, { kind: "other-language" });
    assert.equal(replyFor(judged.outcome), "In English, please.");
  });

  test("English, on a translation question, is não bate", async () => {
    const judged = await take(
      {
        judgement: {
          heard: "It's a pen.",
          englishSpeech: true,
          noEnglishReason: null,
          matches: false,
          differences: [
            { expected: "É", said: "It's", kind: "replaced" },
            { expected: "uma", said: "a", kind: "replaced" },
            { expected: "caneta", said: "pen", kind: "replaced" },
          ],
        },
      },
      "pt",
    );
    assert.deepEqual(judged.outcome, { kind: "verdict", verdict: "mismatch" });
  });

  test("a translation question never says In English please", async () => {
    const judged = await take(
      {
        judgement: {
          heard: "It's a pen.",
          englishSpeech: false,
          noEnglishReason: "other_language",
          matches: false,
          differences: [],
        },
      },
      "pt",
    );
    assert.notEqual(judged.outcome.kind, "other-language");
    assert.deepEqual(judged.outcome, {
      kind: "verdict",
      verdict: "uncertain",
    });
  });

  test("the translation prompt is the one named in the record", async () => {
    const judged = await take({ judgement: RIGHT }, "pt");
    assert.equal(judged.prompt, promptFingerprint("pt"));
    const english = await take({ judgement: RIGHT });
    assert.equal(english.prompt, promptFingerprint("en"));
  });

  for (const [name, error, kind] of [
    ["HTTP", new JudgeError("http", "body", 500), "http"],
    ["a timeout", new DOMException("late", "TimeoutError"), "timeout"],
    ["the network", new TypeError("fetch failed"), "network"],
    ["an unreadable answer", new JudgeError("unreadable", "x"), "unreadable"],
  ] as const) {
    test(`a failure of ${name} is the failure line, not an answer`, async () => {
      const judged = await take({ error });
      assert.deepEqual(judged.outcome, { kind: "failure", failure: kind });
      assert.equal(
        replyFor(judged.outcome),
        "Não consegui ouvir agora. Tente de novo.",
      );
      assert.equal(countsAsAnswer(judged.outcome), false);
      assert.equal(isAccepted(judged.outcome), false);
    });
  }

  test("the log of a failure has no word the person said", async () => {
    const said = "my secret sentence";
    const logged: unknown[] = [];
    await take(
      { error: new JudgeError("unreadable", `bad field: {"heard":"${said}"}`) },
      "en",
      (message, fields) => logged.push(message, fields),
    );
    assert.deepEqual(logged, [
      "judge failed",
      { judge: "openai-gpt-audio-1.5", kind: "unreadable", status: null },
    ]);
    assert.ok(!JSON.stringify(logged).includes(said));
  });

  test("the record carries what the turn stores", async () => {
    const usage = {
      audioInputTokens: 40,
      textInputTokens: 300,
      outputTokens: 50,
    };
    const judged = await take({ judgement: RIGHT, usage });
    assert.equal(judged.heard, RIGHT.heard);
    assert.equal(judged.judge, "openai-gpt-audio-1.5");
    assert.equal(judged.model, "fake");
    assert.equal(judged.answerLanguage, "en");
    assert.equal(judged.audioMs, 1200);
    assert.deepEqual(judged.usage, usage);
    // 40 × 32 + 300 × 2.5 + 50 × 10 micro-dollars.
    assert.equal(judged.costMicroUsd, 1280 + 750 + 500);
  });

  test("a failure is a record too, with no heard and no cost", async () => {
    const judged = await take({ error: new JudgeError("http", "x", 503) });
    assert.equal(judged.heard, null);
    assert.equal(judged.costMicroUsd, null);
    assert.equal(judged.audioMs, 1200);
    assert.deepEqual(judged.differences, []);
  });
});

describe("costMicroUsd", () => {
  test("rounds to a whole micro-dollar", () => {
    assert.equal(
      costMicroUsd(
        { audioInputTokens: 0, textInputTokens: 1, outputTokens: 0 },
        "openai-gpt-audio-1.5",
      ),
      3,
    );
  });

  test("is null without usage", () => {
    assert.equal(costMicroUsd(null, "openai-gpt-audio-1.5"), null);
  });
});
