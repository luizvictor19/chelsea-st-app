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
/** What the fake answers with; a task accepted unless a test says otherwise. */
let answer: { status: number; body: unknown } = { status: 200, body: null };
const realFetch = globalThis.fetch;
const realKey = process.env.FREEPIK_API_KEY;

beforeEach(() => {
  calls = [];
  answer = { status: 200, body: { data: { task_id: "task-1" } } };
  process.env.FREEPIK_API_KEY = "test-key-not-real";
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
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
      /needs a reference/u,
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

/*
 * The refusals that were there before #186, and the poll, so the file this
 * test now loads counts for coverage with what it actually does.
 */
describe("generate, the other refusals", () => {
  const base = { prompt: "a pen", reference: null, pictures: [] } as const;

  test("refuses an unknown model", async () => {
    await assert.rejects(
      createFreepikProvider().generate({ ...base, model: "nope" }),
      /Unknown image model/u,
    );
    assert.equal(calls.length, 0);
  });

  test("refuses a reference to a model that takes none", async () => {
    await assert.rejects(
      createFreepikProvider().generate({
        ...base,
        model: "seedream-v4",
        reference: "https://example.test/r.png",
      }),
      /takes no structure reference/u,
    );
    assert.equal(calls.length, 0);
  });

  test("refuses pictures to a model that does not compose, and none to one that does", async () => {
    const provider = createFreepikProvider();
    await assert.rejects(
      provider.generate({
        ...base,
        model: "seedream-v4",
        pictures: ["https://example.test/a.png"],
      }),
      /takes no pictures/u,
    );
    await assert.rejects(
      provider.generate({ ...base, model: "seedream-v4-5-edit" }),
      /takes 1 to 5 pictures, got 0/u,
    );
    assert.equal(calls.length, 0);
  });

  test("Mystic without a reference sends one request, with no structure fields", async () => {
    await createFreepikProvider().generate({ ...base, model: "mystic" });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.body, {
      prompt: "a pen",
      aspect_ratio: "square_1_1",
      model: "flexible",
    });
  });

  test("an answer with no task id is an error", async () => {
    answer = { status: 200, body: { data: {} } };
    await assert.rejects(
      createFreepikProvider().generate({ ...base, model: "seedream-v4" }),
      /no task id/u,
    );
  });

  test("a refused request says the status", async () => {
    answer = { status: 400, body: { message: "bad" } };
    await assert.rejects(
      createFreepikProvider().generate({ ...base, model: "seedream-v4" }),
      /failed: 400/u,
    );
  });

  test("without the key, nothing is sent", async () => {
    delete process.env.FREEPIK_API_KEY;
    await assert.rejects(
      createFreepikProvider().generate({ ...base, model: "seedream-v4" }),
      /FREEPIK_API_KEY/u,
    );
    assert.equal(calls.length, 0);
  });
});

describe("poll", () => {
  function status(value: string, generated: readonly string[] = []) {
    answer = { status: 200, body: { data: { status: value, generated } } };
  }

  test("asks the model's path with the task id", async () => {
    status("IN_PROGRESS");
    const result = await createFreepikProvider().poll("mystic:task-9");
    assert.deepEqual(result, { status: "pending" });
    assert.ok(calls[0]?.url.endsWith("/v1/ai/mystic/task-9"));
  });

  test("reads each status", async () => {
    const provider = createFreepikProvider();
    status("COMPLETED", ["https://example.test/out.png"]);
    assert.deepEqual(await provider.poll("seedream-v4:t"), {
      status: "done",
      imageUrl: "https://example.test/out.png",
    });
    status("COMPLETED");
    assert.equal((await provider.poll("seedream-v4:t")).status, "failed");
    status("FAILED");
    assert.equal((await provider.poll("seedream-v4:t")).status, "failed");
    status("CREATED");
    assert.equal((await provider.poll("seedream-v4:t")).status, "pending");
    status("SOMETHING");
    assert.deepEqual(await provider.poll("seedream-v4:t"), {
      status: "failed",
      error: "Unrecognised provider status: SOMETHING",
    });
  });

  test("refuses a handle it did not make", async () => {
    const provider = createFreepikProvider();
    await assert.rejects(provider.poll("no-separator"), /handle/u);
    await assert.rejects(provider.poll("nope:t"), /handle/u);
    await assert.rejects(provider.poll("mystic:"), /handle/u);
    assert.equal(calls.length, 0);
  });
});
