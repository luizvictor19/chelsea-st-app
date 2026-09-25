import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  HOLD_WHILE_TALKING,
  NOT_HEARD_NOW,
  NOT_STARTED_NOW,
  Session,
} from "./session.ts";
import type { Take, TurnEngine, TurnResult, TutorTurn } from "./turn-engine.ts";

/** A turn whose voice ends at once, and which records that it was played. */
function turn(
  term: string | null,
  played: string[],
  lead: string | null = null,
): TutorTurn {
  const speech = `${lead ?? "about"} ${term}`;
  return {
    speech,
    question: term === null ? null : "What is this?",
    word:
      term === null
        ? null
        : { term, imageUrl: `https://example.test/${term}.png` },
    verdict: null,
    lead,
    finished: term === null,
    play: async () => {
      played.push(speech);
    },
  };
}

/** A promise the test settles by hand, to decide when an answer lands. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Timers the test fires itself: the 5 s never pass on their own. */
function manualClock() {
  const pending = new Set<() => void>();
  return {
    schedule: (run: () => void) => {
      pending.add(run);
      return () => {
        pending.delete(run);
      };
    },
    pending: () => pending.size,
    fire: () => {
      const runs = [...pending];
      pending.clear();
      runs.forEach((run) => run());
    },
  };
}

type Script = {
  start?: () => Promise<TutorTurn>;
  respond?: (take: Take) => Promise<TurnResult>;
  nudge?: () => Promise<TutorTurn>;
};

function engineOf(script: Script, played: string[]): TurnEngine {
  return {
    start: script.start ?? (async () => turn("book", played)),
    respond:
      script.respond ??
      (async () => ({ kind: "turn", turn: turn("pen", played) })),
    nudge: script.nudge ?? (async () => turn("book", played, "It's a…")),
  };
}

const take: Take = { audio: new Blob([]), durationMs: 1500 };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function sessionAt(script: Script = {}) {
  const played: string[] = [];
  const clock = manualClock();
  const session = new Session({
    engine: engineOf(script, played),
    nudgeAfterMs: 5000,
    maxSpeakingMs: 1000,
    schedule: clock.schedule,
  });
  await session.begin();
  return { session, played, clock };
}

