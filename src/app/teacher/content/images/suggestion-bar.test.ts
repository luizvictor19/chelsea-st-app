import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  RACE_REACH,
  beginPass,
  confirmedWords,
  fillClass,
  raceTarget,
  widthOf,
} from "./suggestion-bar.ts";

describe("beginPass", () => {
  /*
   * The bug this exists for. A second run over the same lesson did not start
   * from zero: the fill was left at 100%, zeroing it under the settling class
   * animated a 220ms descent, and the forced layout meant to fix zero as the
   * value to come from read a point half way down. The race then began from
   * the middle of a retreat. A first run after a page load looked right only
   * because there was nothing to descend from.
   */
  test("two passes in a row start from the same place", () => {
    assert.deepEqual(beginPass(60), beginPass(60));
    assert.deepEqual(beginPass(60), { ...beginPass(60) });
  });

  test("a pass starts at zero, with nothing in flight", () => {
    assert.equal(beginPass(60).covered, 0);
    assert.equal(beginPass(60).racingTo, null);
    assert.equal(beginPass(60).total, 60);
  });

  /*
   * The half of it that is not a number. Zero has to arrive without a
   * transition, or the descent from the last pass is what the race starts
   * from.
   */
  test("the zero of a new pass is not animated", () => {
    assert.equal(fillClass(beginPass(60)), "is-instant");
    assert.notEqual(fillClass(beginPass(60)), "is-settling");
  });
});

describe("fillClass", () => {
  test("races while a batch is in flight", () => {
    assert.equal(
      fillClass({ covered: 10, total: 60, racingTo: 20, instant: false }),
      "is-racing",
    );
  });

  test("settles between batches", () => {
    assert.equal(
      fillClass({ covered: 20, total: 60, racingTo: null, instant: false }),
      "is-settling",
    );
  });

  /* Instant wins over everything: it is the frame that has to not animate. */
  test("an instant frame never animates, whatever else it says", () => {
    assert.equal(
      fillClass({ covered: 0, total: 60, racingTo: 10, instant: true }),
      "is-instant",
    );
  });
});

describe("confirmedWords", () => {
  test("is the server's count when nothing is holding it up", () => {
    assert.equal(confirmedWords(20, 0), 20);
    assert.equal(confirmedWords(0, 0), 0);
  });

  /*
   * The invariant, and the reason this is a function rather than an
   * expression in the component: inside a run the bar may not walk back. A
   * run only adds suggestions, so a smaller count arriving mid-run is a
   * re-render out of order and not work being undone — but on the screen the
   * two look the same, and only one of them is true.
   */
  /*
   * This watches the confirmed numbers and nothing else, which is the
   * boundary of what this module can be held to. The bug where a second pass
   * started from the middle of a retreat had every number here correct; what
   * moved wrongly was the width in the DOM, under a transition nobody asked
   * for. See fillClass for the part of that this file does cover.
   */
  test("never goes backwards inside a run", () => {
    let floor = 0;
    const seen: number[] = [];
    for (const fromServer of [0, 10, 20, 20, 10, 30, 25, 40, 40]) {
      const confirmed = confirmedWords(fromServer, floor);
      floor = confirmed;
      seen.push(confirmed);
    }
    assert.deepEqual(seen, [0, 10, 20, 20, 20, 30, 30, 40, 40]);
    for (let i = 1; i < seen.length; i += 1) {
      assert.ok(
        seen[i] >= seen[i - 1],
        `fell from ${seen[i - 1]} to ${seen[i]}`,
      );
    }
  });

  test("a floor from an earlier run does not invent progress", () => {
    // The floor is reset when a run starts, so this is the resting case: no
    // floor, and the count is whatever the server says even if it is lower
    // than something this browser saw an hour ago.
    assert.equal(confirmedWords(5, 0), 5);
  });
});

describe("raceTarget", () => {
  test("creeps into the batch in flight without reaching its end", () => {
    const target = raceTarget(10, 60, 10);
    assert.ok(target !== null);
    assert.ok(target > 10, "does not move at all");
    assert.ok(target < 20, "arrives at a number nobody confirmed");
    assert.equal(target, 10 + RACE_REACH * 10);
  });

  test("does not race when nothing is in flight", () => {
    assert.equal(raceTarget(10, 60, null), null);
  });

  /*
   * The case task 2 is about. Re-running a lesson whose words all carry a
   * suggestion cannot add one, so there is no room, and a race here would be
   * the bar inventing movement for work that changes no count.
   */
  test("does not race when the lesson is already full", () => {
    assert.equal(raceTarget(60, 60, 10), null);
  });

  test("never targets past the end of the lesson", () => {
    // A last batch of ten over a lesson with four words left in it.
    const target = raceTarget(56, 60, 10);
    assert.ok(target !== null && target < 60, `targeted ${target}`);
  });

  test("a batch of no words is not a race", () => {
    assert.equal(raceTarget(10, 60, 0), null);
  });
});

describe("widthOf", () => {
  test("is a percentage of the total", () => {
    assert.equal(widthOf(30, 60), "50.00%");
    assert.equal(widthOf(0, 60), "0.00%");
    assert.equal(widthOf(60, 60), "100.00%");
  });

  /* A lesson with no words divides by zero; the bar is simply empty. */
  test("a lesson of no words is empty rather than broken", () => {
    assert.equal(widthOf(0, 0), "0%");
    assert.equal(widthOf(5, 0), "0%");
  });

  test("clamps rather than overflowing the track", () => {
    assert.equal(widthOf(90, 60), "100.00%");
    assert.equal(widthOf(-5, 60), "0.00%");
  });
});
