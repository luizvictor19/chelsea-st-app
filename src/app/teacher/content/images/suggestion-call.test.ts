import assert from "node:assert/strict";
import { describe, test } from "node:test";

import Anthropic from "@anthropic-ai/sdk";

import {
  ClaudeKeyMissingError,
  ClaudeStopError,
} from "../../../../lib/text/claude.ts";
import type { TextProvider, TextUsage } from "../../../../lib/text/provider.ts";

import {
  CLAUDE_NOT_CONFIGURED,
  CLAUDE_NO_ANSWER,
  CLAUDE_REFUSED_REQUEST,
  CLAUDE_STOPPED,
  INSTRUCTION_WORDING,
  LESSON_WORDING,
  SCENE_SUGGESTION_FAILED,
} from "./claude-failure.ts";
import { WITNESS_DEADLINE_MS } from "./lost-batch.ts";
import {
  LESSON_CALL,
  SUGGESTION_CALL,
  askModel,
  usdOrNull,
} from "./suggestion-call.ts";

const USAGE: TextUsage = {
  inputTokens: 1_300,
  cachedInputTokens: 0,
  outputTokens: 400,
};

const PROMPT = { system: "the system", user: "the user" };

/** A provider that answers, or throws, without any network. */
function answering(text: string, usage: TextUsage | null = USAGE) {
  const asked: { system: string; user: string; json: true }[] = [];
  const provider: TextProvider = {
    async complete(input) {
      asked.push(input);
      return { text, model: "claude-haiku-5-5", usage };
    },
  };
  return { provider, asked };
}

function throwing(cause: unknown): TextProvider {
  return {
    async complete() {
      throw cause;
    },
  };
}

/** An SDK status error, built as the SDK builds it. */
function status<S extends number, T>(
  Kind: new (
    status: S,
    error: undefined,
    message: string,
    headers: Headers,
  ) => T,
  code: S,
): T {
  return new Kind(code, undefined, `status ${code}`, new Headers());
}

describe("askModel", () => {
  test("hands the prompt over as json and the answer back whole", async () => {
    const { provider, asked } = answering('{"subject": "a pen"}');
    const answer = await askModel(provider, PROMPT, LESSON_WORDING);
    assert.deepEqual(asked, [{ ...PROMPT, json: true }]);
    assert.deepEqual(answer, {
      ok: true,
      text: '{"subject": "a pen"}',
      model: "claude-haiku-5-5",
      usage: USAGE,
    });
  });

  test("a usage the provider could not read stays null", async () => {
    const answer = await askModel(
      answering("{}", null).provider,
      PROMPT,
      LESSON_WORDING,
    );
    assert.equal(answer.usage, null);
  });

  test("each failure is the teacher's sentence, with the reason in English beside it", async () => {
    const cases: [unknown, string][] = [
      [new ClaudeKeyMissingError(), CLAUDE_NOT_CONFIGURED],
      [status(Anthropic.AuthenticationError, 401), CLAUDE_NOT_CONFIGURED],
      [status(Anthropic.RateLimitError, 429), CLAUDE_NO_ANSWER],
      [status(Anthropic.InternalServerError, 500), CLAUDE_NO_ANSWER],
      [status(Anthropic.OverloadedError, 529), CLAUDE_NO_ANSWER],
      [new Anthropic.APIConnectionTimeoutError(), CLAUDE_NO_ANSWER],
      [new Anthropic.APIUserAbortError(), CLAUDE_NO_ANSWER],
      [status(Anthropic.BadRequestError, 400), CLAUDE_REFUSED_REQUEST],
      [status(Anthropic.NotFoundError, 404), CLAUDE_REFUSED_REQUEST],
    ];
    for (const [cause, sentence] of cases) {
      const answer = await askModel(throwing(cause), PROMPT, LESSON_WORDING);
      assert.equal(answer.ok, false);
      if (answer.ok) continue;
      assert.equal(answer.error, sentence, String(cause));
      assert.equal(answer.cause, (cause as Error).message);
      assert.equal(answer.usage, null);
    }
  });

  test("a stop is said in the caller's words and keeps what it was billed", async () => {
    const stop = new ClaudeStopError("refusal", "cyber", USAGE);

    const lesson = await askModel(throwing(stop), PROMPT, LESSON_WORDING);
    assert.equal(lesson.ok, false);
    assert.equal(lesson.ok ? null : lesson.error, LESSON_WORDING.stopped);
    assert.deepEqual(lesson.usage, USAGE);
    assert.equal(
      lesson.ok ? null : lesson.cause,
      "Claude stopped with refusal (cyber)",
    );

    const word = await askModel(throwing(stop), PROMPT, INSTRUCTION_WORDING);
    assert.equal(word.ok ? null : word.error, CLAUDE_STOPPED);
  });

  test("anything else is the caller's generic sentence", async () => {
    for (const cause of [new Error("Claude answered with no text"), "odd"]) {
      const lesson = await askModel(throwing(cause), PROMPT, LESSON_WORDING);
      assert.equal(lesson.ok ? null : lesson.error, LESSON_WORDING.failed);
      assert.equal(
        lesson.ok ? null : lesson.cause,
        cause instanceof Error ? cause.message : cause,
      );

      const word = await askModel(throwing(cause), PROMPT, INSTRUCTION_WORDING);
      assert.equal(word.ok ? null : word.error, SCENE_SUGGESTION_FAILED);
    }
  });
});

describe("usdOrNull", () => {
  test("costs a known model", () => {
    // 1,300 in at 0.10 and 400 out at 0.50, per million.
    const usd = usdOrNull("claude-haiku-5-5", USAGE);
    assert.ok(usd !== null && Math.abs(usd - 0.00033) < 1e-12);
  });

  test("never throws into a log line: no usage, or no price, is null", () => {
    assert.equal(usdOrNull("claude-haiku-5-5", null), null);
    assert.equal(usdOrNull("no-such-model", USAGE), null);
  });
});

describe("the call shapes", () => {
  test("a lesson call ends before the witness gives its batch up", () => {
    assert.ok(LESSON_CALL.deadlineMs < WITNESS_DEADLINE_MS);
    assert.ok(LESSON_CALL.timeoutMs <= LESSON_CALL.deadlineMs);
  });

  test("the instruction keeps the scene's measured shape", () => {
    assert.deepEqual(SUGGESTION_CALL, {
      maxRetries: 2,
      timeoutMs: 15_000,
      deadlineMs: 60_000,
    });
  });
});
