import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  GENERATION_WINDOW_MS,
  POLL_INTERVAL_MS,
} from "../../../../lib/images/generation.ts";
import type { Timer } from "../../notices.ts";

import {
  createGenerationTracker,
  type Generation,
  type PollAnswer,
} from "./generation-tracker.ts";
import type { NoticeText } from "./notice-texts.ts";

const START = Date.parse("2026-09-26T10:00:00.000Z");

/** A clock that only moves when told to, with the timers it owes. */
function clock() {
  let now = START;
  const pending = new Map<number, { at: number; run: () => void }>();
  let next = 1;
  const timer: Timer = {
    set(run, ms) {
      const handle = next++;
      pending.set(handle, { at: now + ms, run });
      return handle;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  /** Move on, firing what came due, then let the answers settle. */
  async function advance(ms: number) {
    now += ms;
    for (const [handle, entry] of [...pending]) {
      if (entry.at <= now) {
        pending.delete(handle);
        entry.run();
      }
    }
    await settled();
  }
  return { timer, advance, now: () => now, owed: () => pending.size };
}

/** Enough turns of the microtask queue for an answer to be acted on. */
async function settled() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** A provider the test answers by hand, one question at a time. */
function provider() {
  const asked: string[] = [];
  const open = new Map<string, (answer: PollAnswer) => void>();
  let inFlight = 0;
  let most = 0;
  const poll = (attemptId: string) => {
    asked.push(attemptId);
    inFlight++;
    most = Math.max(most, inFlight);
    return new Promise<PollAnswer>((resolve) => {
      open.set(attemptId, (answer) => {
        inFlight--;
        open.delete(attemptId);
        resolve(answer);
      });
    });
  };
  function answer(attemptId: string, with_: PollAnswer) {
    const reply = open.get(attemptId);
    assert.ok(reply, `nothing asked about ${attemptId}`);
    reply(with_);
  }
  return {
    poll,
    answer,
    asked,
    most: () => most,
    waiting: (id: string) => open.has(id),
  };
}

const STILL_RUNNING: PollAnswer = { ok: true };
const lost: PollAnswer = {
  ok: false,
  error: "A resposta do servidor não chegou.",
  cause: new TypeError("NetworkError"),
};
const finished = (
  id: string,
  status = "generated",
  error: string | null = null,
) => ({ ok: true, attempts: [{ id, status, error }] }) as PollAnswer;

function setup() {
  const time = clock();
  const fake = provider();
  const said: NoticeText[] = [];
  let refreshes = 0;
  const tracker = createGenerationTracker({
    poll: fake.poll,
    timer: time.timer,
    now: time.now,
    announce: (notice) => said.push(notice),
  });
  tracker.onEnd(() => refreshes++);
  return { tracker, time, fake, said, refreshes: () => refreshes };
}

const APPLE: Generation = {
  attemptId: "a1",
  wordId: "apple",
  term: "apple",
  startedAt: new Date(START).toISOString(),
};
const PEAR: Generation = {
  attemptId: "p1",
  wordId: "pear",
  term: "pear",
  startedAt: new Date(START).toISOString(),
};

describe("generation tracker", () => {
  test("one chain per attempt, even tracked twice", async () => {
    const { tracker, time, fake } = setup();
    tracker.track(APPLE);
    tracker.track(APPLE);
    assert.equal(tracker.getSnapshot().length, 1);

    await time.advance(POLL_INTERVAL_MS);
    assert.deepEqual(fake.asked, ["a1"]);
    assert.equal(time.owed(), 0);
  });

  test("never two questions in flight for one attempt", async () => {
    const { tracker, time, fake } = setup();
    tracker.track(APPLE);
    await time.advance(POLL_INTERVAL_MS);
    // Tracked again while the question is out, and time passes.
    tracker.track(APPLE);
    await time.advance(POLL_INTERVAL_MS * 5);
    assert.deepEqual(fake.asked, ["a1"]);

    fake.answer("a1", STILL_RUNNING);
    await settled();
    await time.advance(POLL_INTERVAL_MS);
    assert.deepEqual(fake.asked, ["a1", "a1"]);
    assert.equal(fake.most(), 1);
  });

  test("the end is said once, with the term, and the page refreshed once", async () => {
    const { tracker, time, fake, said, refreshes } = setup();
    tracker.track(APPLE);
    await time.advance(POLL_INTERVAL_MS);
    fake.answer("a1", finished("a1"));
    await settled();

    assert.deepEqual(said, [
      { kind: "success", text: "apple: imagem gerada." },
    ]);
    assert.equal(refreshes(), 1);
    assert.deepEqual(tracker.getSnapshot(), []);

    // A list from before the end still shows it running: nothing reopens.
    tracker.track(APPLE);
    await time.advance(POLL_INTERVAL_MS * 3);
    assert.equal(said.length, 1);
    assert.deepEqual(fake.asked, ["a1"]);
  });

  test("a failure written on the row is said as an error", async () => {
    const { tracker, time, fake, said } = setup();
    tracker.track(APPLE);
    await time.advance(POLL_INTERVAL_MS);
    // recordFailure's answer: the reason, and the list with the row failed.
    fake.answer("a1", {
      ok: false,
      error: "A geração passou de 90 segundos sem responder.",
      attempts: [{ id: "a1", status: "failed", error: "x" }],
    });
    await settled();
    assert.deepEqual(said, [
      {
        kind: "error",
        text: "apple: A geração passou de 90 segundos sem responder.",
      },
    ]);
    assert.equal(time.owed(), 0);
  });

  test("a failed row in the list is said with the row's reason", async () => {
    const { tracker, time, fake, said } = setup();
    tracker.track(APPLE);
    await time.advance(POLL_INTERVAL_MS);
    fake.answer("a1", finished("a1", "failed", "sem crédito"));
    await settled();
    assert.deepEqual(said, [{ kind: "error", text: "apple: sem crédito." }]);
  });

  test("a lost answer is asked again inside the window", async () => {
    const { tracker, time, fake, said } = setup();
    tracker.track(APPLE);
    await time.advance(POLL_INTERVAL_MS);
    fake.answer("a1", lost);
    await settled();
    assert.deepEqual(said, []);

    await time.advance(POLL_INTERVAL_MS);
    assert.deepEqual(fake.asked, ["a1", "a1"]);
  });

  test("a lost answer past the window stops, and says so", async () => {
    const { tracker, time, fake, said } = setup();
    tracker.track(APPLE);
    await time.advance(GENERATION_WINDOW_MS + 1);
    fake.answer("a1", lost);
    await settled();

    assert.deepEqual(said, [
      { kind: "error", text: "apple: A resposta do servidor não chegou." },
    ]);
    assert.equal(time.owed(), 0);
    assert.deepEqual(tracker.getSnapshot(), []);
  });

  test("two words' generations go at once", async () => {
    const { tracker, time, fake, said } = setup();
    tracker.track(APPLE);
    tracker.track(PEAR);
    await time.advance(POLL_INTERVAL_MS);
    assert.ok(fake.waiting("a1"));
    assert.ok(fake.waiting("p1"));

    fake.answer("p1", finished("p1"));
    fake.answer("a1", STILL_RUNNING);
    await settled();
    assert.deepEqual(
      said.map((n) => n.text),
      ["pear: imagem gerada."],
    );
    assert.deepEqual(
      tracker.getSnapshot().map((g) => g.attemptId),
      ["a1"],
    );

    await time.advance(POLL_INTERVAL_MS);
    fake.answer("a1", finished("a1"));
    await settled();
    assert.deepEqual(
      said.map((n) => n.text),
      ["pear: imagem gerada.", "apple: imagem gerada."],
    );
  });

  test("the chain stops when the attempt ends", async () => {
    const { tracker, time, fake } = setup();
    tracker.track(APPLE);
    await time.advance(POLL_INTERVAL_MS);
    fake.answer("a1", STILL_RUNNING);
    await settled();
    await time.advance(POLL_INTERVAL_MS);
    fake.answer("a1", finished("a1"));
    await settled();

    assert.equal(time.owed(), 0);
    await time.advance(POLL_INTERVAL_MS * 10);
    assert.deepEqual(fake.asked, ["a1", "a1"]);
  });

  test("a row still pending in the list keeps the chain going", async () => {
    const { tracker, time, fake, said } = setup();
    tracker.track(APPLE);
    await time.advance(POLL_INTERVAL_MS);
    fake.answer("a1", finished("a1", "pending"));
    await settled();
    assert.deepEqual(said, []);
    assert.equal(time.owed(), 1);
  });

  test("an attempt gone from the list ends without a notice", async () => {
    const { tracker, time, fake, said, refreshes } = setup();
    tracker.track(APPLE);
    await time.advance(POLL_INTERVAL_MS);
    fake.answer("a1", { ok: true, attempts: [] });
    await settled();
    assert.deepEqual(said, []);
    assert.equal(refreshes(), 1);
    assert.deepEqual(tracker.getSnapshot(), []);
  });

  test("subscribers hear a start and an end", async () => {
    const { tracker, time, fake } = setup();
    let heard = 0;
    tracker.subscribe(() => heard++);
    tracker.track(APPLE);
    const during = tracker.getSnapshot();
    assert.equal(tracker.getSnapshot(), during);
    await time.advance(POLL_INTERVAL_MS);
    fake.answer("a1", finished("a1"));
    await settled();
    assert.equal(heard, 2);
  });

  /*
   * A failure the row does not confirm (a read that failed, a write after the
   * upload that failed, an answer lost past the window) leaves the attempt
   * pending in the database. It is said, and the chain stops, but the attempt
   * is not closed for good: the next load that still finds it running picks
   * it up again, as coming back to the word did before.
   */
  test("a failure the row does not confirm can be tracked again", async () => {
    const { tracker, time, fake, said, refreshes } = setup();
    tracker.track(APPLE);
    await time.advance(POLL_INTERVAL_MS);
    fake.answer("a1", { ok: false, error: "permission denied" });
    await settled();
    assert.deepEqual(said, [
      { kind: "error", text: "apple: permission denied." },
    ]);
    assert.deepEqual(tracker.getSnapshot(), []);
    // No refresh: it would re-render, find the row pending and loop.
    assert.equal(refreshes(), 0);

    tracker.track(APPLE);
    await time.advance(POLL_INTERVAL_MS);
    assert.deepEqual(fake.asked, ["a1", "a1"]);
  });

  test("a failure the row confirms is closed for good", async () => {
    const { tracker, time, fake } = setup();
    tracker.track(APPLE);
    await time.advance(POLL_INTERVAL_MS);
    fake.answer("a1", {
      ok: false,
      error: "sem crédito",
      attempts: [{ id: "a1", status: "failed", error: "sem crédito" }],
    });
    await settled();
    tracker.track(APPLE);
    await time.advance(POLL_INTERVAL_MS * 3);
    assert.deepEqual(fake.asked, ["a1"]);
  });
});