describe("Session", () => {
  test("opens on the first word, her turn, the countdown running", async () => {
    const { session, clock } = await sessionAt();
    const state = session.getState();
    assert.equal(state.phase, "waiting");
    assert.equal(state.turn?.word?.term, "book");
    assert.notEqual(state.nudgeAt, null);
    assert.equal(clock.pending(), 1);
  });

  test("an answer plays the tutor's next turn", async () => {
    const { session, played } = await sessionAt();
    assert.ok(session.listen());
    await session.answer(take);

    assert.equal(session.getState().phase, "waiting");
    assert.equal(session.getState().turn?.word?.term, "pen");
    assert.deepEqual(played, ["about book", "about pen"]);
    assert.equal(session.getState().practised, 2);
  });

  describe("when the engine fails", () => {
    test("a failed answer is not counted: same word, her turn, a hint", async () => {
      const { session } = await sessionAt({
        respond: async () => {
          throw new Error("network down");
        },
      });
      assert.ok(session.listen());
      await session.answer(take);

      const state = session.getState();
      assert.equal(state.phase, "waiting");
      assert.equal(state.hint, NOT_HEARD_NOW);
      assert.equal(state.turn?.word?.term, "book");
      assert.equal(state.turn?.verdict, null);
      // She can try again at once.
      assert.ok(session.listen());
    });

    test("a failed start leaves Começar working", async () => {
      const played: string[] = [];
      let fail = true;
      const session = new Session({
        engine: engineOf(
          {
            start: async () => {
              if (fail) throw new Error("tutor unavailable");
              return turn("book", played);
            },
          },
          played,
        ),
        nudgeAfterMs: 5000,
        maxSpeakingMs: 1000,
        schedule: manualClock().schedule,
      });

      await session.begin();
      assert.equal(session.getState().phase, "intro");
      assert.equal(session.getState().hint, NOT_STARTED_NOW);

      fail = false;
      await session.begin();
      assert.equal(session.getState().phase, "waiting");
      assert.deepEqual(played, ["about book"]);
    });

    test("a failed nudge leaves her turn as it was", async () => {
      const { session, clock, played } = await sessionAt({
        nudge: async () => {
          throw new Error("tutor unavailable");
        },
      });
      clock.fire();
      await settle();

      assert.equal(session.getState().phase, "waiting");
      assert.equal(session.getState().turn?.lead, null);
      assert.deepEqual(played, ["about book"]);
      assert.ok(session.listen());
    });
  });

  describe("after she leaves", () => {
    test("an answer that lands later neither speaks nor changes the screen", async () => {
      const late = deferred<TurnResult>();
      const { session, played } = await sessionAt({
        respond: () => late.promise,
      });
      const seen: string[] = [];
      session.subscribe(() => seen.push(session.getState().phase));

      assert.ok(session.listen());
      const answering = session.answer(take);
      assert.equal(session.getState().phase, "thinking");
      seen.length = 0;

      session.close();
      late.resolve({ kind: "turn", turn: turn("pen", played) });
      await answering;

      assert.deepEqual(played, ["about book"]);
      assert.equal(session.getState().turn?.word?.term, "book");
      assert.deepEqual(seen, []);
    });

    test("a failure that lands later does not show its hint", async () => {
      const late = deferred<TurnResult>();
      const { session } = await sessionAt({ respond: () => late.promise });
      assert.ok(session.listen());
      const answering = session.answer(take);

      session.close();
      late.reject(new Error("network down"));
      await answering;

      assert.equal(session.getState().hint, null);
    });

    test("a nudge that lands later is not played", async () => {
      const late = deferred<TutorTurn>();
      const { session, clock, played } = await sessionAt({
        nudge: () => late.promise,
      });
      clock.fire();
      session.close();
      late.resolve(turn("book", played, "It's a…"));
      await settle();

      assert.deepEqual(played, ["about book"]);
      assert.equal(session.getState().turn?.lead, null);
    });

    test("closing stops the countdown", async () => {
      const { session, clock } = await sessionAt();
      session.close();
      assert.equal(clock.pending(), 0);
    });
  });

  describe("with the microphone blocked", () => {
    test("the countdown stops and no nudge is given", async () => {
      const { session, clock, played } = await sessionAt();
      session.setMicrophone("denied");

      assert.equal(session.getState().nudgeAt, null);
      assert.equal(clock.pending(), 0);
      clock.fire();
      await settle();
      assert.deepEqual(played, ["about book"]);
    });

    /*
     * The space bar and the button both go through listen(), so this is the
     * one gate for both.
     */
    test("nothing records", async () => {
      const { session } = await sessionAt();
      session.setMicrophone("denied");
      assert.equal(session.listen(), false);
      assert.equal(session.getState().phase, "waiting");
    });

    /*
     * The order the review found: the recorder fails with NotAllowedError, the
     * screen hands the turn back and reports the microphone. Whichever comes
     * first, no countdown may be left running behind the instructions.
     */
    test("a recording refused mid-session leaves no countdown", async () => {
      const { session, clock } = await sessionAt();
      assert.ok(session.listen());
      session.cancel(null);
      session.setMicrophone("denied");
      assert.equal(clock.pending(), 0);

      const again = await sessionAt();
      assert.ok(again.session.listen());
      again.session.setMicrophone("denied");
      again.session.cancel(null);
      assert.equal(again.clock.pending(), 0);
      assert.equal(again.session.getState().nudgeAt, null);
    });

    test("unblocking restarts the countdown", async () => {
      const { session, clock } = await sessionAt();
      session.setMicrophone("denied");
      session.setMicrophone("ok");
      assert.equal(clock.pending(), 1);
      assert.ok(session.listen());
    });
  });

  test("a stray touch hands the turn back and restarts the countdown", async () => {
    const { session, clock } = await sessionAt();
    assert.ok(session.listen());
    assert.equal(clock.pending(), 0);
    session.cancel(HOLD_WHILE_TALKING);
    assert.equal(session.getState().phase, "waiting");
    assert.equal(session.getState().hint, HOLD_WHILE_TALKING);
    assert.equal(clock.pending(), 1);
  });
});
