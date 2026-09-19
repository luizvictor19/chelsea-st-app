import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildSubjectPrompt, parseSubject } from "./subject.ts";

describe("buildSubjectPrompt", () => {
  test("names the word it is asking about", () => {
    const { user } = buildSubjectPrompt("umbrella", "photo");
    assert.match(user, /umbrella/u);
  });

  test("names the kind, so the shape of the answer follows the category", () => {
    assert.match(buildSubjectPrompt("sitting", "pose").user, /pose/u);
    assert.match(buildSubjectPrompt("sit down", "action").user, /action/u);
    assert.match(buildSubjectPrompt("under", "figure").user, /figure/u);
    assert.match(buildSubjectPrompt("book", "photo").user, /photo/u);
  });

  test("asks for English, which is the language of the picture, not of the teacher", () => {
    const { user } = buildSubjectPrompt("book", "photo");
    assert.match(user, /in English/iu);
  });

  /*
   * Each kind has to ask for something different, or the category would be
   * named in the prompt and ignored in the answer.
   */
  test("describes a different shape for each kind", () => {
    const shapes = (["photo", "pose", "action", "figure"] as const).map(
      (kind) => buildSubjectPrompt("x", kind).user,
    );
    assert.equal(new Set(shapes).size, shapes.length);
    assert.match(buildSubjectPrompt("x", "pose").user, /at rest/iu);
    assert.match(buildSubjectPrompt("x", "action").user, /doing/iu);
    assert.match(buildSubjectPrompt("x", "figure").user, /no person/iu);
    assert.match(buildSubjectPrompt("x", "photo").user, /on its own/iu);
  });

  test("asks for json and caps the length", () => {
    const { system } = buildSubjectPrompt("book", "photo");
    assert.match(system, /json/iu);
    assert.match(system, /at most 12 words/iu);
  });

  /*
   * Measured against the live model on 2026-09-19: without this line, "book"
   * came back as "a closed hardcover book on a plain white background". The
   * style constant already fixes a warm off-white background, so the subject
   * was arguing with it. With the line, the same word answers "a single
   * closed hardcover book with a plain cover".
   */
  test("tells the model the background and the style are not its business", () => {
    const { system } = buildSubjectPrompt("book", "photo");
    assert.match(system, /background/iu);
    assert.match(system, /already fixed elsewhere/iu);
  });

  test("refuses a kind that has no picture, and an empty word", () => {
    assert.throws(() => buildSubjectPrompt("six", "symbol"), /symbol/);
    assert.throws(() => buildSubjectPrompt("the", "none"), /none/);
    assert.throws(() => buildSubjectPrompt("  ", "photo"), /word/);
  });
});

describe("parseSubject", () => {
  test("reads the phrase", () => {
    assert.equal(
      parseSubject('{"subject": "a black umbrella"}'),
      "a black umbrella",
    );
  });

  test("unwraps a fenced block and strips stray quotes", () => {
    assert.equal(
      parseSubject('```json\n{"subject": "\'a red book\'"}\n```'),
      "a red book",
    );
  });

  /*
   * A refusal leaves the teacher typing, which is what they were doing
   * anyway, so nothing here throws.
   */
  test("returns null for anything that is not a phrase", () => {
    for (const junk of [
      "",
      "not json",
      "{}",
      '{"subject": 12}',
      '{"subject": ""}',
      '{"subject": "   "}',
      '{"phrase": "a book"}',
      "[]",
    ]) {
      assert.equal(parseSubject(junk), null, junk);
    }
  });
});
