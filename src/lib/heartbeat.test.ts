import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ACTION_BEAT_MS,
  EARLIEST_DROP_MS,
  readHeartbeat,
  withHeartbeat,
  type Heartbeat,
} from "./heartbeat.ts";

const after = <T>(ms: number, value: T) =>
  new Promise<T>((wake) => setTimeout(() => wake(value), ms));

async function collect<T>(stream: AsyncIterable<Heartbeat<T>>) {
  const chunks: { chunk: Heartbeat<T>; at: number }[] = [];
  const started = Date.now();
  for await (const chunk of stream) {
    chunks.push({ chunk, at: Date.now() - started });
  }
  return chunks;
}

describe("withHeartbeat", () => {
  test("beats at once, before the work has answered", async () => {
    const stream = withHeartbeat(after(60, "fim"), 1000);
    const first = await stream.next();
    assert.deepEqual(first.value, { beat: 0 });
    // Drained so the timer does not outlive the test.
    for await (const _ of stream) void _;
  });

  test("beats every interval while it waits, then gives the result once", async () => {
    const chunks = await collect(withHeartbeat(after(75, { ok: true }), 20));
    const beats = chunks.filter((c) => "beat" in c.chunk);
    const done = chunks.filter((c) => "done" in c.chunk);
    // 0 at once, then about one every 20ms over 75ms.
    assert.ok(beats.length >= 3 && beats.length <= 5, `${beats.length} beats`);
    assert.deepEqual(
      beats.map((c) => (c.chunk as { beat: number }).beat),
      beats.map((_, i) => i),
    );
    assert.deepEqual(done, [chunks.at(-1)]);
    assert.deepEqual(chunks.at(-1)?.chunk, { done: { ok: true } });
  });

  test("gives the result without waiting out the interval", async () => {
    const chunks = await collect(withHeartbeat(after(10, 1), 5000));
    assert.deepEqual(
      chunks.map((c) => c.chunk),
      [{ beat: 0 }, { done: 1 }],
    );
    assert.ok((chunks.at(-1)?.at ?? 0) < 1000);
  });

  test("a work that fails ends the stream with its error", async () => {
    const failing = new Promise<never>((_, fail) =>
      setTimeout(() => fail(new Error("modelo caiu")), 30),
    );
    await assert.rejects(collect(withHeartbeat(failing, 10)), /modelo caiu/u);
  });
});

async function* from<T>(...chunks: Heartbeat<T>[]) {
  for (const chunk of chunks) yield chunk;
}

describe("readHeartbeat", () => {
  test("returns the result and counts the beats on the way", async () => {
    const seen: number[] = [];
    const result = await readHeartbeat(
      Promise.resolve(from({ beat: 0 }, { beat: 1 }, { done: "ok" })),
      (beat) => seen.push(beat),
    );
    assert.equal(result, "ok");
    assert.deepEqual(seen, [0, 1]);
  });

  // A stream that stops without a result is a lost answer, and has to reach
  // the caller as a failure it can retry, never as an empty success.
  test("a stream that ends without a result throws", async () => {
    await assert.rejects(
      readHeartbeat(Promise.resolve(from<string>({ beat: 0 }))),
      /without a result/u,
    );
  });

  test("a connection that drops mid-stream throws what the stream threw", async () => {
    async function* dropped(): AsyncGenerator<Heartbeat<string>> {
      yield { beat: 0 };
      throw new TypeError("network error");
    }
    await assert.rejects(
      readHeartbeat(Promise.resolve(dropped())),
      /network error/u,
    );
  });

  test("reads back what withHeartbeat writes", async () => {
    const result = await readHeartbeat(
      Promise.resolve(withHeartbeat(after(30, { ok: true, n: 3 }), 10)),
    );
    assert.deepEqual(result, { ok: true, n: 3 });
  });
});

describe("ACTION_BEAT_MS", () => {
  /*
   * The one number both long actions beat at. A gap between beats as long as
   * the earliest drop measured is a gap a drop can land in; 10s passed a test
   * of five only because none did.
   */
  test("never leaves the connection quiet as long as the earliest drop", () => {
    assert.equal(EARLIEST_DROP_MS, 8237);
    assert.ok(ACTION_BEAT_MS < EARLIEST_DROP_MS);
    assert.equal(ACTION_BEAT_MS, 5000);
  });
});
