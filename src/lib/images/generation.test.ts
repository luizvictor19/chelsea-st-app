import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  GENERATION_WINDOW_MS,
  POLL_INTERVAL_MS,
  REFERENCE_MAX_SIDE,
  elapsedSeconds,
  fitWithin,
  generationSeconds,
  hasExpired,
  isRunning,
  runningAttempt,
  type Finished,
} from "./generation.ts";

/** A row shaped like the ones the panel gets, at a chosen age. */
function attempt(
  over: Partial<{
    id: string;
    status: string;
    provider: string;
    createdAt: string;
  }> = {},
) {
  return {
    id: "a",
    status: "pending",
    provider: "freepik",
    createdAt: "2026-09-19T18:32:32.309Z",
    ...over,
  };
}

const STARTED = Date.parse("2026-09-19T18:32:32.309Z");

describe("isRunning", () => {
  test("a generation still with the provider is running", () => {
    assert.equal(isRunning(attempt()), true);
  });

  /*
   * An upload is 'pending' too, for the moment between its row and its file.
   * Polling it would ask Freepik about a task nobody created, and the answer
   * would be an error written onto a row that was doing fine.
   */
  test("a pending upload is not running", () => {
    assert.equal(isRunning(attempt({ provider: "upload" })), false);
  });

  test("nothing that has already ended is running", () => {
    for (const status of ["generated", "failed", "approved", "rejected"]) {
      assert.equal(isRunning(attempt({ status })), false, status);
    }
  });
});

describe("runningAttempt", () => {
  test("finds nothing in a list with nothing running", () => {
    assert.equal(
      runningAttempt([
        attempt({ id: "x", status: "generated" }),
        attempt({ id: "y", status: "rejected" }),
      ]),
      null,
    );
  });

  test("finds nothing in an empty list", () => {
    assert.equal(runningAttempt([]), null);
  });

  /*
   * The list arrives newest first, so the first match is the one the teacher
   * is watching. An older row stuck pending must not take its place.
   */
  test("takes the first, which is the newest", () => {
    const newest = attempt({ id: "new" });
    const found = runningAttempt([
      attempt({ id: "approved-one", status: "approved" }),
      newest,
      attempt({ id: "stuck" }),
    ]);
    assert.equal(found?.id, "new");
  });
});

describe("hasExpired", () => {
  test("is not expired while inside the window", () => {
    assert.equal(hasExpired(attempt().createdAt, STARTED + 21_000), false);
    assert.equal(
      hasExpired(attempt().createdAt, STARTED + GENERATION_WINDOW_MS),
      false,
    );
  });

  test("is expired past the window", () => {
    assert.equal(
      hasExpired(attempt().createdAt, STARTED + GENERATION_WINDOW_MS + 1),
      true,
    );
  });

  /*
   * The two real generations of 2026-09-19 are the only measurements there
   * are, and the window has to clear both by a wide margin or it would be a
   * number that ends work that was going to succeed.
   */
  test("clears the slowest generation ever observed, 21s, several times over", () => {
    assert.equal(hasExpired(attempt().createdAt, STARTED + 8_000), false);
    assert.equal(hasExpired(attempt().createdAt, STARTED + 21_000), false);
    assert.ok(GENERATION_WINDOW_MS >= 4 * 21_000);
  });

  /*
   * A date that cannot be read is not a reason to declare a generation lost.
   * The provider still has the answer and the next poll will get it; writing
   * 'failed' here would throw away an image that was already paid for.
   */
  test("an unreadable date is not an expiry", () => {
    assert.equal(hasExpired("not a date", STARTED + 10_000_000), false);
    assert.equal(hasExpired("", STARTED), false);
  });
});

describe("elapsedSeconds", () => {
  test("counts whole seconds from the row, not from a click", () => {
    assert.equal(elapsedSeconds(attempt().createdAt, STARTED), 0);
    assert.equal(elapsedSeconds(attempt().createdAt, STARTED + 8_400), 8);
    assert.equal(elapsedSeconds(attempt().createdAt, STARTED + 21_000), 21);
  });

  /*
   * The database stamps created_at and the browser reads the clock. They are
   * two clocks, so the difference can come out negative, and a counter that
   * runs backwards would be read as a bug in the generation rather than in
   * the clocks.
   */
  test("never runs backwards when the two clocks disagree", () => {
    assert.equal(elapsedSeconds(attempt().createdAt, STARTED - 5_000), 0);
  });

  test("an unreadable date counts as just started", () => {
    assert.equal(elapsedSeconds("not a date", STARTED), 0);
  });
});

describe("POLL_INTERVAL_MS", () => {
  /*
   * Two ends, both measured against the 8s and 21s of 2026-09-19. The picture
   * must not sit finished on the server for long before the panel shows it,
   * and the slowest generation seen must still cost a handful of short calls
   * rather than a stream of them.
   */
  test("shows a finished picture within three seconds of it being ready", () => {
    assert.ok(POLL_INTERVAL_MS <= 3_000);
  });

  test("costs at most a dozen questions over the slowest generation seen", () => {
    assert.ok(Math.ceil(21_000 / POLL_INTERVAL_MS) <= 12);
  });
});

