import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import { JudgeError } from "./errors.ts";
import { createOpenAiAudioJudge } from "./openai-audio.ts";
import { JUDGEMENT_TOOL } from "./prompt.ts";

/**
 * What a failed call says about itself. The message of an error reaches the
 * server log in the app, and what the person said must never be in it
 * (docs/context.md, "Sensitive data and secrets"). Until #249 the message of
 * an unreadable judgement carried up to 1000 characters of the model's JSON,
 * whose `heard` is exactly what was said. The text stays reachable, for the
 * measurement script's JSONL, as `detail`, never as `message`.
 */

const SAID = "my secret sentence";
const realFetch = globalThis.fetch;
const realKey = process.env.OPENAI_API_KEY;

function answering(response: Response): void {
  globalThis.fetch = (() => Promise.resolve(response)) as typeof fetch;
}

function toolCall(argumentsJson: string): Response {
  return Response.json({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: { name: JUDGEMENT_TOOL, arguments: argumentsJson },
            },
          ],
        },
      },
    ],
  });
}

async function failure(): Promise<JudgeError> {
  const judge = createOpenAiAudioJudge("openai-gpt-audio-1.5", "gpt-audio-1.5");
  try {
    await judge.judge({
      audio: new Uint8Array([1, 2, 3]),
      contentType: "audio/wav",
      question: "Is this a pen?",
      expected: "Yes, it's a pen.",
      answerLanguage: "en",
    });
  } catch (cause) {
    assert.ok(cause instanceof JudgeError, `not a JudgeError: ${cause}`);
    return cause;
  }
  throw new Error("the judge did not fail");
}

describe("a failed judge call", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = realKey;
  });

  test("an unreadable judgement keeps what was heard out of the message", async () => {
    answering(toolCall(JSON.stringify({ heard: SAID, matches: "maybe" })));
    const error = await failure();
    assert.equal(error.kind, "unreadable");
    assert.ok(!error.message.includes(SAID), error.message);
    assert.ok(error.detail.includes(SAID), "detail keeps the raw answer");
  });

  test("an HTTP error keeps the body out of the message", async () => {
    answering(new Response(`{"error":"${SAID}"}`, { status: 400 }));
    const error = await failure();
    assert.equal(error.kind, "http");
    assert.equal(error.status, 400);
    assert.ok(!error.message.includes(SAID), error.message);
    assert.ok(error.detail.includes(SAID));
  });

  test("an answer without the call is its own kind", async () => {
    answering(Response.json({ choices: [{ message: { content: SAID } }] }));
    const error = await failure();
    assert.equal(error.kind, "no-call");
    assert.ok(!error.message.includes(SAID));
  });

  test("a network failure is its own kind", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    const error = await failure();
    assert.equal(error.kind, "network");
  });

  test("a timeout is its own kind", async () => {
    globalThis.fetch = (() =>
      Promise.reject(
        new DOMException("The operation timed out.", "TimeoutError"),
      )) as typeof fetch;
    const error = await failure();
    assert.equal(error.kind, "timeout");
  });
});
