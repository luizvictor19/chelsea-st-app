import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  GENERATION_WINDOW_MS,
  POLL_INTERVAL_MS,
  elapsedSeconds,
  hasExpired,
  isRunning,
  runningAttempt,
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