describe("generationSeconds", () => {
  const started = "2026-09-19T18:32:32.309Z";

  /** The row shape the duration is read from, at a chosen end. */
  function finished(over: Partial<Finished> = {}): Finished {
    return {
      provider: "freepik",
      createdAt: started,
      completedAt: "2026-09-19T18:32:44.309Z",
      ...over,
    };
  }

  test("is the whole wait, from the row being made to it being stored", () => {
    assert.equal(generationSeconds(finished()), 12);
  });

  /*
   * The two attempts the new shape had actually produced by 2026-09-19, read
   * off the rows: 16.55s and 26.29s. They are here because they are the only
   * real durations there are, and because the second of them is above the 21s
   * that was the worst anyone had seen before.
   */
  test("reads the two real durations there are", () => {
    assert.equal(
      generationSeconds(finished({ completedAt: "2026-09-19T18:32:48.859Z" })),
      17,
    );
    assert.equal(
      generationSeconds(finished({ completedAt: "2026-09-19T18:32:58.599Z" })),
      26,
    );
  });

  /*
   * Rounded, not floored. The live counter floors because it counts seconds
   * that have gone by; this is a measurement, and shaving up to a second off
   * every one of them would be a bias.
   */
  test("rounds rather than floors", () => {
    assert.equal(
      generationSeconds(finished({ completedAt: "2026-09-19T18:32:44.909Z" })),
      13,
    );
    assert.equal(
      generationSeconds(finished({ completedAt: "2026-09-19T18:32:44.209Z" })),
      12,
    );
  });

  test("says nothing about an upload, whose stamp measures something else", () => {
    assert.equal(generationSeconds(finished({ provider: "upload" })), null);
  });

  /*
   * No stamp covers two rows that look nothing alike and answer the same:
   * one still running, and one made before the column existed. Neither has a
   * duration, and neither should be given one from decided_at, which is when
   * the teacher judged the picture rather than when it arrived.
   */
  test("says nothing without a stamp, running or merely old", () => {
    assert.equal(generationSeconds(finished({ completedAt: null })), null);
    assert.equal(
      generationSeconds({
        provider: "freepik",
        createdAt: "2026-09-19T00:06:46.314Z",
        completedAt: null,
      }),
      null,
    );
  });

  test("says nothing when a date cannot be read", () => {
    assert.equal(generationSeconds(finished({ createdAt: "nope" })), null);
    assert.equal(generationSeconds(finished({ completedAt: "nope" })), null);
  });

  /*
   * created_at is stamped by Postgres and completed_at by the application
   * server. A negative gap means the skew between those two clocks is bigger
   * than the thing being measured, and no number beats a wrong one.
   */
  test("says nothing when the end is before the beginning", () => {
    assert.equal(
      generationSeconds(finished({ completedAt: "2026-09-19T18:32:31.000Z" })),
      null,
    );
  });

  test("a generation that ended at once is zero, not nothing", () => {
    assert.equal(generationSeconds(finished({ completedAt: started })), 0);
  });
});

describe("fitWithin", () => {
  test("shrinks a landscape picture by its longest side", () => {
    assert.deepEqual(fitWithin(4000, 3000, 1536), {
      width: 1536,
      height: 1152,
    });
  });

  test("shrinks a portrait one by its longest side too", () => {
    assert.deepEqual(fitWithin(3000, 4000, 1536), {
      width: 1152,
      height: 1536,
    });
  });

  test("a square comes out square", () => {
    assert.deepEqual(fitWithin(4096, 4096, 1536), {
      width: 1536,
      height: 1536,
    });
  });

  /*
   * Enlarging would cost bytes and add nothing: the pixels to fill the extra
   * space with do not exist. Below the limit the size is left exactly alone,
   * so a small reference is re-encoded rather than resampled for no reason.
   */
  test("never enlarges, and leaves a small one untouched", () => {
    assert.deepEqual(fitWithin(800, 600, 1536), { width: 800, height: 600 });
    assert.deepEqual(fitWithin(1, 1, 1536), { width: 1, height: 1 });
  });

  test("exactly at the limit is not touched", () => {
    assert.deepEqual(fitWithin(1536, 1000, 1536), {
      width: 1536,
      height: 1000,
    });
    assert.deepEqual(fitWithin(1537, 1000, 1536), { width: 1536, height: 999 });
  });

  /*
   * A picture 4000 by 3 is absurd and someone will upload one. The short side
   * must still come out at least a pixel, or the canvas is zero tall and
   * drawing into it throws.
   */
  test("the short side never rounds away to nothing", () => {
    const fitted = fitWithin(4000, 3, REFERENCE_MAX_SIDE);
    assert.equal(fitted.width, REFERENCE_MAX_SIDE);
    assert.ok(fitted.height >= 1);
  });

  test("the ratio survives the shrink", () => {
    const { width, height } = fitWithin(3024, 4032, REFERENCE_MAX_SIDE);
    assert.ok(Math.abs(width / height - 3024 / 4032) < 0.01);
  });
});
