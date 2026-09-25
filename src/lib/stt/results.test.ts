import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseCases } from "./cases.ts";
import { answeredKeys, parseResults, resultKey } from "./results.ts";

const LINE = {
  at: "2026-09-25T12:00:00.000Z",
  caseId: "g02",
  provider: "deepgram-nova-3",
  round: 1,
  audioSha256: "abc",
  audioSeconds: 2.1,
  contentType: "audio/webm;codecs=opus",
  model: "nova-3",
  text: "the book are on the table",
  confidence: 0.9,
  pieces: null,
  ms: 400,
  error: null,
};

describe("parseResults", () => {
  test("a torn last line is counted, and everything before it is kept", () => {
    const content = `${JSON.stringify(LINE)}\n{"caseId":"g0`;
    const { lines, unreadable } = parseResults(content);
    assert.equal(lines.length, 1);
    assert.equal(unreadable, 1);
  });
});

describe("answeredKeys", () => {
  test("a failed call is not answered, so the next run tries it again", () => {
    const failed = { ...LINE, round: 2, text: null, error: "timeout" };
    const keys = answeredKeys([LINE, failed]);
    assert.equal(keys.has(resultKey(LINE)), true);
    assert.equal(keys.has(resultKey(failed)), false);
  });

  test("a new recording of the same case is a new key", () => {
    assert.notEqual(
      resultKey(LINE),
      resultKey({ ...LINE, audioSha256: "def" }),
    );
  });
});

describe("parseCases", () => {
  const base = {
    question: "Is this a pen?",
    spoken: "Yes, it is pen.",
    expected: "Yes, it is a pen.",
  };

  test("an error case without its spans is refused", () => {
    assert.throws(
      () => parseCases([{ id: "g01", category: "grammar_error", ...base }]),
      /needs errorSpan and correctedSpan/,
    );
  });

  test("an id that could leave the folder is refused", () => {
    assert.throws(
      () => parseCases([{ id: "../x", category: "correct", ...base }]),
      /id must look like/,
    );
  });

  test("a case without expected is refused, not read as expecting nothing", () => {
    const { expected: _drop, ...rest } = base;
    void _drop;
    assert.throws(
      () => parseCases([{ id: "c01", category: "correct", ...rest }]),
      /expected must be a sentence or null/,
    );
  });

  test("a duplicate id is refused", () => {
    const one = { id: "c01", category: "correct", ...base };
    assert.throws(() => parseCases([one, one]), /duplicate id c01/);
  });
});
