import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SITEVERIFY_URL, verifyChallenge, type Fetch } from "./turnstile.ts";

type Call = { url: string; body: URLSearchParams };

/** A fetch that answers with the given body and keeps what it was asked. */
function answering(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
) {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, request) => {
    calls.push({ url, body: request.body });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    };
  };
  return { calls, fetch };
}

const SECRET = "secret-of-the-widget";
const TOKEN = "token-of-the-widget";

describe("verifyChallenge: only a plain success passes", () => {
  test("success: passed, with the secret, the token and the IP sent", async () => {
    const f = answering({ success: true, "error-codes": [] });
    const result = await verifyChallenge({
      secret: SECRET,
      token: TOKEN,
      remoteIp: "203.0.113.7",
      fetch: f.fetch,
    });
    assert.deepEqual(result, { passed: true });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, SITEVERIFY_URL);
    assert.equal(f.calls[0].body.get("secret"), SECRET);
    assert.equal(f.calls[0].body.get("response"), TOKEN);
    assert.equal(f.calls[0].body.get("remoteip"), "203.0.113.7");
  });

  test("no IP: the field is left out", async () => {
    const f = answering({ success: true });
    await verifyChallenge({ secret: SECRET, token: TOKEN, fetch: f.fetch });
    assert.equal(f.calls[0].body.has("remoteip"), false);
  });

  test("refused by Cloudflare: not passed, with its codes", async () => {
    const f = answering({
      success: false,
      "error-codes": ["timeout-or-duplicate"],
    });
    assert.deepEqual(
      await verifyChallenge({ secret: SECRET, token: TOKEN, fetch: f.fetch }),
      { passed: false, reason: "timeout-or-duplicate" },
    );
  });

  test("an answer without success true: not passed", async () => {
    for (const body of [
      { success: "true" },
      {},
      null,
      "ok",
      { "error-codes": [1] },
    ]) {
      const f = answering(body);
      assert.deepEqual(
        await verifyChallenge({ secret: SECRET, token: TOKEN, fetch: f.fetch }),
        { passed: false, reason: "not-success" },
        JSON.stringify(body),
      );
    }
  });

  test("an HTTP error: not passed", async () => {
    const f = answering({ success: true }, { ok: false, status: 503 });
    assert.deepEqual(
      await verifyChallenge({ secret: SECRET, token: TOKEN, fetch: f.fetch }),
      { passed: false, reason: "http-503" },
    );
  });

  test("Cloudflare out of reach, or an answer that is not JSON: not passed", async () => {
    const down: Fetch = async () => {
      throw new Error("fetch failed");
    };
    assert.deepEqual(
      await verifyChallenge({ secret: SECRET, token: TOKEN, fetch: down }),
      { passed: false, reason: "unreachable" },
    );
    const notJson: Fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });
    assert.deepEqual(
      await verifyChallenge({ secret: SECRET, token: TOKEN, fetch: notJson }),
      { passed: false, reason: "unreachable" },
    );
  });

  test("no secret in the environment: refused, and Cloudflare is not called", async () => {
    for (const secret of [undefined, ""]) {
      const f = answering({ success: true });
      assert.deepEqual(
        await verifyChallenge({ secret, token: TOKEN, fetch: f.fetch }),
        { passed: false, reason: "no-secret" },
      );
      assert.equal(f.calls.length, 0);
    }
  });

  test("no token, or one that is not a string: refused without a call", async () => {
    for (const token of [undefined, null, "", 42, new File([], "x")]) {
      const f = answering({ success: true });
      assert.deepEqual(
        await verifyChallenge({ secret: SECRET, token, fetch: f.fetch }),
        { passed: false, reason: "no-token" },
      );
      assert.equal(f.calls.length, 0);
    }
  });

  test("a token longer than 2048 characters: refused without a call", async () => {
    const f = answering({ success: true });
    assert.deepEqual(
      await verifyChallenge({
        secret: SECRET,
        token: "x".repeat(2049),
        fetch: f.fetch,
      }),
      { passed: false, reason: "token-too-long" },
    );
    assert.equal(f.calls.length, 0);
    const g = answering({ success: true });
    assert.deepEqual(
      await verifyChallenge({
        secret: SECRET,
        token: "x".repeat(2048),
        fetch: g.fetch,
      }),
      { passed: true },
    );
  });
});
