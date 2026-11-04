import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import { createFreepikProvider } from "./freepik.ts";

/*
 * fetch is swapped for a fake that counts calls and answers like the API
 * accepting a task. A call that reaches it is a call that would have reached
 * Freepik, which is the thing under test: a request the provider is going to
 * refuse must never leave the server (#186).
 */
type Call = { readonly url: string; readonly body: unknown };

let calls: Call[] = [];
const realFetch = globalThis.fetch;
const realKey = process.env.FREEPIK_API_KEY;

beforeEach(() => {
  calls = [];
  process.env.FREEPIK_API_KEY = "test-key-not-real";
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    return new Response(JSON.stringify({ data: { task_id: "task-1" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.FREEPIK_API_KEY;
  else process.env.FREEPIK_API_KEY = realKey;
});

describe("generate, Flux Kontext Pro", () => {
  /*
   * Without input_image the API answers 400 "body.input_image is required"
   * and charges nothing (two failed attempts in image_attempts on 04/11, both
   * with credits_spent null). The request should not leave at all.
   */
  test("refuses without a reference, before any request", async () => {
    const provider = createFreepikProvider();
    await assert.rejects(
      provider.generate({
        prompt: "a pen",
        model: "flux-kontext-pro",
        reference: null,
        pictures: [],
      }),
    );
    assert.equal(calls.length, 0);
  });

  test("with a reference, sends one request carrying input_image", async () => {
    const provider = createFreepikProvider();
    const url = "https://example.test/reference.png";
    const { requestId } = await provider.generate({
      prompt: "a pen",
      model: "flux-kontext-pro",
      reference: url,
      pictures: [],
    });
    assert.equal(requestId, "flux-kontext-pro:task-1");
    assert.equal(calls.length, 1);
    assert.ok(calls[0]?.url.endsWith("/v1/ai/text-to-image/flux-kontext-pro"));
    assert.deepEqual(calls[0]?.body, {
      prompt: "a pen",
      aspect_ratio: "square_1_1",
      input_image: url,
    });
  });
});
