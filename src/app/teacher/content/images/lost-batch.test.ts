import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  afterLostBatch,
  describeCause,
  lostBatchLevel,
  lostBatchReport,
} from "./lost-batch.ts";

/*
 * A diagnostic is read on exactly one day, long after it was written, and by
 * then nobody remembers what it was supposed to carry. These hold it to
 * carrying the four things that were missing on 2026-09-20, when a batch came
 * back as "NetworkError when attempting to fetch resource" and the console
 * had the error and nothing else.
 */
describe("lostBatchReport", () => {
  const cause = new TypeError("NetworkError when attempting to fetch resource");

  function report() {
    return JSON.parse(
      lostBatchReport({
        lessonContentId: "c6fadb7f-5d16-4cdb-b29e-76a40484ce57",
        offset: 10,
        words: 10,
        attempt: 1,
        clientMs: 28_004,
        cause,
      }),
    );
  }

  test("says which words, so the batch can be named", () => {
    assert.equal(report().offset, 10);
    assert.equal(report().words, 10);
    assert.equal(
      report().lessonContentId,
      "c6fadb7f-5d16-4cdb-b29e-76a40484ce57",
    );
  });

  /*
   * The browser's own clock. The server writes its duration under
   * suggest_batch; a reader with both can say whether the two ended together,
   * which is not something either number answers on its own.
   */
  test("carries the time the browser waited", () => {
    assert.equal(report().clientMs, 28_004);
  });

  test("tells a first attempt from its retry", () => {
    assert.equal(report().attempt, 1);
    const retry = JSON.parse(
      lostBatchReport({
        lessonContentId: "c6fadb7f",
        offset: 10,
        words: 10,
        attempt: 2,
        clientMs: 900,
        cause,
      }),
    );
    assert.equal(retry.attempt, 2);
  });

  test("keeps the error whole", () => {
    const { cause: described } = report();
    assert.equal(described.name, "TypeError");
    assert.match(described.message, /NetworkError/u);
    assert.ok(typeof described.stack === "string");
  });

  test("is one line, so a log can be grepped by the event", () => {
    const line = lostBatchReport({
      lessonContentId: "c6fadb7f",
      offset: 0,
      words: 10,
      attempt: 1,
      clientMs: 1,
      cause,
    });
    assert.doesNotMatch(line, /\n/u);
    assert.match(line, /"event":"suggest_batch_lost"/u);
  });
});

describe("describeCause", () => {
  test("reads an Error", () => {
    const described = describeCause(new RangeError("out of range"));
    assert.equal(described.name, "RangeError");
    assert.equal(described.message, "out of range");
  });

  /*
   * A rejected fetch is usually an Error, but a thrown value can be anything,
   * and a diagnostic that throws while describing a failure destroys the
   * evidence it was written to keep.
   */
  test("reads what is not an Error without throwing", () => {
    assert.equal(describeCause("plain string").message, "plain string");
    assert.equal(describeCause(undefined).message, "undefined");
    assert.equal(describeCause(null).message, "null");
    assert.equal(describeCause({ odd: true }).name, "object");
  });

  test("survives a value that cannot be made into a string", () => {
    const hostile = Object.create(null) as object;
    const described = describeCause(hostile);
    assert.equal(typeof described.message, "string");
    assert.equal(described.stack, null);
  });
});

/*
 * The decision the run id was added for. Proved on 2026-09-20: a batch wrote
 * its eight words at 33,325ms, two seconds after the connection had died and
 * the client had given up at 31,610ms — and the client, with no way to ask,
 * repeated it and paid the model to write the same eight again.
 */
