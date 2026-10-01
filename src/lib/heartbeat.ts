/**
 * A long server action answer kept alive by beats: a byte at once, one every
 * few seconds while the work runs, and the result at the end.
 *
 * WHY. Between the browser and the dev server, a connection that carries no
 * byte for a while is dropped, at a moment nobody can predict. Measured on
 * 2026-09-23 with a temporary action that only waited 35s, in Firefox, with
 * and without extensions (troubleshooting mode):
 *
 *   35s, silent until the end     4 of 9 arrived; the other 5 were dropped
 *                                 at 8237, 11757, 17939, 19947 and 33499ms
 *   35s, a beat every 10s         5 of 5 arrived, parallel calls included
 *
 * The server finished all nine, every one at about 35000ms: the drop never
 * reaches it, and it writes its answer into a socket nobody reads. That is the
 * same shape as the lost kind suggestion of 2026-09-20 (answer lost at
 * 31610ms, rows written at 33325ms). The same wait from curl arrived every
 * time, in dev, in next start and with the proxy off the route, and Next's
 * client sends an action with a plain fetch, no timeout and no abort.
 *
 * WHO DROPS IT IS NOT KNOWN. Not an extension, and not a fixed limit: the
 * drops are spread from 8s to 33s. What is known is that a connection that
 * keeps moving is not dropped, and that is what this relies on.
 *
 * The result is carried by React's own streaming of an async iterable, which
 * sends each yielded value as it comes; measured the same day, the first bytes
 * leave at 0s and each beat at its interval.
 */

/** The earliest drop of a quiet connection measured, above: 8237ms. */
export const EARLIEST_DROP_MS = 8237;

/**
 * How often a long action beats: every 5s, for every action that streams.
 *
 * Below the earliest drop measured, so no gap between beats is long enough
 * for one. 10s passed the test of five above only because no drop happened
 * to land inside a gap. Measured again on 2026-09-22 at a byte every 5s:
 * 5 of 5 arrived.
 */
export const ACTION_BEAT_MS = 5000;

/** A beat, numbered from 0, or the result, once, as the last chunk. */
export type Heartbeat<T> = { readonly beat: number } | { readonly done: T };

/**
 * Beats while `work` runs. The first beat goes at once, so the connection is
 * never quiet from the start, and the result goes as soon as the work
 * answers, without waiting out an interval.
 *
 * A work that fails ends the stream with its error. Callers that should never
 * fail that way catch inside the work and answer with a result instead.
 */
export async function* withHeartbeat<T>(
  work: Promise<T>,
  everyMs: number,
): AsyncGenerator<Heartbeat<T>> {
  let settled = false;
  // Never rejects, so waiting on it cannot leave a rejection unhandled; the
  // error, if any, is thrown by the await on `work` at the end.
  const finished = work.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  let beat = 0;
  yield { beat: beat++ };
  while (!settled) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = new Promise<"tick">((wake) => {
      timer = setTimeout(() => wake("tick"), everyMs);
    });
    const first = await Promise.race([finished.then(() => "done"), tick]);
    clearTimeout(timer);
    if (first === "tick") yield { beat: beat++ };
  }
  yield { done: await work };
}

/**
 * How many beats in a row may fail to arrive before the stream is given up.
 *
 * WHY THERE IS A LIMIT. A connection can die without the browser hearing of
 * it: on the contrast suggestion of lesson 4 the server logged "The
 * destination stream closed early" at 5.5s, the fetch never rejected, and the
 * read waited 227s for a chunk that was never coming. Nothing else on the
 * client ends that wait, since Next sends an action with no timeout.
 *
 * WHY THREE. The limit is counted in beats because a beat is the only thing
 * the stream promises: one byte every ACTION_BEAT_MS. One interval is no
 * limit at all, a beat is always that far away. Two is the instant the second
 * missing beat is due, so a beat a few milliseconds late (a busy server, a
 * throttled tab) would be read as a dead connection, and a false alarm is not
 * free: it pays the model again for a contrast suggestion. Three means two
 * whole beats missed and a third interval run out, which lateness does not
 * explain. The price is that a dead connection is noticed up to 15s after its
 * last byte. How late a beat really gets has not been measured; if a healthy
 * stream ever trips this, measure that before raising the count.
 */
export const SILENCE_BEATS = 3;

/** The longest a stream may carry no byte before it is treated as lost. */
export const SILENCE_LIMIT_MS = SILENCE_BEATS * ACTION_BEAT_MS;

/** A stream that opened and then carried nothing for the whole limit. */
export class HeartbeatSilence extends Error {
  readonly silentMs: number;

  constructor(silentMs: number) {
    super(`The heartbeat stream carried no byte for ${silentMs}ms`);
    this.name = "HeartbeatSilence";
    this.silentMs = silentMs;
  }
}

/** The two timer calls the silence limit needs, so a test can own the time. */
export type SilenceClock = {
  setTimeout(fire: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

const SYSTEM_CLOCK: SilenceClock = {
  setTimeout: (fire, ms) => setTimeout(fire, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const SILENT = Symbol("silent");

/**
 * The result out of a heartbeat stream. A stream that ends without one, a
 * connection that drops on the way, or one that goes quiet for longer than
 * the silence limit, throws: all three are an answer that did not arrive, and
 * the caller's settle() treats them as lost.
 *
 * The limit runs between chunks, from the moment the stream opens. It does
 * not cover the wait for the stream itself: Next dispatches actions one at a
 * time, so a call queued behind another is quiet for as long as that one
 * takes, and that is not a dead connection.
 */
export async function readHeartbeat<T>(
  stream: Promise<AsyncIterable<Heartbeat<T>>>,
  onBeat?: (beat: number) => void,
  silence: { readonly limitMs?: number; readonly clock?: SilenceClock } = {},
): Promise<T> {
  const limitMs = silence.limitMs ?? SILENCE_LIMIT_MS;
  const clock = silence.clock ?? SYSTEM_CLOCK;
  const chunks = (await stream)[Symbol.asyncIterator]();

  for (;;) {
    const next = chunks.next();
    let timer: unknown;
    const quiet = new Promise<typeof SILENT>((wake) => {
      timer = clock.setTimeout(() => wake(SILENT), limitMs);
    });
    let step: IteratorResult<Heartbeat<T>> | typeof SILENT;
    try {
      step = await Promise.race([next, quiet]);
    } finally {
      clock.clearTimeout(timer);
    }

    if (step === SILENT) {
      // Nobody is left to hear either of these fail. Neither is awaited: on
      // a dead stream they may never settle, which is the wait being ended.
      next.catch(() => {});
      try {
        void Promise.resolve(chunks.return?.()).catch(() => {});
      } catch {
        // A return() that throws at once changes nothing about the silence.
      }
      throw new HeartbeatSilence(limitMs);
    }
    if (step.done) break;
    if ("done" in step.value) return step.value.done;
    onBeat?.(step.value.beat);
  }
  throw new Error("The heartbeat stream ended without a result");
}
