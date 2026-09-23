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
 * The result out of a heartbeat stream. A stream that ends without one, or a
 * connection that drops on the way, throws: both are an answer that did not
 * arrive, and the caller's settle() treats them as lost.
 */
export async function readHeartbeat<T>(
  stream: Promise<AsyncIterable<Heartbeat<T>>>,
  onBeat?: (beat: number) => void,
): Promise<T> {
  for await (const chunk of await stream) {
    if ("done" in chunk) return chunk.done;
    onBeat?.(chunk.beat);
  }
  throw new Error("The heartbeat stream ended without a result");
}