describe("afterLostBatch", () => {
  test("lands when the whole batch was written", () => {
    assert.equal(
      afterLostBatch({ stampedInBatch: 10, batchWords: 10 }),
      "landed",
    );
    assert.equal(
      afterLostBatch({ stampedInBatch: 8, batchWords: 8 }),
      "landed",
    );
  });

  test("has not landed when none of it was written", () => {
    assert.equal(
      afterLostBatch({ stampedInBatch: 0, batchWords: 10 }),
      "not-yet",
    );
  });

  /*
   * The case that would lose words. A function cut off part way through its
   * writes — the duration limit the batching exists for — leaves some of the
   * batch stamped. Read as progress, the run would move past the rest of
   * those words, never suggest them, and never count them as missed.
   */
  test("part of a batch is not a batch", () => {
    assert.equal(
      afterLostBatch({ stampedInBatch: 6, batchWords: 10 }),
      "not-yet",
    );
    assert.equal(
      afterLostBatch({ stampedInBatch: 9, batchWords: 10 }),
      "not-yet",
    );
  });

  /*
   * The witness itself failing is not the witness saying no. Answering
   * "not-yet" here would keep the caller asking a question nobody can answer
   * until the deadline ran out.
   */
  test("says it does not know when the witness could not be asked", () => {
    assert.equal(
      afterLostBatch({ stampedInBatch: null, batchWords: 10 }),
      "unknown",
    );
  });

  /*
   * A batch the function was cut off in the middle of. The words it did write
   * are stamped and the rest are not, and the rest still carry whatever
   * suggestion they had before — indistinguishable from one written a second
   * ago. Advancing here is content skipped in silence, so it is a repeat, and
   * the repeat is safe because the batch is idempotent in the columns it
   * writes.
   */
  test("a batch written half way through is repeated, never advanced", () => {
    for (const stampedInBatch of [1, 5, 6, 9]) {
      assert.equal(
        afterLostBatch({ stampedInBatch, batchWords: 10 }),
        "not-yet",
        `${stampedInBatch} of 10 read as landed`,
      );
    }
  });

  /*
   * The refusal, which reaches exactly the same verdict by a different road:
   * a word the model gave no usable answer for is written nowhere, so the
   * batch never becomes whole and the witness never says landed. The run does
   * not spin on it — the caller waits out one deadline, repeats the batch
   * once, and takes whatever that answer says. What the teacher is told about
   * the word is the business of restingNote, which counts sent minus
   * suggested.
   */
  test("a batch with a word the model never answered is not landed", () => {
    assert.equal(
      afterLostBatch({ stampedInBatch: 9, batchWords: 10 }),
      "not-yet",
    );
  });

  /* A last batch shorter than the full ten still lands as a whole. */
  test("a short last batch lands on its own size", () => {
    assert.equal(
      afterLostBatch({ stampedInBatch: 3, batchWords: 3 }),
      "landed",
    );
  });
});

describe("the report carries the witness", () => {
  const cause = new TypeError("NetworkError when attempting to fetch resource");

  test("says whether the batch had landed", () => {
    for (const landed of ["yes", "no", "unknown"] as const) {
      const line = JSON.parse(
        lostBatchReport({
          lessonContentId: "c6fadb7f",
          offset: 10,
          words: 8,
          attempt: 1,
          clientMs: 31_610,
          cause,
          landed,
        }),
      );
      assert.equal(line.landed, landed);
    }
  });

  /* A line written before anyone asked is not a line claiming nothing landed. */
  test("an unasked witness reads as unknown, never as no", () => {
    const line = JSON.parse(
      lostBatchReport({
        lessonContentId: "c6fadb7f",
        offset: 10,
        words: 8,
        attempt: 1,
        clientMs: 31_610,
        cause,
      }),
    );
    assert.equal(line.landed, "unknown");
  });
});

/*
 * Every one of these lines used to be console.error, in red, carrying a
 * TypeError — including the ones where the witness found the work done and
 * the run carried on. Red for something that came out right is how people
 * learn to stop reading red.
 */
describe("lostBatchLevel", () => {
  test("a batch the witness rescued is not an error", () => {
    assert.equal(lostBatchLevel("recovered"), "info");
  });

  test("a batch about to be asked for again is a warning", () => {
    assert.equal(lostBatchLevel("retrying"), "warn");
  });

  /* The only line that stops a run, and the only one that should be red. */
  test("error is kept for the run actually stopping", () => {
    assert.equal(lostBatchLevel("stopped"), "error");
  });

  test("only one outcome is an error", () => {
    const levels = (["recovered", "retrying", "stopped"] as const).map(
      lostBatchLevel,
    );
    assert.equal(levels.filter((level) => level === "error").length, 1);
  });
});
