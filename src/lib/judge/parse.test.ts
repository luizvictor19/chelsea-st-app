import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { contradiction, malformedDifference, parseJudgement } from "./parse.ts";
import type { Difference } from "./provider.ts";
import {
  differencesPointAtError,
  recountedMatch,
  substantiveDifferences,
} from "./score.ts";

const GOOD = {
  heard: "the book are on the table",
  englishSpeech: true,
  noEnglishReason: null,
  matches: false,
  differences: [{ expected: "is", said: "are", kind: "replaced" }],
};

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe("parseJudgement", () => {
  test("reads a well formed answer as it came", () => {
    assert.deepEqual(parseJudgement(json(GOOD)), GOOD);
  });

  test("refuses what is not JSON", () => {
    assert.throws(() => parseJudgement("{heard:"), /not JSON/);
  });

  test("refuses a missing field", () => {
    const { matches: _drop, ...rest } = GOOD;
    void _drop;
    assert.throws(() => parseJudgement(json(rest)), /matches/);
  });

  test("refuses a boolean written as text", () => {
    assert.throws(
      () => parseJudgement(json({ ...GOOD, matches: "false" })),
      /matches must be true or false/,
    );
  });

  test("refuses an unknown kind", () => {
    const bad = {
      ...GOOD,
      differences: [{ expected: "is", said: "are", kind: "swapped" }],
    };
    assert.throws(() => parseJudgement(json(bad)), /unknown kind swapped/);
  });

  test("refuses an unknown reason", () => {
    assert.throws(
      () =>
        parseJudgement(
          json({ ...GOOD, englishSpeech: false, noEnglishReason: "music" }),
        ),
      /unknown noEnglishReason music/,
    );
  });
});

describe("malformedDifference", () => {
  /*
   * What gpt-audio-mini answered for g02 on 2026-09-25: right words listed as
   * missing, with the same word said. Kept by the parser, named here.
   */
  test("a right word listed as missing is kept and named", () => {
    const judgement = parseJudgement(
      json({
        ...GOOD,
        differences: [
          { expected: "The", said: "The", kind: "missing" },
          { expected: "is", said: "are", kind: "replaced" },
        ],
      }),
    );
    assert.equal(judgement.differences.length, 2);
    assert.equal(
      malformedDifference(judgement.differences[0]),
      "missing needs expected and no said",
    );
    assert.equal(malformedDifference(judgement.differences[1]), null);
  });

  test("an extra word with an expected word", () => {
    assert.equal(
      malformedDifference({ expected: "a", said: "um", kind: "extra" }),
      "extra needs said and no expected",
    );
  });

  test("a replacement by the same word", () => {
    assert.equal(
      malformedDifference({ expected: "Pen", said: "pen", kind: "replaced" }),
      "the same word on both sides",
    );
  });

  test("well formed kinds", () => {
    assert.equal(
      malformedDifference({ expected: "a", said: null, kind: "missing" }),
      null,
    );
    assert.equal(
      malformedDifference({ expected: null, said: "um", kind: "extra" }),
      null,
    );
  });
});

describe("contradiction", () => {
  test("none in a consistent answer", () => {
    assert.equal(contradiction(parseJudgement(json(GOOD))), null);
  });

  test("matches with differences is kept and named, not repaired", () => {
    const judgement = parseJudgement(json({ ...GOOD, matches: true }));
    assert.equal(judgement.matches, true);
    assert.equal(contradiction(judgement), "matches but lists differences");
  });

  test("no English speech without a reason", () => {
    const judgement = parseJudgement(
      json({ ...GOOD, englishSpeech: false, differences: [], matches: false }),
    );
    assert.equal(contradiction(judgement), "no English speech and no reason");
  });
});

describe("differencesPointAtError", () => {
  test("a replaced ending pointed at, and nothing else", () => {
    assert.deepEqual(
      differencesPointAtError(
        [{ expected: "stands", said: "stand", kind: "replaced" }],
        "brown stand in",
        "brown stands in",
      ),
      { pointed: true, onlyError: true },
    );
  });

  test("a missing article pointed at", () => {
    assert.deepEqual(
      differencesPointAtError(
        [{ expected: "a", said: null, kind: "missing" }],
        "is pen",
        "is a pen",
      ),
      { pointed: true, onlyError: true },
    );
  });

  test("the error split into two differences still counts", () => {
    assert.deepEqual(
      differencesPointAtError(
        [
          { expected: "longer", said: "long", kind: "replaced" },
          { expected: null, said: "more", kind: "extra" },
        ],
        "more long",
        "longer",
      ),
      { pointed: true, onlyError: true },
    );
  });

  test("the error plus a word that was fine is pointed but not only", () => {
    assert.deepEqual(
      differencesPointAtError(
        [
          { expected: "are", said: "is", kind: "replaced" },
          { expected: "the", said: null, kind: "missing" },
        ],
        "pens is",
        "pens are",
      ),
      { pointed: true, onlyError: false },
    );
  });

  test("a difference somewhere else does not point at the error", () => {
    assert.deepEqual(
      differencesPointAtError(
        [{ expected: "table", said: "cable", kind: "replaced" }],
        "book are",
        "book is",
      ),
      { pointed: false, onlyError: false },
    );
  });

  /*
   * Half the error named is not the error named: "is" said where "are" was
   * needed, and a judge that only reports the "is" without "are" has not told
   * the tutor what to teach. Here it reports the right word as said but
   * expects a different one.
   */
  test("the wrong correction does not count", () => {
    assert.deepEqual(
      differencesPointAtError(
        [{ expected: "was", said: "is", kind: "replaced" }],
        "is two",
        "are two",
      ),
      { pointed: false, onlyError: false },
    );
  });

  test("no differences never point", () => {
    assert.deepEqual(differencesPointAtError([], "is pen", "is a pen"), {
      pointed: false,
      onlyError: false,
    });
  });
});

describe("substantiveDifferences and recountedMatch", () => {
  test("punctuation and capitals on both sides are not a difference", () => {
    const noise: Difference[] = [
      { expected: "Yes,", said: "Yes", kind: "replaced" },
      { expected: "table.", said: "table", kind: "replaced" },
      { expected: "The", said: "the", kind: "missing" },
    ];
    assert.deepEqual(substantiveDifferences(noise), []);
    assert.equal(recountedMatch(noise), true);
  });

  test("a real change survives, even next to noise", () => {
    const mixed: Difference[] = [
      { expected: "Yes,", said: "Yes", kind: "replaced" },
      { expected: "are", said: "is", kind: "replaced" },
    ];
    assert.deepEqual(substantiveDifferences(mixed), [mixed[1]]);
    assert.equal(recountedMatch(mixed), false);
  });

  test("a missing word is never dropped", () => {
    const missing: Difference[] = [
      { expected: "a", said: null, kind: "missing" },
    ];
    assert.equal(recountedMatch(missing), false);
  });

  test("an extra word is never dropped", () => {
    const extra: Difference[] = [{ expected: null, said: "um", kind: "extra" }];
    assert.equal(recountedMatch(extra), false);
  });

  // The tutor teaches the contraction, so it stays a difference here too.
  test("a contraction against its expansion is a difference", () => {
    const contraction: Difference[] = [
      { expected: "it's", said: "it is", kind: "replaced" },
    ];
    assert.equal(recountedMatch(contraction), false);
  });

  test("the verdict comes from the differences, not from matches", () => {
    // What gpt-audio-1.5 answered for h02 #2: matches false, no difference.
    assert.equal(recountedMatch([]), true);
  });
});
