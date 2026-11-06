import assert from "node:assert/strict";
import { describe, test } from "node:test";

import Anthropic from "@anthropic-ai/sdk";

import {
  ClaudeKeyMissingError,
  ClaudeStopError,
} from "../../../../lib/text/claude.ts";

import {
  CLAUDE_NOT_CONFIGURED,
  CLAUDE_NO_ANSWER,
  CLAUDE_REFUSED_REQUEST,
  CLAUDE_STOPPED,
  SCENE_SUGGESTION_FAILED,
  claudeFailure,
} from "./claude-failure.ts";

const USAGE = { inputTokens: 900, cachedInputTokens: 0, outputTokens: 40 };

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

describe("claudeFailure", () => {
  test("a missing key, a key refused or a key without access: not set up here", () => {
    for (const cause of [
      new ClaudeKeyMissingError(),
      status(Anthropic.AuthenticationError, 401),
      status(Anthropic.PermissionDeniedError, 403),
    ]) {
      assert.equal(claudeFailure(cause), CLAUDE_NOT_CONFIGURED, String(cause));
    }
  });

  test("a rate limit, a server error, an overload or a dropped connection: try again", () => {
    for (const cause of [
      status(Anthropic.RateLimitError, 429),
      status(Anthropic.InternalServerError, 500),
      status(Anthropic.ServiceUnavailableError, 503),
      // A subclass of InternalServerError: the order of the checks must not
      // let it fall through to the generic sentence.
      status(Anthropic.OverloadedError, 529),
      status(Anthropic.RequestTimeoutError, 408),
      new Anthropic.APIConnectionError({ message: "socket hang up" }),
      new Anthropic.APIConnectionTimeoutError(),
      // The deadline of the whole call.
      new Anthropic.APIUserAbortError(),
    ]) {
      assert.equal(claudeFailure(cause), CLAUDE_NO_ANSWER, String(cause));
    }
  });

  test("a request refused as such, as with no credit or an unknown model: check the Console", () => {
    for (const cause of [
      status(Anthropic.BadRequestError, 400),
      status(Anthropic.NotFoundError, 404),
    ]) {
      assert.equal(claudeFailure(cause), CLAUDE_REFUSED_REQUEST, String(cause));
    }
  });

  test("a refusal or an answer cut short: no instruction came back", () => {
    for (const reason of ["refusal", "max_tokens"]) {
      assert.equal(
        claudeFailure(new ClaudeStopError(reason, null, USAGE)),
        CLAUDE_STOPPED,
      );
    }
  });

  test("anything else: the generic sentence", () => {
    for (const cause of [
      new Error("Claude answered with no text"),
      status(Anthropic.UnprocessableEntityError, 422),
      "a string",
      null,
    ]) {
      assert.equal(claudeFailure(cause), SCENE_SUGGESTION_FAILED);
    }
  });

  test("every sentence is the teacher's language and says something different", () => {
    const all = [
      CLAUDE_NOT_CONFIGURED,
      CLAUDE_NO_ANSWER,
      CLAUDE_REFUSED_REQUEST,
      CLAUDE_STOPPED,
      SCENE_SUGGESTION_FAILED,
    ];
    assert.equal(new Set(all).size, all.length);
    for (const text of all) assert.doesNotMatch(text, /\u2014/u);
  });
});
