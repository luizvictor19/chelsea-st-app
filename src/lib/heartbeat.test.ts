import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ACTION_BEAT_MS,
  EARLIEST_DROP_MS,
  HeartbeatSilence,
  SILENCE_BEATS,
  SILENCE_LIMIT_MS,
  readHeartbeat,
  withHeartbeat,
  type Heartbeat,
  type SilenceClock,
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

/** A clock that only moves when the test moves it. */
function handClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; fire: () => void }>();
  const clock: SilenceClock = {
    setTimeout(fire, ms) {
      timers.set((nextId += 1), { at: now + ms, fire });
      return nextId;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };
  /** Lets every promise already resolved run its continuation. */
  const drain = () => new Promise<void>((wake) => setImmediate(wake));
  return {
    clock,
    pending: () => timers.size,
    async advance(ms: number) {
      // What was pushed before the time moves is read before it moves.
      await drain();
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.fire();
      }
      await drain();
    },
  };
}

/** A stream the test feeds by hand, and that is quiet in between. */
function handStream<T>() {
  const waiting: ((step: IteratorResult<Heartbeat<T>>) => void)[] = [];
  const ready: Heartbeat<T>[] = [];
  let returned = false;
  const stream: AsyncIterable<Heartbeat<T>> = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise((give) => {
          const chunk = ready.shift();
          if (chunk) give({ done: false, value: chunk });
          else waiting.push(give);
        }),
      return: async () => {
        returned = true;
        return { done: true, value: undefined };
      },
    }),
  };
  return {
    stream,
    returned: () => returned,
    push(chunk: Heartbeat<T>) {
      const give = waiting.shift();
      if (give) give({ done: false, value: chunk });
      else ready.push(chunk);
    },
  };
}

/** What became of a read, without waiting on it. */
function watch<T>(read: Promise<T>) {
  const seen: { result?: T; error?: unknown; settled: boolean } = {
    settled: false,
  };
  read.then(
    (result) => Object.assign(seen, { result, settled: true }),
    (error: unknown) => Object.assign(seen, { error, settled: true }),
  );
  return seen;
}

/*
 * The defect: the connection died 5.5s into a contrast suggestion, no error
 * reached the browser, and the read waited 227s on a stream that was never
 * going to say anything again.
 */
describe("readHeartbeat, when the bytes stop", () => {
  test("the limit is a count of beats, not a number of its own", () => {
    assert.equal(SILENCE_BEATS, 3);
    assert.equal(SILENCE_LIMIT_MS, SILENCE_BEATS * ACTION_BEAT_MS);
  });

  test("a stream gone quiet is lost at the limit, and not before", async () => {
    const hand = handClock();
    const source = handStream<string>();
    const beats: number[] = [];
    const read = watch(
      readHeartbeat(
        Promise.resolve(source.stream),
        (beat) => beats.push(beat),
        {
          clock: hand.clock,
        },
      ),
    );

    source.push({ beat: 0 });
    await hand.advance(ACTION_BEAT_MS);
    source.push({ beat: 1 });
    // The last byte the browser ever gets, at 5s. The limit counts from it.
    await hand.advance(500);
    assert.deepEqual(beats, [0, 1]);

    await hand.advance(SILENCE_LIMIT_MS - 501);
    assert.equal(read.settled, false, "one millisecond short of the limit");

    await hand.advance(1);
    assert.equal(read.settled, true);
    assert.ok(read.error instanceof HeartbeatSilence);
    assert.equal(read.error.silentMs, SILENCE_LIMIT_MS);
    // The read is given up, and no timer is left behind it.
    assert.equal(source.returned(), true);
    assert.equal(hand.pending(), 0);
  });

  test("beats that keep arriving never trip it, however long the work", async () => {
    const hand = handClock();
    const source = handStream<string>();
    const read = watch(
      readHeartbeat(Promise.resolve(source.stream), undefined, {
        clock: hand.clock,
      }),
    );

    // 20 beats, 100s: many times the limit, never one gap as long as it.
    for (let beat = 0; beat < 20; beat += 1) {
      source.push({ beat });
      await hand.advance(ACTION_BEAT_MS);
      assert.equal(read.settled, false, `after beat ${beat}`);
    }
    // A late beat, just inside the limit, is still a beat.
    await hand.advance(SILENCE_LIMIT_MS - ACTION_BEAT_MS - 1);
    assert.equal(read.settled, false);
    source.push({ beat: 20 });
    await hand.advance(SILENCE_LIMIT_MS - 1);
    assert.equal(read.settled, false);

    source.push({ done: "ok" });
    await hand.advance(0);
    assert.equal(read.result, "ok");
    assert.equal(source.returned(), false);
    assert.equal(hand.pending(), 0);
  });

  // Next dispatches server actions one at a time, so a call queued behind
  // another carries no byte until its turn. That wait is not silence.
  test("the limit does not run before the stream has opened", async () => {
    const hand = handClock();
    const source = handStream<string>();
    let open: (stream: AsyncIterable<Heartbeat<string>>) => void = () => {};
    const opening = new Promise<AsyncIterable<Heartbeat<string>>>((wake) => {
      open = wake;
    });
    const read = watch(
      readHeartbeat(opening, undefined, { clock: hand.clock }),
    );

    await hand.advance(SILENCE_LIMIT_MS * 10);
    assert.equal(read.settled, false);

    open(source.stream);
    source.push({ done: "ok" });
    await hand.advance(0);
    assert.equal(read.result, "ok");
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
