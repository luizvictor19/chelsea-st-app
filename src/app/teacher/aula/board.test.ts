import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  boardKey,
  cardScale,
  clampShare,
  clearAll,
  editText,
  LETTER,
  shareAt,
  SPLIT,
  standing,
  textAt,
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
    assert.deepEqual(standing(undo(cleared)), [
      stroke(1),
      { ...text("cat"), origin: 1 },
    ]);
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

describe("editText", () => {
  const written = (marks: readonly Mark[]) =>
    standing(marks).flatMap((mark) => (mark.kind === "text" ? mark.text : []));

  test("rewrites the text where it was, keeping its place, colour and order", () => {
    const marks = [text("cat"), stroke(1), text("dog")];
    const edited = editText(marks, 0, "cats");
    assert.deepEqual(standing(edited), [
      { ...text("cats"), origin: 0 },
      stroke(1),
      { ...text("dog"), origin: 2 },
    ]);
  });

  test("is one step for undo, which brings the text before it back", () => {
    const marks = [text("cat")];
    const twice = editText(editText(marks, 0, "cats"), 0, "the cats");
    assert.deepEqual(written(twice), ["the cats"]);
    assert.deepEqual(written(undo(twice)), ["cats"]);
    assert.deepEqual(written(undo(undo(twice))), ["cat"]);
  });

  test("left empty, the text is removed, and undo brings it back", () => {
    const marks = [text("cat"), text("dog")];
    const removed = editText(marks, 0, "   ");
    assert.deepEqual(written(removed), ["dog"]);
    assert.deepEqual(written(undo(removed)), ["cat", "dog"]);
  });

  test("left as it was, nothing is added for undo to spend", () => {
    const marks = [text("cat")];
    assert.equal(editText(marks, 0, "cat"), marks);
    assert.equal(editText(marks, 0, " cat "), marks);
  });

  test("a mark that is not a standing text is not edited", () => {
    const marks = [stroke(1), text("cat")];
    assert.equal(editText(marks, 0, "x"), marks);
    assert.equal(editText(marks, 7, "x"), marks);
    const cleared = clearAll(marks);
    assert.equal(editText(cleared, 1, "x"), cleared);
  });

  test("a text written after an edit keeps its own place in the list", () => {
    const marks = [...editText([text("cat")], 0, "cats"), text("dog")];
    assert.deepEqual(written(editText(marks, 2, "dogs")), ["cats", "dogs"]);
  });
});

describe("textAt", () => {
  // Ten pixels a letter, so "cat" at x 100 runs from 100 to 130.
  const widthOf = (value: string) => value.length * 10;
  const at = (value: string, x: number, y: number): Mark => ({
    kind: "text",
    ink: "blue",
    at: [x, y],
    text: value,
  });
  const half = (LETTER.size * LETTER.line) / 2;

  test("finds the text whose line the point is on", () => {
    const shown = standing([at("cat", 100, 200), at("dog", 100, 400)]);
    assert.equal(textAt(shown, [115, 200], widthOf)?.text, "cat");
    assert.equal(textAt(shown, [100, 200 - half], widthOf)?.text, "cat");
    assert.equal(textAt(shown, [130, 200 + half], widthOf)?.text, "cat");
    assert.equal(textAt(shown, [115, 400], widthOf)?.origin, 1);
  });

  test("empty board around a text is not the text", () => {
    const shown = standing([at("cat", 100, 200)]);
    assert.equal(textAt(shown, [99, 200], widthOf), null);
    assert.equal(textAt(shown, [131, 200], widthOf), null);
    assert.equal(textAt(shown, [115, 200 - half - 1], widthOf), null);
    assert.equal(textAt(shown, [115, 200 + half + 1], widthOf), null);
  });

  test("of two that overlap, the one written last", () => {
    const shown = standing([at("cat", 100, 200), at("dog", 110, 210)]);
    assert.equal(textAt(shown, [115, 205], widthOf)?.text, "dog");
  });

  test("a stroke over the point is not a text, and an edited text has its new width", () => {
    const marks = editText(
      [stroke(115), at("cat", 100, 200)],
      1,
      "cat and dog",
    );
    assert.equal(textAt(standing(marks), [115, 115], widthOf), null);
    assert.equal(textAt(standing(marks), [205, 200], widthOf)?.origin, 1);
  });
});

describe("the split of the row", () => {
  test("the share stays between a quarter and three quarters", () => {
    assert.equal(clampShare(0.1), SPLIT.least);
    assert.equal(clampShare(0.9), SPLIT.most);
    assert.equal(clampShare(0.4), 0.4);
  });

  test("the share follows the pointer from the right edge of the row", () => {
    // A row from 100 to 1100. The handle is 16 wide and its middle is under
    // the pointer, so the board begins 8 to the right of it.
    const row = { left: 100, width: 1000 };
    assert.equal(shareAt(row, 592), 0.5);
    assert.equal(shareAt(row, 692), 0.4);
    assert.equal(shareAt(row, 0), SPLIT.most);
    assert.equal(shareAt(row, 5000), SPLIT.least);
  });

  test("a row not measured yet gives the first share", () => {
    assert.equal(shareAt({ left: 0, width: 0 }, 300), SPLIT.first);
  });

  test("a closed board leaves the card at its full size", () => {
    assert.equal(cardScale(1000, null), 1);
    assert.equal(cardScale(0, 0.5), 1);
  });

  test("the card shrinks with what the board and the handle take", () => {
    // Row 1034: the card is 1034 * 0.5 - 16 = 501 wide, 467 inside its
    // frame of 34, where the full card has 1000.
    assert.equal(cardScale(1034, 0.5), 0.467);
    assert.ok(cardScale(1034, 0.75) < cardScale(1034, 0.5));
    assert.ok(cardScale(1034, 0.75) > 0);
    // Always under the bare share, since the handle and the frame do not
    // shrink: what is sized by it fits inside the card.
    for (const share of [0.25, 0.5, 0.75]) {
      assert.ok(cardScale(1034, share) < 1 - share);
    }
  });
});

describe("boardKey", () => {
  const plain = { ctrlKey: false, metaKey: false, altKey: false };
  const press = (key: string, open: boolean) =>
    boardKey({ key, ...plain }, open);

  test("the arrows and the space go on to the lesson, open or closed", () => {
    for (const key of [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      " ",
    ]) {
      assert.equal(press(key, true), "pass", key);
      assert.equal(press(key, false), "pass", key);
    }
  });

  test("Q opens and closes, in either case", () => {
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
