import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parsePictureKey, parsePictureKeys } from "./pictures.ts";

const PEN = "0856b144-e26a-473f-8278-81e4c50f8868";
const BOOK = "9c65031f-6944-4cd0-abde-36a921cb3294";
const SCENE = "1bb824bd-bb15-4b69-bc5e-8b7ab2671632";

describe("parsePictureKey", () => {
  test("reads a word's and a scene's", () => {
    assert.deepEqual(parsePictureKey(`word:${PEN}`), { kind: "word", id: PEN });
    assert.deepEqual(parsePictureKey(`scene:${SCENE}`), {
      kind: "scene",
      id: SCENE,
    });
  });

  test("refuses another kind, a missing id or one that is not a uuid", () => {
    assert.equal(parsePictureKey(`lesson:${PEN}`), null);
    assert.equal(parsePictureKey(PEN), null);
    assert.equal(parsePictureKey("word:"), null);
    assert.equal(parsePictureKey("word:pen),id.eq.x"), null);
  });
});

describe("parsePictureKeys", () => {
  test("keeps the order chosen", () => {
    const result = parsePictureKeys([`word:${BOOK}`, `word:${PEN}`], SCENE);
    assert.ok(result.ok);
    assert.deepEqual(
      result.sources.map((source) => source.id),
      [BOOK, PEN],
    );
  });

  /* is_reference_list (0033) holds 1 to 5; the sentence says it first. */
  test("takes 1 to 5", () => {
    assert.equal(parsePictureKeys([], SCENE).ok, false);
    assert.equal(parsePictureKeys([`word:${PEN}`], SCENE).ok, true);
    const six = Array.from(
      { length: 6 },
      (_, i) => `word:${PEN.slice(0, -1)}${i}`,
    );
    assert.equal(parsePictureKeys(six, SCENE).ok, false);
    assert.equal(parsePictureKeys(six.slice(0, 5), SCENE).ok, true);
  });

  test("refuses the same picture twice", () => {
    assert.equal(
      parsePictureKeys([`word:${PEN}`, `word:${PEN}`], SCENE).ok,
      false,
    );
  });

  test("refuses the scene being drawn, and takes another", () => {
    assert.equal(parsePictureKeys([`scene:${SCENE}`], SCENE).ok, false);
    assert.equal(parsePictureKeys([`scene:${SCENE}`], BOOK).ok, true);
  });

  test("refuses a key that is not one", () => {
    assert.equal(
      parsePictureKeys([`word:${PEN}`, "nonsense"], SCENE).ok,
      false,
    );
  });
});
