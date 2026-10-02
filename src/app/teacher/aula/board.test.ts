import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  BOARD,
  boardKey,
  clearAll,
  fit,
  standing,
  toBoard,
  undo,
  type Mark,
} from "./board.ts";

const stroke = (x: number): Mark => ({
  kind: "stroke",
  ink: "black",
  points: [[x, x]],
});
const text = (value: string): Mark => ({
  kind: "text",
  ink: "red",
  at: [0, 0],
  text: value,
});

describe("undo", () => {
  test("takes back the last stroke or text, one at a time", () => {
    const marks = [stroke(1), text("cat"), stroke(2)];
    assert.deepEqual(undo(marks), [stroke(1), text("cat")]);
    assert.deepEqual(undo(undo(marks)), [stroke(1)]);
  });

  test("does nothing on an empty board", () => {
    assert.deepEqual(undo([]), []);
  });

  test("brings back a board that was cleared", () => {
    const marks = [stroke(1), text("cat")];
    const cleared = clearAll(marks);
    assert.deepEqual(standing(cleared), []);
    assert.deepEqual(standing(undo(cleared)), marks);
  });
});

describe("clearAll", () => {
  test("leaves only what is drawn after it", () => {
    const marks = [...clearAll([stroke(1)]), stroke(2)];
    assert.deepEqual(standing(marks), [stroke(2)]);
  });

  test("an empty board is not cleared again", () => {
    const cleared = clearAll([stroke(1)]);
    assert.equal(clearAll(cleared), cleared);
    assert.deepEqual(clearAll([]), []);
  });
});

describe("fit", () => {
  test("keeps one scale for both axes and centres the board", () => {
    // A window wider than 16:9: the height decides, the rest is margin.
    assert.deepEqual(fit({ width: 1000, height: 450 }), {
      scale: 0.5,
      left: 100,
      top: 0,
    });
    // A taller one: the width decides.
    assert.deepEqual(fit({ width: 800, height: 600 }), {
      scale: 0.5,
      left: 0,
      top: 75,
    });
  });

  test("the middle of the area is the middle of the board at any size", () => {
    for (const area of [
      { width: 1000, height: 450 },
      { width: 800, height: 600 },
      { width: 1920, height: 1080 },
    ]) {
      assert.deepEqual(toBoard(area, area.width / 2, area.height / 2), [
        BOARD.width / 2,
        BOARD.height / 2,
      ]);
    }
  });
});

describe("boardKey", () => {
  const plain = { ctrlKey: false, metaKey: false, altKey: false };
  const press = (key: string, open: boolean) =>
    boardKey({ key, ...plain }, open);

  test("the arrows and the space do not reach the lesson while it is open", () => {
    for (const key of [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      " ",
    ]) {
      assert.equal(press(key, true), "swallow", key);
      assert.equal(press(key, false), "pass", key);
    }
  });

  test("Q opens and minimises, in either case", () => {
    for (const open of [true, false]) {
      assert.equal(press("q", open), "toggle");
      assert.equal(press("Q", open), "toggle");
    }
  });

  test("Ctrl+Z and Cmd+Z undo only while it is open", () => {
    const ctrl = { key: "z", ctrlKey: true, metaKey: false, altKey: false };
    const cmd = { key: "z", ctrlKey: false, metaKey: true, altKey: false };
    assert.equal(boardKey(ctrl, true), "undo");
    assert.equal(boardKey(cmd, true), "undo");
    assert.equal(boardKey(ctrl, false), "pass");
  });

  test("the other keys go on to the lesson", () => {
    assert.equal(press("f", true), "pass");
    assert.equal(press("z", true), "pass");
    // The browser's own shortcuts are not the board's.
    assert.equal(boardKey({ ...plain, key: "q", ctrlKey: true }, true), "pass");
    assert.equal(
      boardKey({ ...plain, key: "ArrowLeft", altKey: true }, true),
      "pass",
    );
  });
});
