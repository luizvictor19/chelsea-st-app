/**
 * What the console gets when a suggestion batch does not come back.
 *
 * On 2026-09-20 a batch was seen taking 28.0s on the dev server, answering
 * 200, and reaching the browser as "TypeError: NetworkError when attempting
 * to fetch resource." Nothing in this repository says why, and nothing here
 * claims to: the point of this file is that the next one arrives with enough
 * attached to find out.
 *
 * What was missing was not the error. settle() already keeps the cause and
 * the button already prints it. What it printed was the error alone — no
 * offset, so there was no way to say which ten words; no elapsed time from
 * the browser's side, so there was no way to compare it against the server's
 * own duration; and no attempt number, so a first try and its retry looked
 * identical in the log.
 *
 * Kept out of the component and returned as a string rather than printed,
 * because then it can be tested: what a diagnostic line carries is exactly
 * the sort of thing that rots unnoticed, since nobody reads it until the one
 * day they need it.
 */

/** An unknown thrown value, reduced to the three fields worth printing. */
export function describeCause(cause: unknown): {
  readonly name: string;
  readonly message: string;
  readonly stack: string | null;
} {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      stack: cause.stack ?? null,
    };
  }
  // Not an Error: a string, a DOMException in an older shape, an object with
  // no prototype. String() can itself throw on the last of those, so it is
  // the one call here that is guarded.
  let message: string;
  try {
    message = String(cause);
  } catch {
    message = "a value that could not be turned into a string";
  }
  return { name: typeof cause, message, stack: null };
}

export function lostBatchReport(event: {
  readonly lessonContentId: string;
  readonly offset: number;
  readonly words: number;
  readonly attempt: number;
  readonly clientMs: number;
  readonly cause: unknown;
  /*
   * What the witness said afterwards: whether the batch had been written
   * despite the answer never arriving. Undefined when nobody asked, which is
   * the shape of every line written before the run id existed.
   */
  readonly landed?: "yes" | "no" | "unknown";
}): string {
  return JSON.stringify({
    event: "suggest_batch_lost",
    lessonContentId: event.lessonContentId,
    offset: event.offset,
    words: event.words,
    attempt: event.attempt,
    // The browser's own clock, from just before the call to just after it
    // rejected. The server writes its duration in its own log under
    // suggest_batch; having both is what makes it possible to say whether
    // the two ended at the same moment.
    clientMs: event.clientMs,
    at: new Date().toISOString(),
    landed: event.landed ?? "unknown",
    cause: describeCause(event.cause),
  });
}

/**
 * How often the witness is asked, and until when.
 *
 * Asking once, the moment the call rejects, was wrong and wrong in exactly the
 * case the witness exists for. In the incident of 2026-09-20 the connection
 * died at 31.6s and the action wrote its eight words at 33,325ms: an immediate
 * question would have found nothing written, concluded the batch had failed,
 * and paid the model a second time to write the same eight words. The witness
 * has to outlive the request it is asking about.
 *
 * The deadline is the batch's, measured from when it was sent, and not a
 * countdown started by the failure — the same shape as GENERATION_WINDOW_MS,
 * and for the same reason: what matters is how long the work has had, not how
 * long ago somebody noticed it was missing. Seventy-five seconds because the
 * slowest batch ever measured took 59.6s inside the action, and a connection
 * can die at any point before that.
 */
export const WITNESS_DEADLINE_MS = 75_000;
export const WITNESS_INTERVAL_MS = 2_000;

/**
 * What one look at the witness says about a batch whose answer never arrived.
 *
 * The action writes its rows before it returns, so a lost answer says nothing
 * about the words: on 2026-09-20 a batch was seen writing its eight words at
 * 33,325ms, two seconds after the connection had died and the client had given
 * up at 31,610ms. Repeating blindly, which is what the button did until then,
 * called the model again and wrote the same eight a second time.
 *
 * `stampedInBatch` is how many words of this exact batch carry this run's id,
 * and `batchWords` how many it covers. Counting the batch rather than a
 * running total is what makes this an answer rather than an inference: a total
 * that only grew by some of the batch — a function cut off halfway through its
 * writes, which is the duration limit that the batching exists for — reads as
 * progress, and advancing on it would leave the rest of those words
 * unsuggested and uncounted, with the screen saying the lesson was done.
 *
 * So "landed" is the whole batch and nothing less. Anything short is "not
 * yet", which the caller keeps asking about until the deadline; a batch that
 * really did fail costs one repeat, and a batch that was merely slow costs
 * nothing at all. Null is the witness itself failing, which is not the witness
 * saying no.
 */
export function afterLostBatch(input: {
  readonly stampedInBatch: number | null;
  readonly batchWords: number;
}): "landed" | "not-yet" | "unknown" {
  if (input.stampedInBatch === null) return "unknown";
  return input.stampedInBatch >= input.batchWords ? "landed" : "not-yet";
}

/**
 * How loudly a lost batch is reported, which is not the same question as what
 * happened to the connection.
 *
 * Every one of these lines used to go out as console.error, in red, carrying a
 * TypeError — including the ones where the witness found the work done and the
 * run carried on without missing a word. Red for something that came out right
 * is how people learn to stop reading red, and then the one line that mattered
 * goes past with the rest.
 *
 * So the level follows the outcome and not the failure:
 *
 *   recovered  the witness found the batch written and the run went on. The
 *              connection died and nothing was lost, which is worth a record
 *              and not worth an alarm.
 *   retrying   the batch has to be asked for again. Something is going wrong
 *              and is being handled, which is what a warning is.
 *   stopped    the repeat did not come back either and the run ends here.
 *              This is the line somebody has to see.
 *
 * The text of the line is the same in all three. It is the diagnostic, and
 * what changed today is only where it sits in the console.
 */
export function lostBatchLevel(
  outcome: "recovered" | "retrying" | "stopped",
): "info" | "warn" | "error" {
  if (outcome === "recovered") return "info";
  return outcome === "retrying" ? "warn" : "error";
}
