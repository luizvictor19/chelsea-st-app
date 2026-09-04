import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  asksForPoint,
  canConfirm,
  chosenPoint,
  type PageQuestion,
  type PointChoice,
} from "./point-question.ts";

const unanswerable: PageQuestion = {
  points: [],
  inheritedPoint: null,
  disputeCandidates: [],
};
const disputed: PageQuestion = {
  points: [],
  inheritedPoint: null,
  disputeCandidates: [4, 45, 74],
};
const settled: PageQuestion = {
  points: [116],
  inheritedPoint: null,
  disputeCandidates: [],
};
const continuation: PageQuestion = {
  points: [],
  inheritedPoint: 118,
  disputeCandidates: [],
};

const blank: PointChoice = {
  pointNumber: null,
  continuation: false,
  typedPoint: "",
};

describe("asksForPoint", () => {
  test("asks when the page carries no number and nothing precedes it", () => {
    assert.equal(asksForPoint(unanswerable), true);
  });

  test("asks when the batch left candidates it could not choose between", () => {
    assert.equal(asksForPoint(disputed), true);
  });

  test("does not ask when the page carries its own number", () => {
    assert.equal(asksForPoint(settled), false);
  });

  test("does not ask when there is a point to inherit", () => {
    assert.equal(asksForPoint(continuation), false);
  });

  test("typing an answer does not make the question disappear", () => {
    // The bug this exists to stop. The question used to be shown while the
    // target was null, and the first keystroke gave it a target, so the input
    // unmounted mid-number and the page was left assigned to point 1.
    const typing: PointChoice = {
      pointNumber: null,
      continuation: true,
      typedPoint: "1",
    };
    assert.equal(asksForPoint(unanswerable), true);
    assert.equal(chosenPoint(unanswerable, typing), 1);
    assert.equal(
      asksForPoint(unanswerable),
      true,
      "visibility must not depend on what has been typed so far",
    );
  });

  test("a number is typed one digit at a time and survives it", () => {
    let choice: PointChoice = {
      pointNumber: null,
      continuation: true,
      typedPoint: "",
    };
    for (const typedPoint of ["1", "11", "118"]) {
      choice = { ...choice, typedPoint };
      assert.equal(
        asksForPoint(unanswerable),
        true,
        `the field must still be there after typing ${typedPoint}`,
      );
    }
    assert.equal(chosenPoint(unanswerable, choice), 118);
  });
});

describe("chosenPoint", () => {
  test("a page carrying a number uses it", () => {
    assert.equal(chosenPoint(settled, { ...blank, pointNumber: 116 }), 116);
  });

  test("a continuation takes the point it inherits", () => {
    assert.equal(
      chosenPoint(continuation, { ...blank, continuation: true }),
      118,
    );
  });

  test("a typed point overrides what would have been inherited", () => {
    assert.equal(
      chosenPoint(continuation, {
        ...blank,
        continuation: true,
        typedPoint: "120",
      }),
      120,
    );
  });

  test("nothing typed yet is not an answer", () => {
    assert.equal(
      chosenPoint(unanswerable, { ...blank, continuation: true }),
      null,
    );
    assert.equal(
      chosenPoint(unanswerable, {
        ...blank,
        continuation: true,
        typedPoint: "  ",
      }),
      null,
    );
  });

  test("a nonsense value is not an answer either", () => {
    for (const typedPoint of ["0", "-3", "abc", "1.5"]) {
      assert.equal(
        chosenPoint(unanswerable, { ...blank, continuation: true, typedPoint }),
        null,
        `${typedPoint} must not be taken for a point`,
      );
    }
  });
});

describe("canConfirm", () => {
  test("refuses while the page has no point to write to", () => {
    assert.equal(canConfirm(unanswerable, blank), false);
    assert.equal(canConfirm(disputed, blank), false);
  });

  test("allows once the page has one", () => {
    assert.equal(canConfirm(settled, { ...blank, pointNumber: 116 }), true);
    assert.equal(
      canConfirm(continuation, { ...blank, continuation: true }),
      true,
    );
  });
});
