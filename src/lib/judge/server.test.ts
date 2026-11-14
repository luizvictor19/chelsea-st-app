import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MAX_TAKE_BYTES, encodeWav } from "../audio/wav.ts";
import { createFakeJudge } from "./fake-judge.ts";
import { judgeAnswer, validateTake, type TakeRefusal } from "./server.ts";

const RIGHT = {
  heard: "Yes, it's a pen.",
  englishSpeech: true,
  noEnglishReason: null,
  matches: true,
  differences: [],
} as const;

function seconds(n: number, rate = 24_000): Uint8Array {
  return encodeWav(new Float32Array(Math.round(rate * n)), rate);
}

/** A WAV header with another shape, written over a good one. */
function reshaped(change: (view: DataView) => void): Uint8Array {
  const bytes = seconds(1);
  change(new DataView(bytes.buffer));
  return bytes;
}

const REFUSED: [string, Uint8Array, TakeRefusal][] = [
  ["empty bytes", new Uint8Array(0), "empty"],
  ["a WAV with no samples", seconds(0), "empty"],
  [
    "more than the largest file",
    new Uint8Array(MAX_TAKE_BYTES + 1),
    "too-large",
  ],
  [
    "what is not WAV",
    new TextEncoder().encode("OggS not a wav file"),
    "not-wav",
  ],
  ["stereo", reshaped((v) => v.setUint16(22, 2, true)), "not-mono"],
  ["48 kHz", seconds(0.5, 48_000), "not-24khz"],
  ["8 bits", reshaped((v) => v.setUint16(34, 8, true)), "not-16bit"],
  ["longer than 15 s and the margin", seconds(16.1), "too-large"],
];

describe("validateTake", () => {
  for (const [name, bytes, reason] of REFUSED) {
    test(`refuses ${name}`, () => {
      assert.deepEqual(validateTake(bytes), { ok: false, reason });
    });
  }

  test("takes 15 s of mono 24 kHz 16 bit, and the margin", () => {
    assert.deepEqual(validateTake(seconds(15)), { ok: true, audioMs: 15_000 });
    assert.deepEqual(validateTake(seconds(16)), { ok: true, audioMs: 16_000 });
  });
});

describe("judgeAnswer", () => {
  const input = {
    question: "Is this a pen?",
    expected: "Yes, it's a pen.",
    answerLanguage: "en" as const,
  };

  for (const [name, bytes, reason] of REFUSED) {
    test(`${name} never reaches the judge`, async () => {
      const judge = createFakeJudge([{ judgement: RIGHT }]);
      const answer = await judgeAnswer(judge, { ...input, audio: bytes });
      assert.deepEqual(answer, { kind: "refused", reason });
      assert.equal(judge.calls.length, 0);
    });
  }

  test("without a judge it says so and calls nothing", async () => {
    const answer = await judgeAnswer(null, { ...input, audio: seconds(1) });
    assert.deepEqual(answer, { kind: "unconfigured" });
  });

  test("a good take is judged once, as WAV, in the question's language", async () => {
    const judge = createFakeJudge([{ judgement: RIGHT }]);
    const answer = await judgeAnswer(judge, { ...input, audio: seconds(2) });
    assert.equal(answer.kind, "judged");
    assert.equal(judge.calls.length, 1);
    assert.equal(judge.calls[0].contentType, "audio/wav");
    assert.equal(judge.calls[0].answerLanguage, "en");
    if (answer.kind === "judged") assert.equal(answer.take.audioMs, 2000);
  });
});
