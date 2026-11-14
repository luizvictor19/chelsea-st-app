import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseTranslationJudgement } from "./parse.ts";

const GOOD = {
  heard: "o livro é na mesa",
  speech: true,
  noSpeechReason: null,
  matches: false,
  differences: [{ expected: "está", said: "é", kind: "replaced" }],
};

const json = (value: unknown) => JSON.stringify(value);

describe("parseTranslationJudgement", () => {
  test("reads speech into the shared fields", () => {
    assert.deepEqual(parseTranslationJudgement(json(GOOD)), {
      heard: GOOD.heard,
      englishSpeech: true,
      noEnglishReason: null,
      matches: false,
      differences: GOOD.differences,
    });
  });

  test("silence is a reason", () => {
    const judgement = parseTranslationJudgement(
      json({ ...GOOD, speech: false, noSpeechReason: "silence" }),
    );
    assert.equal(judgement.englishSpeech, false);
    assert.equal(judgement.noEnglishReason, "silence");
  });

  test("refuses other_language, which a translation never has", () => {
    assert.throws(
      () =>
        parseTranslationJudgement(
          json({ ...GOOD, speech: false, noSpeechReason: "other_language" }),
        ),
      /unknown noSpeechReason/,
    );
  });

  test("refuses the English tool's field names", () => {
    assert.throws(
      () =>
        parseTranslationJudgement(
          json({
            heard: "x",
            englishSpeech: true,
            noEnglishReason: null,
            matches: true,
            differences: [],
          }),
        ),
      /speech must be true or false/,
    );
  });

  test("refuses what is not JSON", () => {
    assert.throws(() => parseTranslationJudgement("{"), /not JSON/);
  });
});
